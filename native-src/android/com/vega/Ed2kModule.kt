package com.vega

import android.content.Context
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableArray
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.modules.core.DeviceEventManagerModule
import com.facebook.react.modules.network.OkHttpClientProvider
import okhttp3.Request
import java.io.File
import java.io.IOException
import java.security.SecureRandom
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

/**
 * eD2k downloads for the downloads list (see Ed2kTransfer.kt for the engine).
 * Off unless the user turns it on; nothing here runs until a download or a
 * search starts, and the server connection closes a minute after the last one.
 */
class Ed2kModule(private val reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {
    override fun getName(): String = "Ed2kModule"

    private class Job(val transfer: Ed2kTransfer, @Volatile var promise: Promise)

    private val host = object : Ed2kHost {
        override fun blockedReason(wifiOnly: Boolean): String? {
            val manager = reactContext.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
            val capabilities = runCatching { manager.getNetworkCapabilities(manager.activeNetwork) }.getOrNull()
                ?: return "Waiting for network"
            if (!capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)) return "Waiting for network"
            // Wi-Fi only also allows Ethernet (TVs); it blocks metered networks.
            if (wifiOnly && !capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_NOT_METERED)) return "Waiting for Wi-Fi"
            return null
        }
    }

    private fun engine(): Ed2kEngine = synchronized(Companion) {
        sharedEngine ?: Ed2kEngine(userHash(), host).also { sharedEngine = it }
    }

    /** A random user hash, made once and kept, so peers recognise this client in their queues. */
    private fun userHash(): ByteArray {
        val prefs = reactContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        prefs.getString(KEY_USER_HASH, null)?.let { saved ->
            runCatching { Ed2kHash.fromHex(saved) }.getOrNull()?.takeIf { it.size == 16 }?.let { return it }
        }
        val hash = ByteArray(16).also { SecureRandom().nextBytes(it) }
        prefs.edit().putString(KEY_USER_HASH, Ed2kHash.hex(hash)).apply()
        return hash
    }

    private fun readServers(servers: ReadableArray?): List<Ed2kServerEntry> {
        if (servers == null) return emptyList()
        val list = mutableListOf<Ed2kServerEntry>()
        for (index in 0 until servers.size()) {
            val item = servers.getMap(index) ?: continue
            val hostName = item.getString("host")?.trim().orEmpty()
            val port = if (item.hasKey("port")) item.getDouble("port").toInt() else 0
            if (hostName.isNotEmpty() && port in 1..65535) {
                list.add(Ed2kServerEntry(hostName, port, item.getString("name").orEmpty()))
            }
        }
        return list
    }

    private fun readEndpoints(values: ReadableArray?): List<Ed2kEndpoint> {
        if (values == null) return emptyList()
        return (0 until values.size()).mapNotNull { index ->
            val value = values.getString(index)?.trim() ?: return@mapNotNull null
            val separator = value.lastIndexOf(':')
            val port = value.substring(separator + 1).toIntOrNull()
            if (separator <= 0 || port == null || port !in 1..65535) null else Ed2kEndpoint(value.substring(0, separator), port)
        }
    }

    /**
     * Downloads one file to [path]. Resolves when every part passed its MD4
     * check; rejects with ED2K_PAUSED or ED2K_CANCELLED when stopped. A part
     * map next to the file lets a later start continue where this one stopped.
     */
    @ReactMethod
    fun start(downloadId: String, options: ReadableMap, servers: ReadableArray?, promise: Promise) {
        try {
            jobs[downloadId]?.let { running ->
                // After a JavaScript reload the transfer is still running: report to the new caller.
                if (running.transfer.stop == Ed2kTransfer.Stop.NONE) {
                    running.promise = promise
                } else {
                    promise.reject("ED2K_ACTIVE", "This download is still stopping. Try again.")
                }
                return
            }
            val hash = Ed2kHash.fromHex(options.getString("hash").orEmpty())
            require(hash.size == 16) { "The eD2k link has no valid file hash" }
            val size = options.getDouble("size").toLong()
            require(size > 0) { "The eD2k link has no file size" }
            val path = options.getString("path").orEmpty()
            require(path.isNotEmpty()) { "No place to save the file" }
            val partHashes = if (options.hasKey("partHashes")) {
                options.getArray("partHashes")?.let { array ->
                    (0 until array.size()).mapNotNull { array.getString(it)?.let { hex -> runCatching { Ed2kHash.fromHex(hex) }.getOrNull() } }
                        .filter { it.size == 16 }
                }
            } else {
                null
            }
            val wifiOnly = options.hasKey("wifiOnly") && options.getBoolean("wifiOnly")
            val sources = if (options.hasKey("sources")) readEndpoints(options.getArray("sources")) else emptyList()
            val engine = engine()
            readServers(servers).takeIf { it.isNotEmpty() }?.let { engine.servers = it }

            val transfer = Ed2kTransfer(
                id = downloadId,
                hash = hash,
                size = size,
                file = File(path),
                linkSources = sources,
                linkPartHashes = partHashes,
                wifiOnly = wifiOnly,
                engine = engine,
                onStatus = { status -> emitStatus(downloadId, status) },
                onDone = { done, error -> finish(done, error) },
            )
            jobs[downloadId] = Job(transfer, promise)
            transfer.start()
        } catch (error: Exception) {
            promise.reject("ED2K_START_FAILED", error.message ?: error.toString(), error)
        }
    }

    private fun finish(transfer: Ed2kTransfer, error: Throwable?) {
        val job = jobs[transfer.id]?.takeIf { it.transfer === transfer } ?: return
        jobs.remove(transfer.id, job)
        when {
            error == null -> job.promise.resolve(Arguments.createMap().apply {
                putDouble("totalBytes", transfer.size.toDouble())
            })
            error is Ed2kStoppedException && error.reason == "paused" ->
                job.promise.reject("ED2K_PAUSED", "Download paused")
            error is Ed2kStoppedException ->
                job.promise.reject("ED2K_CANCELLED", "Download cancelled")
            else -> job.promise.reject("ED2K_FAILED", error.message ?: error.toString(), error)
        }
    }

    /** Stops the transfer and keeps the partial file and its part map. */
    @ReactMethod
    fun pause(downloadId: String, promise: Promise) {
        jobs[downloadId]?.transfer?.requestStop(Ed2kTransfer.Stop.PAUSE)
        promise.resolve(null)
    }

    /** Stops the transfer and deletes the partial file. */
    @ReactMethod
    fun cancel(downloadId: String, promise: Promise) {
        jobs[downloadId]?.transfer?.requestStop(Ed2kTransfer.Stop.CANCEL)
        promise.resolve(null)
    }

    @ReactMethod
    fun isActive(downloadId: String, promise: Promise) {
        promise.resolve(jobs.containsKey(downloadId))
    }

    /** Keyword search on the connected eD2k server. */
    @ReactMethod
    fun search(query: String, servers: ReadableArray?, promise: Promise) {
        executor.execute {
            try {
                val engine = engine()
                readServers(servers).takeIf { it.isNotEmpty() }?.let { engine.servers = it }
                val results = engine.search(query)
                val array = Arguments.createArray()
                results.distinctBy { Ed2kHash.hex(it.hash) }.forEach { result ->
                    array.pushMap(Arguments.createMap().apply {
                        putString("hash", Ed2kHash.hex(result.hash))
                        putString("name", result.name)
                        putDouble("size", result.size.toDouble())
                        putDouble("sources", result.sources.toDouble())
                        putDouble("completeSources", result.completeSources.toDouble())
                    })
                }
                promise.resolve(array)
            } catch (error: Exception) {
                promise.reject("ED2K_SEARCH_FAILED", error.message ?: error.toString(), error)
            }
        }
    }

    /** Downloads and reads a server.met file. */
    @ReactMethod
    fun fetchServerList(url: String, promise: Promise) {
        executor.execute {
            try {
                val client = OkHttpClientProvider.getOkHttpClient().newBuilder()
                    .callTimeout(30, TimeUnit.SECONDS)
                    .build()
                val bytes = client.newCall(Request.Builder().url(url).build()).execute().use { response ->
                    if (!response.isSuccessful) throw IOException("The server list could not be downloaded (HTTP ${response.code})")
                    val body = response.body ?: throw IOException("The server list is empty")
                    if (body.contentLength() > MAX_SERVER_MET) throw IOException("The server list is too large")
                    body.bytes()
                }
                if (bytes.size > MAX_SERVER_MET) throw IOException("The server list is too large")
                val array = Arguments.createArray()
                Ed2kParse.serverMet(bytes).distinctBy { "${it.host}:${it.port}" }.forEach { server ->
                    array.pushMap(Arguments.createMap().apply {
                        putString("host", server.host)
                        putInt("port", server.port)
                        putString("name", server.name)
                        putString("description", server.description)
                    })
                }
                promise.resolve(array)
            } catch (error: Exception) {
                promise.reject("ED2K_SERVER_LIST_FAILED", error.message ?: error.toString(), error)
            }
        }
    }

    @ReactMethod fun addListener(eventName: String) = Unit
    @ReactMethod fun removeListeners(count: Double) = Unit

    private fun emitStatus(downloadId: String, status: Ed2kStatus) {
        if (!reactContext.hasActiveReactInstance()) return
        reactContext.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
            .emit(PROGRESS_EVENT, Arguments.createMap().apply {
                putString("downloadId", downloadId)
                putDouble("downloadedBytes", status.downloaded.toDouble())
                putDouble("totalBytes", status.total.toDouble())
                putDouble("speed", status.speed.toDouble())
                putInt("sources", status.sources)
                putInt("downloading", status.downloading)
                putInt("queued", status.queued)
                putInt("queueRank", status.queueRank)
                putString("state", status.state)
                putString("server", status.server)
                putString("message", status.message)
            })
    }

    companion object {
        private const val PROGRESS_EVENT = "VegaEd2kProgress"
        private const val PREFS = "vega_ed2k"
        private const val KEY_USER_HASH = "userHash"
        private const val MAX_SERVER_MET = 8 * 1024 * 1024
        private var sharedEngine: Ed2kEngine? = null
        private val jobs = ConcurrentHashMap<String, Job>()
        private val executor = Executors.newCachedThreadPool()
    }
}
