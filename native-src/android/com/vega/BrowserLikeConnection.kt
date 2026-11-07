package com.vega

import android.content.Context
import okhttp3.Interceptor
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import org.json.JSONArray
import java.net.InetAddress
import java.net.Socket
import java.security.KeyStore
import javax.net.ssl.SSLContext
import javax.net.ssl.SSLSocket
import javax.net.ssl.SSLSocketFactory
import javax.net.ssl.TrustManagerFactory
import javax.net.ssl.X509TrustManager

/**
 * "Use a browser-like connection" for the sites the user lists in Settings >
 * Advanced downloads. For those hosts only:
 *  - TLS offers Chrome's cipher-suite order with TLS 1.3 and 1.2 (ALPN h2 and
 *    http/1.1 is OkHttp's default already),
 *  - requests carry Chrome's user agent and client-hint headers, in Chrome's
 *    header order.
 * Every other host is left exactly as before. It is Chrome-like, not a copy:
 * Android's TLS library has no GREASE or extension shuffling, and OkHttp keeps
 * its own HTTP/2 settings and pseudo-header order. Debrid hosts are never changed.
 */
object BrowserLikeConnection {
    private const val PREFS = "droidstream_remote_access"
    private const val KEY_SITES = "browser_like_sites"
    private const val KEY_NEVER = "browser_like_never"

    const val CHROME_MAJOR = 142
    const val CHROME_USER_AGENT =
        "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/$CHROME_MAJOR.0.0.0 Mobile Safari/537.36"
    private const val CHROME_SEC_CH_UA =
        "\"Chromium\";v=\"$CHROME_MAJOR\", \"Google Chrome\";v=\"$CHROME_MAJOR\", \"Not_A Brand\";v=\"99\""
    private const val CHROME_ACCEPT =
        "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7"

    /** Chrome's order. TLS 1.3 suites are fixed by the TLS library and listed for completeness. */
    private val CHROME_CIPHER_SUITES = arrayOf(
        "TLS_AES_128_GCM_SHA256",
        "TLS_AES_256_GCM_SHA384",
        "TLS_CHACHA20_POLY1305_SHA256",
        "TLS_ECDHE_ECDSA_WITH_AES_128_GCM_SHA256",
        "TLS_ECDHE_RSA_WITH_AES_128_GCM_SHA256",
        "TLS_ECDHE_ECDSA_WITH_AES_256_GCM_SHA384",
        "TLS_ECDHE_RSA_WITH_AES_256_GCM_SHA384",
        "TLS_ECDHE_ECDSA_WITH_CHACHA20_POLY1305_SHA256",
        "TLS_ECDHE_RSA_WITH_CHACHA20_POLY1305_SHA256",
        "TLS_ECDHE_RSA_WITH_AES_128_CBC_SHA",
        "TLS_ECDHE_RSA_WITH_AES_256_CBC_SHA",
        "TLS_RSA_WITH_AES_128_GCM_SHA256",
        "TLS_RSA_WITH_AES_256_GCM_SHA384",
        "TLS_RSA_WITH_AES_128_CBC_SHA",
        "TLS_RSA_WITH_AES_256_CBC_SHA",
    )
    private val CHROME_TLS_VERSIONS = arrayOf("TLSv1.3", "TLSv1.2")

    /** Chrome's header order; headers not named here follow in their own order. */
    private val HEADER_ORDER = listOf(
        "host", "connection", "content-length", "cache-control", "sec-ch-ua", "sec-ch-ua-mobile",
        "sec-ch-ua-platform", "upgrade-insecure-requests", "origin", "content-type", "user-agent", "accept",
        "sec-fetch-site", "sec-fetch-mode", "sec-fetch-user", "sec-fetch-dest", "referer", "accept-encoding",
        "accept-language", "cookie", "range", "if-range", "priority",
    )

    @Volatile private var sites: Set<String> = emptySet()
    @Volatile private var never: Set<String> = emptySet()
    @Volatile private var loaded = false

    private fun normalize(host: String): String = host.trim().lowercase().trimEnd('.')

    private fun inList(host: String, list: Set<String>): Boolean =
        list.any { entry -> host == entry || host.endsWith(".$entry") }

    /** True when requests to [host] use the browser-like connection. */
    fun applies(host: String?): Boolean {
        if (host.isNullOrEmpty()) return false
        val current = sites
        if (current.isEmpty()) return false
        val name = normalize(host)
        return inList(name, current) && !inList(name, never)
    }

    fun load(context: Context) {
        if (loaded) return
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        sites = readList(prefs.getString(KEY_SITES, null))
        never = readList(prefs.getString(KEY_NEVER, null))
        loaded = true
    }

    fun configure(context: Context, newSites: List<String>, newNever: List<String>) {
        val cleanSites = newSites.map(::normalize).filter { it.isNotEmpty() }.toSet()
        val cleanNever = newNever.map(::normalize).filter { it.isNotEmpty() }.toSet()
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
            .putString(KEY_SITES, JSONArray(cleanSites.toList()).toString())
            .putString(KEY_NEVER, JSONArray(cleanNever.toList()).toString())
            .apply()
        never = cleanNever
        sites = cleanSites
        loaded = true
        // Open connections keep the TLS setup they were made with.
        runCatching { DohOkHttpFactory.instance?.evictConnections() }
    }

    private fun readList(text: String?): Set<String> = runCatching {
        val array = JSONArray(text ?: "[]")
        (0 until array.length()).map { normalize(array.getString(it)) }.filter { it.isNotEmpty() }.toSet()
    }.getOrDefault(emptySet())

