package com.vega

import android.util.Base64
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.ReactPackage
import com.facebook.react.uimanager.ViewManager
import com.facebook.react.modules.network.OkHttpClientProvider
import okhttp3.Call
import okhttp3.Cookie
import okhttp3.CookieJar
import okhttp3.Dns
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import okhttp3.MediaType.Companion.toMediaTypeOrNull
import okhttp3.Request
import okhttp3.RequestBody
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.IOException
import java.io.ByteArrayOutputStream
import java.net.Inet4Address
import java.net.InetAddress
import java.net.UnknownHostException
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.TimeUnit

class ProviderHttpModule(reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {

    private class FetchTask {
        val cancelled = AtomicBoolean(false)
        @Volatile var call: Call? = null
        fun cancel() {
            cancelled.set(true)
            call?.cancel()
        }
    }
    private val requests = ConcurrentHashMap<String, FetchTask>()
    private val executor = Executors.newFixedThreadPool(4)

    @ReactMethod
    fun cancel(requestId: String) {
        requests[requestId]?.cancel()
    }

    override fun invalidate() {
        requests.values.forEach { it.cancel() }
        executor.shutdownNow()
        super.invalidate()
    }

    override fun getName(): String = "ProviderHttpModule"

    companion object {
        private val IPV4_LITERAL = Regex("^\\d{1,3}(\\.\\d{1,3}){3}$")

        private fun isBlockedIpv4(bytes: ByteArray, offset: Int): Boolean {
            val first = bytes[offset].toInt() and 0xff
            val second = bytes[offset + 1].toInt() and 0xff
            return first == 0 || first == 10 || first == 127 ||
                (first == 169 && second == 254) ||
                (first == 172 && second in 16..31) ||
                (first == 192 && second == 168) ||
                (first == 100 && second in 64..127) || // CGNAT
                first >= 224 // multicast and reserved
        }

        /** Mirrors isPrivateHostname in src/lib/sandbox/urlGuard.ts. */
        fun isBlockedAddress(address: InetAddress): Boolean {
            if (address.isLoopbackAddress || address.isSiteLocalAddress ||
                address.isLinkLocalAddress || address.isAnyLocalAddress ||
                address.isMulticastAddress) {
                return true
            }
            val bytes = address.address
            if (address is Inet4Address || bytes.size == 4) return isBlockedIpv4(bytes, 0)
            if (bytes.size != 16) return true
            val b = { i: Int -> bytes[i].toInt() and 0xff }
            val zeros = { from: Int, to: Int -> (from until to).all { b(it) == 0 } }
            // ::/96 and ::ffff:0:0/96 carry an IPv4 address.
            if (zeros(0, 10) && ((b(10) == 0 && b(11) == 0) || (b(10) == 0xff && b(11) == 0xff))) {
                return isBlockedIpv4(bytes, 12)
            }
            // 64:ff9b::/96, NAT64.
            if (b(0) == 0x00 && b(1) == 0x64 && b(2) == 0xff && b(3) == 0x9b && zeros(4, 12)) return true
            // 2002::/16, 6to4.
            if (b(0) == 0x20 && b(1) == 0x02) return isBlockedIpv4(bytes, 2)
            return (b(0) and 0xfe) == 0xfc || // fc00::/7 unique local
                (b(0) == 0xfe && (b(1) and 0xc0) == 0x80) || // fe80::/10
                (b(0) == 0xfe && (b(1) and 0xc0) == 0xc0) || // fec0::/10
                b(0) == 0xff
        }

        /** OkHttp does not call Dns for IP literals, so check those directly. */
        fun rejectBlockedLiteral(host: String?) {
            if (host == null) throw IOException("Provider URL is not valid")
            val isLiteral = host.contains(':') || IPV4_LITERAL.matches(host)
            if (isLiteral && isBlockedAddress(InetAddress.getByName(host))) {
                throw IOException("Provider URL is not allowed")
            }
        }
    }

    @ReactMethod
    fun fetch(url: String, options: ReadableMap, promise: Promise) {
        val requestId = if (options.hasKey("requestId")) options.getString("requestId") else null
        val task = FetchTask()
        if (requestId != null) requests[requestId] = task
        executor.execute {
            try {
                val method = if (options.hasKey("method")) options.getString("method")?.uppercase() ?: "GET" else "GET"
                val followRedirects = if (options.hasKey("redirect")) options.getString("redirect") != "manual" else true
                val timeoutMs = if (options.hasKey("timeoutMs")) options.getInt("timeoutMs").toLong() else 30_000L

                // Provider cookies live in per-author jars on the JS side. Keep
                // the shared app cookie store out of these requests and hand
                // every Set-Cookie (redirects included) back to JS instead.
                val receivedCookies = mutableListOf<Pair<String, String>>()
                val recordingJar = object : CookieJar {
                    override fun loadForRequest(url: HttpUrl): List<Cookie> = emptyList()
                    override fun saveFromResponse(url: HttpUrl, cookies: List<Cookie>) {
                        synchronized(receivedCookies) {
                            cookies.forEach { receivedCookies.add(url.toString() to it.toString()) }
                        }
                    }
                }

                // The JS guard only sees host names. Check the addresses too, so a
                // public name that resolves to a local address (127.0.0.1.nip.io)
                // or an IP literal on any redirect hop cannot reach the device or LAN.
                rejectBlockedLiteral(url.toHttpUrlOrNull()?.host)
                val baseClient = OkHttpClientProvider.getOkHttpClient()
                val baseDns = baseClient.dns
                val client = baseClient.newBuilder()
                    .dns(object : Dns {
                        override fun lookup(hostname: String): List<InetAddress> =
                            baseDns.lookup(hostname).also { addresses ->
                                if (addresses.any { isBlockedAddress(it) }) {
                                    throw UnknownHostException("Provider URL is not allowed")
                                }
                            }
                    })
                    .addNetworkInterceptor { chain ->
                        rejectBlockedLiteral(chain.request().url.host)
                        chain.proceed(chain.request())
                    }
                    .cookieJar(recordingJar)
                    .followRedirects(followRedirects)
                    .followSslRedirects(followRedirects)
                    .connectTimeout(timeoutMs, TimeUnit.MILLISECONDS)
                    .readTimeout(timeoutMs, TimeUnit.MILLISECONDS)
                    .writeTimeout(timeoutMs, TimeUnit.MILLISECONDS)
                    .build()

                val requestBuilder = Request.Builder().url(url)

                // Headers
                if (options.hasKey("headers")) {
                    val headersArray = options.getArray("headers")
                    if (headersArray != null) {
                        for (i in 0 until headersArray.size()) {
                            val pair = headersArray.getArray(i)
                            if (pair != null && pair.size() >= 2) {
                                val key = pair.getString(0) ?: ""
                                val value = pair.getString(1) ?: ""
                                if (key.isNotBlank()) {
                                    requestBuilder.addHeader(key, value)
                                }
                            }
                        }
                    }
                }

                // Body
                var requestBody: RequestBody? = null
                if (options.hasKey("bodyBase64")) {
                    val bodyBase64 = options.getString("bodyBase64")
                    val contentType = if (options.hasKey("contentType")) options.getString("contentType")?.toMediaTypeOrNull() else null
                    if (bodyBase64 != null) {
                        val bytes = Base64.decode(bodyBase64, Base64.DEFAULT)
                        requestBody = bytes.toRequestBody(contentType)
                    }
                } else if (options.hasKey("bodyText")) {
                    val bodyText = options.getString("bodyText")
                    val contentType = if (options.hasKey("contentType")) options.getString("contentType")?.toMediaTypeOrNull() else null
                    if (bodyText != null) {
                        requestBody = bodyText.toRequestBody(contentType)
                    }
                }

                if (method == "POST" || method == "PUT" || method == "PATCH" || method == "DELETE") {
                    requestBuilder.method(method, requestBody ?: "".toRequestBody(null))
                } else {
                    requestBuilder.method(method, null)
                }

                if (task.cancelled.get()) throw IOException("Provider request aborted")
                val call = client.newCall(requestBuilder.build())
                task.call = call
                if (task.cancelled.get()) call.cancel()
                call.execute().use { response ->
                val responseHeaders = Arguments.createArray()
                for (name in response.headers.names()) {
                    for (value in response.headers.values(name)) {
                        val pair = Arguments.createArray()
                        pair.pushString(name)
                        pair.pushString(value)
                        responseHeaders.pushArray(pair)
                    }
                }

                val finalUrl = response.request.url.toString()
                val status = response.code
                val statusText = response.message

                val isRedirect = status in 300..399
                val maxBytes = 32 * 1024 * 1024 // 32MB

                val bodyBase64: String = if (followRedirects || !isRedirect) {
                    val responseBody = response.body
                    if (responseBody != null) {
                        val contentLength = responseBody.contentLength()
                        if (contentLength > maxBytes) {
                            response.close()
                            throw IOException("Provider response is too large")
                        }
                        val bytes = ByteArrayOutputStream()
                        responseBody.byteStream().use { stream ->
                            val buffer = ByteArray(8192)
                            while (true) {
                                val count = stream.read(buffer)
                                if (count < 0) break
                                if (bytes.size() + count > maxBytes) throw IOException("Provider response is too large")
                                bytes.write(buffer, 0, count)
                            }
                        }
                        Base64.encodeToString(bytes.toByteArray(), Base64.NO_WRAP)
                    } else {
                        ""
                    }
                } else {
                    response.close()
                    ""
                }

                val result = Arguments.createMap()
                result.putInt("status", status)
                result.putString("statusText", statusText)
                result.putString("url", finalUrl)
                result.putArray("headers", responseHeaders)
                result.putString("bodyBase64", bodyBase64)
                val cookies = Arguments.createArray()
                synchronized(receivedCookies) {
                    for ((cookieUrl, cookie) in receivedCookies) {
                        val pair = Arguments.createArray()
                        pair.pushString(cookieUrl)
                        pair.pushString(cookie)
                        cookies.pushArray(pair)
                    }
                }
                result.putArray("cookies", cookies)

                if (task.cancelled.get()) throw IOException("Provider request aborted")
                promise.resolve(result)
                }
            } catch (e: Exception) {
                promise.reject(if (task.cancelled.get()) "FETCH_ABORTED" else "FETCH_ERROR", e.message ?: e.toString(), e)
            } finally {
                if (requestId != null) requests.remove(requestId, task)
            }
        }
    }
}

class ProviderHttpPackage : ReactPackage {
    override fun createNativeModules(reactContext: ReactApplicationContext): List<NativeModule> {
        return listOf(ProviderHttpModule(reactContext))
    }

    override fun createViewManagers(reactContext: ReactApplicationContext): List<ViewManager<*, *>> {
        return emptyList()
    }
}
