package com.vega

import android.content.Context
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.os.Handler
import android.os.Looper
import android.util.Base64
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.WritableMap
import com.facebook.react.modules.core.DeviceEventManagerModule
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import javax.crypto.AEADBadTagException
import javax.crypto.Cipher
import javax.crypto.Mac
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec

/**
 * Backup sync and "Send setup": PBKDF2-HMAC-SHA256, HMAC-SHA256 and
 * AES-256-GCM with javax.crypto, the network checks, and the one-time server
 * that receives a setup on the home network. Written for Droid Stream.
 *
 * The server reuses [RemoteRpcServer] (Wi-Fi address only, home-network
 * clients only, size limits and timeouts) on its own port. JavaScript checks
 * the token and decrypts; the server stops itself after [MAX_SESSION_MS]
 * in case JavaScript never stops it. Nothing here logs keys or data.
 */
class SyncTransferModule(private val reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {
    companion object {
        private const val TAG = "SyncTransfer"
        private const val ANSWER_TIMEOUT_SECONDS = 30L
        private const val MAX_WAITING = 8
        private const val MAX_SESSION_MS = 15 * 60_000L
        private const val MIN_ITERATIONS = 100_000
        private const val MAX_ITERATIONS = 5_000_000
        private const val TAG_BITS = 128
    }

    private class Slot {
        val latch = CountDownLatch(1)
        @Volatile var value: String? = null
    }

    private val slots = ConcurrentHashMap<String, Slot>()
    private val main = Handler(Looper.getMainLooper())
    private val backstop = Runnable { stopServer() }
    @Volatile private var server: RemoteRpcServer? = null

    override fun getName(): String = "SyncTransferModule"

    override fun invalidate() {
        stopServer()
        super.invalidate()
    }

    @ReactMethod fun addListener(eventName: String) = Unit
    @ReactMethod fun removeListeners(count: Double) = Unit

    private fun decode(value: String): ByteArray = Base64.decode(value, Base64.NO_WRAP)
    private fun encode(value: ByteArray): String = Base64.encodeToString(value, Base64.NO_WRAP)

    private fun background(promise: Promise, code: String, work: () -> Any?) {
        Thread {
            try {
                promise.resolve(work())
            } catch (error: AEADBadTagException) {
                promise.reject("DECRYPT_FAILED", "Wrong key or changed data")
            } catch (error: Exception) {
                promise.reject(code, error.message ?: "Failed")
            }
        }.start()
    }

    // ---- Crypto ----

    private fun pbkdf2(password: ByteArray, salt: ByteArray, iterations: Int, length: Int): ByteArray {
        val mac = Mac.getInstance("HmacSHA256")
        mac.init(SecretKeySpec(password, "HmacSHA256"))
        val out = ByteArray(length)
        var offset = 0
        var block = 1
        while (offset < length) {
            mac.update(salt)
            mac.update(byteArrayOf((block ushr 24).toByte(), (block ushr 16).toByte(), (block ushr 8).toByte(), block.toByte()))
            var u = mac.doFinal()
            val t = u.copyOf()
            for (round in 1 until iterations) {
                u = mac.doFinal(u)
                for (index in t.indices) t[index] = (t[index].toInt() xor u[index].toInt()).toByte()
            }
            val count = minOf(t.size, length - offset)
            System.arraycopy(t, 0, out, offset, count)
            offset += count
            block += 1
        }
        return out
    }

    @ReactMethod
    fun pbkdf2Sha256(password: String, saltB64: String, iterations: Double, length: Double, promise: Promise) {
        background(promise, "PBKDF2_FAILED") {
            val rounds = iterations.toInt()
            val size = length.toInt()
            require(password.isNotEmpty()) { "Empty passphrase" }
            require(rounds in MIN_ITERATIONS..MAX_ITERATIONS) { "Bad iteration count" }
            require(size in 16..64) { "Bad key length" }
            encode(pbkdf2(password.toByteArray(Charsets.UTF_8), decode(saltB64), rounds, size))
        }
    }

    @ReactMethod
    fun hmacSha256(keyB64: String, message: String, promise: Promise) {
        background(promise, "HMAC_FAILED") {
            val mac = Mac.getInstance("HmacSHA256")
            mac.init(SecretKeySpec(decode(keyB64), "HmacSHA256"))
            encode(mac.doFinal(message.toByteArray(Charsets.UTF_8)))
        }
    }

    private fun cipher(mode: Int, keyB64: String, nonceB64: String, aadB64: String): Cipher {
        val key = decode(keyB64)
        val nonce = decode(nonceB64)
        require(key.size == 32) { "Bad key" }
        require(nonce.size == 12) { "Bad nonce" }
        return Cipher.getInstance("AES/GCM/NoPadding").apply {
            init(mode, SecretKeySpec(key, "AES"), GCMParameterSpec(TAG_BITS, nonce))
            val aad = decode(aadB64)
            if (aad.isNotEmpty()) updateAAD(aad)
        }
    }

    @ReactMethod
    fun aesGcmSeal(keyB64: String, nonceB64: String, aadB64: String, plaintext: String, promise: Promise) {
        background(promise, "ENCRYPT_FAILED") {
            encode(cipher(Cipher.ENCRYPT_MODE, keyB64, nonceB64, aadB64).doFinal(plaintext.toByteArray(Charsets.UTF_8)))
        }
    }

    @ReactMethod
    fun aesGcmOpen(keyB64: String, nonceB64: String, aadB64: String, sealedB64: String, promise: Promise) {
        background(promise, "DECRYPT_FAILED") {
            String(cipher(Cipher.DECRYPT_MODE, keyB64, nonceB64, aadB64).doFinal(decode(sealedB64)), Charsets.UTF_8)
        }
    }

    // ---- Network ----

    @ReactMethod
    fun isUnmetered(promise: Promise) {
        try {
            val manager = reactContext.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
            val capabilities = manager.getNetworkCapabilities(manager.activeNetwork)
            val local = capabilities != null &&
                (capabilities.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) ||
                    capabilities.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET))
            promise.resolve(local && !manager.isActiveNetworkMetered)
        } catch (error: Exception) {
            promise.resolve(false)
        }
    }

    @ReactMethod
    fun lanAddress(promise: Promise) {
        promise.resolve(RemoteAccess.lanAddress(reactContext)?.hostAddress)
    }

    // ---- One-time receive server ----

    private fun state(running: Boolean, error: String? = null): WritableMap = Arguments.createMap().apply {
        putBoolean("running", running)
        server?.let {
            putString("address", it.address.hostAddress)
            putInt("port", it.port)
        }
        error?.let { putString("error", it) }
    }

    @ReactMethod
    fun startReceiver(port: Double, maxBodyBytes: Double, promise: Promise) {
        val wanted = port.toInt()
        if (wanted !in 1024..65535) return promise.reject("BAD_PORT", "Bad port")
        Thread {
            stopServer()
            val address = RemoteAccess.lanAddress(reactContext)
            if (address == null) {
                promise.resolve(state(false, "Connect to Wi-Fi or Ethernet to receive a setup"))
                return@Thread
            }
            val limit = maxBodyBytes.toInt().coerceIn(64 * 1024, 16 * 1024 * 1024)
            val next = RemoteRpcServer(address, wanted, limit) { client, body -> dispatch(client, body) }
            try {
                next.start()
                server = next
                main.removeCallbacks(backstop)
                main.postDelayed(backstop, MAX_SESSION_MS)
                VegaLog.i(TAG, "Receiving on port $wanted")
                promise.resolve(state(true))
            } catch (error: Exception) {
                next.stop()
                promise.resolve(state(false, "Port $wanted is in use"))
            }
        }.start()
    }

    @ReactMethod
    fun stopReceiver(promise: Promise) {
        stopServer()
        promise.resolve(null)
    }

    @ReactMethod
    fun respond(id: String, body: String) {
        val slot = slots[id] ?: return
        slot.value = body
        slot.latch.countDown()
    }

    @Synchronized
    private fun stopServer() {
        main.removeCallbacks(backstop)
        server?.stop()
        server = null
        slots.values.forEach { it.latch.countDown() }
    }

    private fun busy() = "{\"ok\":false,\"error\":\"bad-request\"}"

    /** Runs on a server thread: hands the body to JavaScript and waits for its answer. */
    private fun dispatch(client: String, body: String): String {
        if (!reactContext.hasActiveReactInstance() || slots.size >= MAX_WAITING) return busy()
        val id = UUID.randomUUID().toString()
        val slot = Slot()
        slots[id] = slot
        try {
            reactContext.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
                .emit("SyncTransferRequest", Arguments.createMap().apply {
                    putString("id", id)
                    putString("client", client)
                    putString("body", body)
                })
            if (!slot.latch.await(ANSWER_TIMEOUT_SECONDS, TimeUnit.SECONDS)) return busy()
            return slot.value ?: busy()
        } catch (error: Exception) {
            return busy()
        } finally {
            slots.remove(id)
        }
    }
}