    /**
     * Adds the per-site TLS setup and header order to a client builder. Hosts
     * that are not listed get the platform's sockets unchanged. When the
     * platform trust manager cannot be read, the builder is returned as it was.
     */
    fun install(builder: OkHttpClient.Builder): OkHttpClient.Builder = try {
        val factory = TrustManagerFactory.getInstance(TrustManagerFactory.getDefaultAlgorithm())
        factory.init(null as KeyStore?)
        val trustManager = factory.trustManagers.first { it is X509TrustManager } as X509TrustManager
        val context = SSLContext.getInstance("TLS")
        context.init(null, arrayOf(trustManager), null)
        builder
            .sslSocketFactory(ChromeTlsSocketFactory(context.socketFactory), trustManager)
            .addNetworkInterceptor(HeaderInterceptor)
    } catch (error: Exception) {
        VegaLog.w("BrowserLike", "Browser-like connection unavailable: ${error.message}")
        builder
    }

    internal fun configureSocket(socket: Socket, host: String?): Socket {
        if (socket !is SSLSocket || !applies(host)) return socket
        runCatching {
            val supported = socket.supportedCipherSuites.toHashSet()
            val suites = CHROME_CIPHER_SUITES.filter { it in supported }
            if (suites.isNotEmpty()) socket.enabledCipherSuites = suites.toTypedArray()
            val protocols = socket.supportedProtocols.toHashSet()
            val versions = CHROME_TLS_VERSIONS.filter { it in protocols }
            if (versions.isNotEmpty()) socket.enabledProtocols = versions.toTypedArray()
        }
        return socket
    }

    private class ChromeTlsSocketFactory(private val delegate: SSLSocketFactory) : SSLSocketFactory() {
        override fun getDefaultCipherSuites(): Array<String> = delegate.defaultCipherSuites
        override fun getSupportedCipherSuites(): Array<String> = delegate.supportedCipherSuites
        override fun createSocket(): Socket = delegate.createSocket()
        override fun createSocket(socket: Socket?, host: String?, port: Int, autoClose: Boolean): Socket =
            configureSocket(delegate.createSocket(socket, host, port, autoClose), host)
        override fun createSocket(host: String?, port: Int): Socket =
            configureSocket(delegate.createSocket(host, port), host)
        override fun createSocket(host: String?, port: Int, localHost: InetAddress?, localPort: Int): Socket =
            configureSocket(delegate.createSocket(host, port, localHost, localPort), host)
        override fun createSocket(host: InetAddress?, port: Int): Socket = delegate.createSocket(host, port)
        override fun createSocket(address: InetAddress?, port: Int, localAddress: InetAddress?, localPort: Int): Socket =
            delegate.createSocket(address, port, localAddress, localPort)
    }

    /** Chrome's headers in Chrome's order, for listed hosts. Runs after OkHttp adds its own. */
    private object HeaderInterceptor : Interceptor {
        override fun intercept(chain: Interceptor.Chain): Response {
            val request = chain.request()
            if (!applies(request.url.host)) return chain.proceed(request)
            return chain.proceed(chromeRequest(request))
        }
    }

    internal fun chromeRequest(request: Request): Request {
        val pairs = request.headers.map { (name, value) -> name to value }.toMutableList()
        fun has(name: String) = pairs.any { it.first.equals(name, ignoreCase = true) }
        fun put(name: String, value: String) {
            pairs.removeAll { it.first.equals(name, ignoreCase = true) }
            pairs.add(name to value)
        }
        val userAgent = pairs.firstOrNull { it.first.equals("User-Agent", true) }?.second
        if (userAgent == null || !userAgent.contains("Chrome/")) put("User-Agent", CHROME_USER_AGENT)
        if (!has("sec-ch-ua")) put("sec-ch-ua", CHROME_SEC_CH_UA)
        if (!has("sec-ch-ua-mobile")) put("sec-ch-ua-mobile", "?1")
        if (!has("sec-ch-ua-platform")) put("sec-ch-ua-platform", "\"Android\"")
        val navigation = request.method == "GET" && !has("Range") && !has("Origin")
        if (navigation) {
            if (!has("Upgrade-Insecure-Requests")) put("Upgrade-Insecure-Requests", "1")
            if (!has("Accept")) put("Accept", CHROME_ACCEPT)
            if (!has("Sec-Fetch-Site")) put("Sec-Fetch-Site", if (has("Referer")) "same-origin" else "none")
            if (!has("Sec-Fetch-Mode")) put("Sec-Fetch-Mode", "navigate")
            if (!has("Sec-Fetch-User")) put("Sec-Fetch-User", "?1")
            if (!has("Sec-Fetch-Dest")) put("Sec-Fetch-Dest", "document")
            if (!has("Priority")) put("Priority", "u=0, i")
        } else if (!has("Accept")) {
            put("Accept", "*/*")
        }
        if (!has("Accept-Language")) put("Accept-Language", "en-US,en;q=0.9")
        val ordered = pairs.withIndex().sortedWith(
            compareBy<IndexedValue<Pair<String, String>>>(
                { HEADER_ORDER.indexOf(it.value.first.lowercase()).let { rank -> if (rank < 0) HEADER_ORDER.size else rank } },
                { it.index },
            ),
        )
        val builder = request.newBuilder()
        pairs.map { it.first }.distinct().forEach { builder.removeHeader(it) }
        ordered.forEach { builder.addHeader(it.value.first, it.value.second) }
        return builder.build()
    }
}
