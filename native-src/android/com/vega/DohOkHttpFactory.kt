package com.vega

import android.util.Log
import com.facebook.react.modules.network.OkHttpClientFactory
import com.facebook.react.modules.network.ReactCookieJarContainer
import okhttp3.Cache
import okhttp3.ConnectionPool
import okhttp3.Dns
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.OkHttpClient
import okhttp3.dnsoverhttps.DnsOverHttps
import java.io.EOFException
import java.io.File
import java.io.IOException
import java.io.InputStream
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.Proxy
import java.net.ProxySelector
import java.net.Socket
import java.net.SocketAddress
import java.net.URI
import java.net.UnknownHostException
import java.util.concurrent.TimeUnit
import javax.net.SocketFactory

private const val TAG = "DohOkHttpFactory"

enum class DohProvider(val displayName: String, val url: String, val bootstrapIps: List<String>) {
    CLOUDFLARE("Cloudflare", "https://1.1.1.1/dns-query", listOf("1.1.1.1", "1.0.0.1")),
    GOOGLE("Google", "https://dns.google/dns-query", listOf("8.8.8.8", "8.8.4.4")),
    ADGUARD("AdGuard", "https://dns.adguard-dns.com/dns-query", listOf("94.140.14.14", "94.140.15.15")),
}

class DohOkHttpFactory(private val cacheDir: File) : OkHttpClientFactory {

    companion object {
        @Volatile
        var instance: DohOkHttpFactory? = null
            private set
    }

    init {
        instance = this
    }

    @Volatile
    var enabled: Boolean = true

    @Volatile
    var currentProvider: DohProvider = DohProvider.CLOUDFLARE

    @Volatile
    var customUrl: String? = null

    @Volatile
    var warpProxyPort: Int? = null

    @Volatile
    var byeDpiProxyPort: Int? = null

    // Every client made here (network module, Fresco images, downloads) shares one pool, so
    // turning WARP or ByeDPI on or off can drop all open connections. Otherwise a client keeps
    // reusing connections opened before the switch, which bypass the new route.
    private val connectionPool = ConnectionPool()

    fun evictConnections() {
        connectionPool.evictAll()
    }

    private var cachedDoh: DnsOverHttps? = null
    private var lastConfigKey: String = ""

    /** The resolver for a direct connection: what the user chose in Settings. */
    private fun getActiveDns(): Dns {
        if (!enabled) return Dns.SYSTEM
        return getDohDns()
    }

    /**
     * DNS over HTTPS, even when the user turned it off: ByeDPI connects to the
     * address resolved here, and ISP DNS returns the block page address for
     * blocked sites.
     */
    @Synchronized
    private fun getDohDns(): Dns {
        val configKey = "${currentProvider.name}_$customUrl"
        if (cachedDoh != null && lastConfigKey == configKey) {
            return FallbackDns(cachedDoh!!)
        }

        return try {
            val dnsCache = Cache(File(cacheDir, "dns_cache"), 5L * 1024 * 1024)
            val bootstrapClient = OkHttpClient.Builder()
                .cache(dnsCache)
                .connectTimeout(10, TimeUnit.SECONDS)
                .readTimeout(10, TimeUnit.SECONDS)
                .build()

            val url = customUrl?.takeIf { it.isNotBlank() } ?: currentProvider.url

            val builder = DnsOverHttps.Builder()
                .client(bootstrapClient)
                .url(url.toHttpUrl())

            if (customUrl == null || customUrl!!.isBlank()) {
                val ips = currentProvider.bootstrapIps.map { InetAddress.getByName(it) }
                builder.bootstrapDnsHosts(ips)
            }

            val doh = builder.build()
            VegaLog.i(TAG, "DoH configured with ${customUrl ?: currentProvider.displayName}")
            
            cachedDoh = doh
            lastConfigKey = configKey
            FallbackDns(doh)
        } catch (e: Exception) {
            VegaLog.e(TAG, "Failed to build DoH, falling back to system DNS", e)
            Dns.SYSTEM
        }
    }

    private inner class DynamicDns : Dns {
        override fun lookup(hostname: String): List<InetAddress> {
            val addresses = if (SmartUnblock.routeFor(hostname) == UnblockRoute.BYEDPI) {
                getDohDns().lookup(hostname)
            } else {
                lookupDirect(hostname)
            }
            // Keep the name on each address: ByeDpiSocket picks the route by it.
            return addresses.map { address ->
                InetAddress.getByAddress(hostname, address.address)
            }
        }

        /**
         * Smart unblock: when the resolver fails or gives only block addresses
         * while DNS over HTTPS resolves the name, the network is blocking it.
         */
        private fun lookupDirect(hostname: String): List<InetAddress> {
            val dns = getActiveDns()
            if (!SmartUnblock.watchesDns(hostname)) return dns.lookup(hostname)
            val system = try {
                dns.lookup(hostname)
            } catch (e: UnknownHostException) {
                null
            }
            if (!system.isNullOrEmpty() && system.none { SmartUnblock.isSinkhole(it) }) return system
            val doh = try {
                getDohDns().lookup(hostname)
            } catch (e: Exception) {
                null
            }
            if (SmartUnblock.looksDnsBlocked(system, doh)) throw DnsBlockedException(hostname)
            return system ?: throw UnknownHostException(hostname)
        }
    }

    override fun createNewNetworkModuleClient(): OkHttpClient {
        return OkHttpClient.Builder()
            .dns(DynamicDns())
            .connectionPool(connectionPool)
            .retryOnConnectionFailure(true)
            .cookieJar(ReactCookieJarContainer())
            .socketFactory(ByeDpiSocketFactory())
            // Smart unblock: direct, ByeDPI or WARP per host, and a retry on the next
            // route when a request looks blocked. Clients made from this one with
            // newBuilder() (downloads, the video player) keep all of it.
            .addInterceptor(SmartUnblock.RetryInterceptor)
            .eventListener(UnblockPhase)
            .proxySelector(object : ProxySelector() {
                override fun select(uri: URI?): List<Proxy> = SmartUnblock.proxyFor(uri?.host)

                override fun connectFailed(uri: URI?, sa: SocketAddress?, ioe: IOException?) {
                    // One failed site is not a dead proxy; WarpModule clears the port when the
                    // proxy process exits.
                    VegaLog.w(TAG, "Proxy connection failed for $uri: ${ioe?.message}")
                }
            })
            .connectTimeout(30, TimeUnit.SECONDS)
            .readTimeout(30, TimeUnit.SECONDS)
            .writeTimeout(30, TimeUnit.SECONDS)
            .build()
    }
}

class ByeDpiSocketFactory : SocketFactory() {
    override fun createSocket(): Socket {
        return ByeDpiSocket()
    }

    override fun createSocket(host: String?, port: Int): Socket {
        val socket = ByeDpiSocket()
        socket.connect(InetSocketAddress(host, port))
        return socket
    }

    override fun createSocket(host: String?, port: Int, localHost: InetAddress?, localPort: Int): Socket {
        val socket = ByeDpiSocket()
        socket.bind(InetSocketAddress(localHost, localPort))
        socket.connect(InetSocketAddress(host, port))
        return socket
    }

    override fun createSocket(host: InetAddress?, port: Int): Socket {
        val socket = ByeDpiSocket()
        socket.connect(InetSocketAddress(host, port))
        return socket
    }

    override fun createSocket(address: InetAddress?, port: Int, localAddress: InetAddress?, localPort: Int): Socket {
        val socket = ByeDpiSocket()
        socket.bind(InetSocketAddress(localAddress, localPort))
        socket.connect(InetSocketAddress(address, port))
        return socket
    }
}

class ByeDpiSocket : Socket() {

    // The proxy this socket goes through, so Smart unblock knows the proxy is in use.
    @Volatile
    private var countedRoute: UnblockRoute? = null

    override fun close() {
        val route = countedRoute
        countedRoute = null
        try {
            super.close()
        } finally {
            if (route != null) SmartUnblock.socketClosed(route)
        }
    }

    override fun connect(endpoint: SocketAddress?, timeout: Int) {
        val inetEndpoint = endpoint as? InetSocketAddress

        val hostAddress = inetEndpoint?.address
        val hostName = inetEndpoint?.hostString?.lowercase()
        val isLocal = hostName == "127.0.0.1" || hostName == "localhost" ||
                hostAddress?.isLoopbackAddress == true

        if (isLocal || inetEndpoint == null || hostName == null) {
            super.connect(endpoint, timeout)
            val warpPort = DohOkHttpFactory.instance?.warpProxyPort
            if (inetEndpoint != null && warpPort != null && inetEndpoint.port == warpPort) {
                countedRoute = UnblockRoute.WARP
                SmartUnblock.socketOpened(UnblockRoute.WARP)
            }
            return
        }

        val byeDpiPort = if (SmartUnblock.routeFor(hostName) == UnblockRoute.BYEDPI) {
            SmartUnblock.byeDpiPort(start = true)
        } else {
            null
        }
        if (byeDpiPort == null || byeDpiPort <= 0) {
            super.connect(endpoint, timeout)
            return
        }

        try {
            // 1. Connect underlying socket to local ByeDPI proxy
            super.connect(InetSocketAddress("127.0.0.1", byeDpiPort), timeout)
        } catch (e: Exception) {
            // ByeDpiModule clears the port when the process exits; a failure here must not
            // silently switch every later connection to direct.
            VegaLog.w(TAG, "ByeDPI connection failed on port $byeDpiPort: ${e.message}")
            throw e
        }

        val oldSoTimeout = soTimeout
        soTimeout = if (timeout > 0) timeout else 10000

        try {
            val input = getInputStream()
            val output = getOutputStream()

            // 2. SOCKS5 greeting: VER=5, NMETHODS=1, METHOD=0 (No Authentication)
            output.write(byteArrayOf(0x05, 0x01, 0x00))
            output.flush()

            val greetingResp = ByteArray(2)
            readFully(input, greetingResp)
            if (greetingResp[0] != 0x05.toByte() || greetingResp[1] != 0x00.toByte()) {
                throw IOException("SOCKS5 greeting failed: ver=${greetingResp[0]}, auth=${greetingResp[1]}")
            }

            // 3. SOCKS5 request: VER=5, CMD=1 (CONNECT), RSV=0, ATYP
            val targetPort = inetEndpoint.port
            val targetIp = hostAddress?.address

            if (targetIp != null) {
                // Pass the DoH-resolved IP directly (IPv4 or IPv6) so ByeDPI skips local DNS
                val isIpv4 = targetIp.size == 4
                val atyp = if (isIpv4) 0x01.toByte() else 0x04.toByte()
                val req = ByteArray(4 + targetIp.size + 2)
                req[0] = 0x05
                req[1] = 0x01
                req[2] = 0x00
                req[3] = atyp
                System.arraycopy(targetIp, 0, req, 4, targetIp.size)
                req[req.size - 2] = (targetPort ushr 8).toByte()
                req[req.size - 1] = (targetPort and 0xFF).toByte()
                output.write(req)
                output.flush()
            } else {
                val domainBytes = (inetEndpoint.hostString ?: "").toByteArray(Charsets.UTF_8)
                val req = ByteArray(4 + 1 + domainBytes.size + 2)
                req[0] = 0x05
                req[1] = 0x01
                req[2] = 0x00
                req[3] = 0x03.toByte() // DOMAIN
                req[4] = domainBytes.size.toByte()
                System.arraycopy(domainBytes, 0, req, 5, domainBytes.size)
                req[req.size - 2] = (targetPort ushr 8).toByte()
                req[req.size - 1] = (targetPort and 0xFF).toByte()
                output.write(req)
                output.flush()
            }

            // 4. SOCKS5 response header: VER, REP, RSV, ATYP
            val respHeader = ByteArray(4)
            readFully(input, respHeader)
            val rep = respHeader[1].toInt() and 0xFF
            if (rep != 0x00) {
                throw IOException("SOCKS5 connect error code: $rep")
            }

            // Consume bound address
            when (respHeader[3].toInt() and 0xFF) {
                0x01 -> { // IPv4: 4 bytes IP + 2 bytes port
                    val bnd = ByteArray(6)
                    readFully(input, bnd)
                }
                0x03 -> { // Domain: 1 byte len + len bytes + 2 bytes port
                    val len = input.read()
                    if (len < 0) throw EOFException("Unexpected EOF reading SOCKS5 domain length")
                    val bnd = ByteArray(len + 2)
                    readFully(input, bnd)
                }
                0x04 -> { // IPv6: 16 bytes IP + 2 bytes port
                    val bnd = ByteArray(18)
                    readFully(input, bnd)
                }
                else -> {
                    throw IOException("Unsupported SOCKS5 ATYP: ${respHeader[3]}")
                }
            }
            countedRoute = UnblockRoute.BYEDPI
            SmartUnblock.socketOpened(UnblockRoute.BYEDPI)
        } catch (e: Exception) {
            // Usually one unreachable address; OkHttp tries the next one, still through ByeDPI.
            VegaLog.w(TAG, "ByeDPI handshake failed on port $byeDpiPort: ${e.message}")
            throw e
        } finally {
            soTimeout = oldSoTimeout
        }
    }

    private fun readFully(input: InputStream, buffer: ByteArray) {
        var offset = 0
        while (offset < buffer.size) {
            val bytesRead = input.read(buffer, offset, buffer.size - offset)
            if (bytesRead < 0) {
                throw EOFException("Unexpected EOF during SOCKS5 handshake")
            }
            offset += bytesRead
        }
    }
}

private class FallbackDns(private val primary: DnsOverHttps) : Dns {
    override fun lookup(hostname: String): List<InetAddress> {
        return try {
            Nat64Dns.networkAddresses(primary.lookup(hostname))
        } catch (e: UnknownHostException) {
            VegaLog.w(TAG, "DoH lookup failed for $hostname, falling back to system DNS")
            Dns.SYSTEM.lookup(hostname)
        } catch (e: Exception) {
            VegaLog.w(TAG, "DoH error for $hostname, falling back to system DNS", e)
            Dns.SYSTEM.lookup(hostname)
        }
    }
}
