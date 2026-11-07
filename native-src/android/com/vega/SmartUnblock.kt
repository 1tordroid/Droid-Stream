package com.vega

import okhttp3.Call
import okhttp3.EventListener
import okhttp3.Response
import org.json.JSONArray
import org.json.JSONObject
import java.io.EOFException
import java.io.IOException
import java.io.InterruptedIOException
import java.net.Inet4Address
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.Proxy
import java.net.SocketException
import java.net.SocketTimeoutException
import java.net.UnknownHostException
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicLong
import javax.net.ssl.SSLException
import javax.net.ssl.SSLHandshakeException
import javax.net.ssl.SSLPeerUnverifiedException

private const val TAG = "SmartUnblock"

enum class UnblockRoute(val key: String) {
    DIRECT("direct"),
    BYEDPI("byedpi"),
    WARP("warp");

    companion object {
        fun of(key: String?): UnblockRoute? = values().firstOrNull { it.key == key }
    }
}

/** The network's resolver gave a block address for a name DNS over HTTPS resolves. */
class DnsBlockedException(host: String) : UnknownHostException("$host is blocked by the network's DNS")

/**
 * Smart unblock: picks direct, ByeDPI or WARP for each host, retries a request
 * that looked blocked on the next route, and starts each proxy only when a
 * host needs it. The rules mirror src/lib/unblock/routing.ts and
 * blockMatcher.ts; the host lists and block patterns come from JS.
 */
internal object SmartUnblock {
    private const val ROUTE_TTL_MS = 7L * 24 * 60 * 60 * 1000
    private const val IDLE_STOP_MS = 5L * 60 * 1000
    private const val START_RETRY_MS = 60L * 1000

    private class Remembered(val route: UnblockRoute, val until: Long)

    private class Rules(
        val maxBodyBytes: Long,
        val statusCodes: Set<Int>,
        val pages: List<Pair<String, List<Regex>>>,
        val redirects: List<Pair<String, Regex>>,
        val sinkholes: List<Pair<Long, Long>>,
        val blockPageIps: Set<String>,
    )

    private class Attempt(val host: String, val route: UnblockRoute)

    @Volatile var mode: String = "off"
        private set
    @Volatile private var warpConsent = false
    @Volatile private var byeDpiArgs: String? = null
    @Volatile private var debridHosts: List<String> = emptyList()
    @Volatile private var keepDirectHosts: List<String> = emptyList()
    @Volatile private var rules: Rules? = null
    private val routes = ConcurrentHashMap<String, Remembered>()
    private val routedThisSession = ConcurrentHashMap.newKeySet<String>()
    private val attempt = ThreadLocal<Attempt?>()

    /** Sends events to JS; set by DohModule. */
    @Volatile var emitter: ((event: String, host: String, route: UnblockRoute?, learned: Boolean) -> Unit)? = null

    // Proxy use, for stopping an idle proxy in Auto.
    private val openSockets = mapOf(UnblockRoute.BYEDPI to AtomicInteger(), UnblockRoute.WARP to AtomicInteger())
    private val lastUsed = mapOf(UnblockRoute.BYEDPI to AtomicLong(), UnblockRoute.WARP to AtomicLong())
    private val lastFailedStart = mapOf(UnblockRoute.BYEDPI to AtomicLong(), UnblockRoute.WARP to AtomicLong())

    private val idleChecker = Executors.newSingleThreadScheduledExecutor { task ->
        Thread(task, "Vega-unblock-idle").apply { isDaemon = true }
    }

    init {
        idleChecker.scheduleWithFixedDelay({ stopIdleProxies() }, 60, 60, TimeUnit.SECONDS)
    }

    // ---- Configuration from JS ----

    /** Applies the whole configuration, or nothing when any part is missing. */
    fun configure(json: String) {
        val config = JSONObject(json)
        val nextMode = config.getString("mode")
        require(nextMode in setOf("auto", "byedpi", "warp", "off")) { "Unknown mode $nextMode" }
        val nextDebrid = config.getJSONArray("debridHosts").strings()
        require(nextDebrid.isNotEmpty()) { "Debrid host list is empty" }
        val nextKeepDirect = config.getJSONArray("keepDirectHosts").strings()
        val nextRules = parseRules(config.getJSONObject("rules"))
        val nextRoutes = HashMap<String, Remembered>()
        config.optJSONObject("routes")?.let { table ->
            for (host in table.keys()) {
                val entry = table.optJSONObject(host) ?: continue
                val route = UnblockRoute.of(entry.optString("route")) ?: continue
                if (route == UnblockRoute.DIRECT) continue
                nextRoutes[normalize(host)] = Remembered(route, entry.optLong("until"))
            }
        }

        val changed = nextMode != mode
        debridHosts = nextDebrid
        keepDirectHosts = nextKeepDirect
        rules = nextRules
        warpConsent = config.optBoolean("warpConsent", false)
        byeDpiArgs = config.optString("byeDpiArgs").takeIf { it.isNotBlank() }
        routes.clear()
        routes.putAll(nextRoutes)
        mode = nextMode
        // Connections opened under the old mode would keep their old route.
        if (changed) DohOkHttpFactory.instance?.evictConnections()
        VegaLog.i(TAG, "Mode $mode, ${routes.size} remembered hosts, WARP agreed: $warpConsent")
    }

    fun forget(host: String) {
        routes.remove(normalize(host))
        routedThisSession.remove(normalize(host))
        DohOkHttpFactory.instance?.evictConnections()
    }

    private fun JSONArray.strings(): List<String> =
        (0 until length()).map { normalize(getString(it)) }.filter { it.isNotEmpty() }

    private fun parseRules(json: JSONObject): Rules {
        val pages = json.getJSONArray("pages")
        val redirects = json.getJSONArray("redirects")
        val statusCodes = json.getJSONArray("statusCodes")
        return Rules(
            maxBodyBytes = json.getLong("maxBodyBytes"),
            statusCodes = (0 until statusCodes.length()).map { statusCodes.getInt(it) }.toSet(),
            pages = (0 until pages.length()).map { index ->
                val page = pages.getJSONObject(index)
                val all = page.getJSONArray("all")
                page.getString("id") to (0 until all.length()).map { Regex(all.getString(it), RegexOption.IGNORE_CASE) }
            },
            redirects = (0 until redirects.length()).map { index ->
                val redirect = redirects.getJSONObject(index)
                redirect.getString("id") to Regex(redirect.getString("url"), RegexOption.IGNORE_CASE)
            },
            sinkholes = json.getJSONArray("sinkholeCidrs").strings().mapNotNull { cidr(it) },
            blockPageIps = json.getJSONArray("blockPageIps").strings().toSet(),
        )
    }

    // ---- Host rules (same as routing.ts) ----

    fun normalize(host: String): String = host.trim().lowercase().removeSuffix(".")

    private fun inList(host: String, list: List<String>) =
        list.any { host == it || host.endsWith(".$it") }

    fun isLocal(host: String): Boolean {
        val name = normalize(host).removePrefix("[").removeSuffix("]")
        if (name == "localhost" || name.endsWith(".localhost") || name.endsWith(".local")) return true
        if (name == "::1" || Regex("^f[cd][0-9a-f]{2}:").containsMatchIn(name) || name.startsWith("fe80:")) return true
        val parts = name.split('.')
        if (parts.size != 4) return false
        val bytes = parts.map { it.toIntOrNull() ?: return false }
        if (bytes.any { it !in 0..255 }) return false
        val (a, b) = bytes
        return a == 127 || a == 10 || a == 0 || (a == 192 && b == 168) ||
            (a == 172 && b in 16..31) || (a == 169 && b == 254)
    }

    /** The routes to try for host, in order. */
    fun plan(host: String, now: Long = System.currentTimeMillis()): List<UnblockRoute> {
        val name = normalize(host)
        val direct = listOf(UnblockRoute.DIRECT)
        if (name.isEmpty() || isLocal(name) || mode == "off") return direct
        if (mode == "byedpi") return listOf(UnblockRoute.BYEDPI)
        val debrid = inList(name, debridHosts)
        if (mode == "warp") {
            return when {
                debrid -> listOf(UnblockRoute.DIRECT, UnblockRoute.BYEDPI)
                inList(name, keepDirectHosts) -> listOf(UnblockRoute.DIRECT, UnblockRoute.BYEDPI, UnblockRoute.WARP)
                else -> listOf(UnblockRoute.WARP)
            }
        }
        if (mode != "auto") return direct
        val allowed = if (debrid || !warpConsent) {
            listOf(UnblockRoute.DIRECT, UnblockRoute.BYEDPI)
        } else {
            listOf(UnblockRoute.DIRECT, UnblockRoute.BYEDPI, UnblockRoute.WARP)
        }
        val remembered = routes[name]
        if (remembered != null && remembered.until > now && remembered.route in allowed) {
            return allowed.subList(allowed.indexOf(remembered.route), allowed.size)
        }
        return allowed
    }

    /** The route a connection to host takes right now. */
    fun routeFor(host: String): UnblockRoute {
        val name = normalize(host)
        attempt.get()?.let { if (it.host == name) return it.route }
        return plan(name).first()
    }

    /** Direct has a fallback for host, so a DNS block is worth checking for. */
    fun watchesDns(host: String): Boolean {
        val name = normalize(host)
        if (routeFor(name) != UnblockRoute.DIRECT) return false
        return plan(name).size > 1
    }

    // ---- Proxies ----

    /** The ByeDPI port, starting ByeDPI first when allowed. */
    fun byeDpiPort(start: Boolean): Int? {
        DohOkHttpFactory.instance?.byeDpiProxyPort?.let {
            touch(UnblockRoute.BYEDPI)
            return it
        }
        if (!start || mode == "off" || recentlyFailed(UnblockRoute.BYEDPI)) return null
        val module = ByeDpiModule.active ?: return null
        return try {
            VegaLog.i(TAG, "Starting ByeDPI for a blocked site")
            module.startSync(byeDpiArgs).also { touch(UnblockRoute.BYEDPI) }
        } catch (e: Exception) {
            lastFailedStart.getValue(UnblockRoute.BYEDPI).set(System.currentTimeMillis())
            VegaLog.w(TAG, "ByeDPI did not start: ${e.message}")
            null
        }
    }

    /** The WARP port, starting WARP first when the user agreed to it. */
    fun warpPort(start: Boolean): Int? {
        DohOkHttpFactory.instance?.warpProxyPort?.let {
            touch(UnblockRoute.WARP)
            return it
        }
        val allowed = mode == "warp" || (mode == "auto" && warpConsent)
        if (!start || !allowed || recentlyFailed(UnblockRoute.WARP)) return null
        val module = WarpModule.active ?: return null
        return try {
            VegaLog.i(TAG, "Starting WARP for a blocked site")
            module.startSync().also { touch(UnblockRoute.WARP) }
        } catch (e: Exception) {
            lastFailedStart.getValue(UnblockRoute.WARP).set(System.currentTimeMillis())
            VegaLog.w(TAG, "WARP did not start: ${e.message}")
            null
        }
    }

    private fun recentlyFailed(route: UnblockRoute) =
        System.currentTimeMillis() - lastFailedStart.getValue(route).get() < START_RETRY_MS

    private fun touch(route: UnblockRoute) {
        lastUsed[route]?.set(System.currentTimeMillis())
    }

    fun socketOpened(route: UnblockRoute) {
        openSockets[route]?.incrementAndGet()
        touch(route)
    }

    fun socketClosed(route: UnblockRoute) {
        openSockets[route]?.decrementAndGet()
        touch(route)
    }

    /** In Auto, stops a proxy nothing has used for a while. */
    private fun stopIdleProxies() {
        if (mode != "auto") return
        val now = System.currentTimeMillis()
        val factory = DohOkHttpFactory.instance ?: return
        fun idle(route: UnblockRoute) =
            openSockets.getValue(route).get() <= 0 && now - lastUsed.getValue(route).get() > IDLE_STOP_MS
        try {
            if (factory.byeDpiProxyPort != null && idle(UnblockRoute.BYEDPI)) {
                VegaLog.i(TAG, "Stopping idle ByeDPI")
                ByeDpiModule.active?.stopSync()
            }
            if (factory.warpProxyPort != null && idle(UnblockRoute.WARP)) {
                VegaLog.i(TAG, "Stopping idle WARP")
                WarpModule.active?.stopSync()
            }
        } catch (e: Exception) {
            VegaLog.w(TAG, "Idle proxy check failed: ${e.message}")
        }
    }

    // ---- Block detection (same as blockMatcher.ts) ----

    private fun cidr(text: String): Pair<Long, Long>? {
        val parts = text.split('/')
        if (parts.size != 2) return null
        val start = ipv4(parts[0]) ?: return null
        val bits = parts[1].toIntOrNull()?.takeIf { it in 0..32 } ?: return null
        val size = 1L shl (32 - bits)
        val first = start / size * size
        return first to first + size
    }

    private fun ipv4(text: String): Long? {
        val parts = text.split('.')
        if (parts.size != 4) return null
        var value = 0L
        for (part in parts) {
            val byte = part.toIntOrNull()?.takeIf { it in 0..255 } ?: return null
            value = value * 256 + byte
        }
        return value
    }

    fun isSinkhole(address: InetAddress): Boolean {
        val current = rules ?: return false
        val text = address.hostAddress ?: return false
        if (text in current.blockPageIps) return true
        if (address.isAnyLocalAddress || address.isLoopbackAddress) return true
        if (address !is Inet4Address) return false
        val value = ipv4(text) ?: return false
        return current.sinkholes.any { (first, end) -> value in first until end }
    }

    fun looksDnsBlocked(system: List<InetAddress>?, doh: List<InetAddress>?): Boolean {
        val real = doh.orEmpty().filter { !isSinkhole(it) }
        if (real.isEmpty()) return false
        if (system.isNullOrEmpty()) return true
        val realText = real.mapNotNull { it.hostAddress }.toSet()
        return system.all { isSinkhole(it) } && system.none { it.hostAddress in realText }
    }

    private fun pageText(html: String): String = html
        .replace(Regex("<(script|style)[\\s\\S]*?</\\1>", RegexOption.IGNORE_CASE), " ")
        .replace(Regex("<[^>]+>"), " ")
        .replace(Regex("&nbsp;|&#160;", RegexOption.IGNORE_CASE), " ")
        .replace(Regex("&amp;", RegexOption.IGNORE_CASE), "&")
        .replace(Regex("\\s+"), " ")

    /** The id of the block signature this response matches, if any. */
    fun blockPage(response: Response): String? {
        val current = rules ?: return null
        if (response.code in current.statusCodes) return "status-${response.code}"

        val urls = ArrayList<String>()
        var hop: Response? = response
        while (hop != null) {
            urls.add(hop.request.url.toString())
            hop = hop.priorResponse
        }
        urls.reverse()
        val origin = urls.firstOrNull()?.let { it.toHttpHost() }
        for (url in urls.drop(1)) {
            if (url.toHttpHost() == origin) continue
            current.redirects.firstOrNull { it.second.containsMatchIn(url) }?.let { return it.first }
        }

        val type = response.header("Content-Type")
        if (type != null && !Regex("text/html|application/xhtml|text/plain", RegexOption.IGNORE_CASE).containsMatchIn(type)) {
            return null
        }
        val length = response.body?.contentLength() ?: return null
        // A real HTTPS site can stream a long page; only a page of known small
        // size is read. Plain HTTP pages are injected by the ISP, so read those too.
        if (length > current.maxBodyBytes) return null
        if (length < 0 && response.request.isHttps) return null
        val peeked = try {
            response.peekBody(current.maxBodyBytes + 1)
        } catch (_: IOException) {
            return null
        }
        if (peeked.contentLength() > current.maxBodyBytes) return null
        val text = pageText(peeked.string())
        return current.pages.firstOrNull { (_, all) -> all.all { it.containsMatchIn(text) } }?.first
    }

    private fun String.toHttpHost(): String =
        Regex("^[a-z][a-z0-9+.-]*://([^/?#:]+)", RegexOption.IGNORE_CASE).find(this)?.groupValues?.get(1)?.lowercase() ?: ""

    private fun isReset(e: Throwable?): Boolean {
        var cause = e
        while (cause != null) {
            val message = cause.message.orEmpty().lowercase()
            if (message.contains("reset") || message.contains("broken pipe") ||
                message.contains("connection abort") || message.contains("unexpected end of stream")
            ) return true
            if (cause is EOFException) return true
            cause = cause.cause
        }
        return false
    }

    /** True when a failed attempt looks like the network blocking the site. */
    private fun looksBlocked(e: IOException, route: UnblockRoute, phase: UnblockPhase.Phase?, https: Boolean): Boolean {
        if (e is DnsBlockedException) return true
        if (route != UnblockRoute.DIRECT) {
            // Through a proxy, try the next one unless the site only answered slowly.
            return !(e is SocketTimeoutException && phase == UnblockPhase.Phase.RESPONSE)
        }
        return when (phase) {
            // Reset, dropped or answered with the wrong certificate during the
            // handshake: SNI filtering or interception.
            UnblockPhase.Phase.TLS -> true
            UnblockPhase.Phase.CONNECT -> isReset(e)
            UnblockPhase.Phase.REQUEST, UnblockPhase.Phase.RESPONSE -> !https && isReset(e)
            UnblockPhase.Phase.DNS, UnblockPhase.Phase.CONNECTED -> false
            null -> e is SSLHandshakeException || e is SSLPeerUnverifiedException ||
                (e is SSLException && isReset(e)) || (e is SocketException && isReset(e))
        }
    }

    // ---- Requests ----

    /** Makes sure the proxy for route runs. False when it cannot be used now. */
    private fun ready(route: UnblockRoute): Boolean = when (route) {
        UnblockRoute.DIRECT -> true
        UnblockRoute.BYEDPI -> byeDpiPort(start = true) != null
        UnblockRoute.WARP -> warpPort(start = true) != null
    }

    private fun succeeded(host: String, route: UnblockRoute, plan: List<UnblockRoute>) {
        // A mode with one route has nothing to learn.
        if (plan.size <= 1) return
        if (route == UnblockRoute.DIRECT) {
            if (routes.remove(host) != null) {
                VegaLog.i(TAG, "$host opens directly again")
                emitter?.invoke("forget", host, null, false)
            }
            return
        }
        val now = System.currentTimeMillis()
        val previous = routes[host]
        val learned = previous == null || previous.route != route || previous.until <= now
        if (learned) routes[host] = Remembered(route, now + ROUTE_TTL_MS)
        val first = routedThisSession.add(host)
        if (learned || first) emitter?.invoke("routed", host, route, learned)
    }

    /** Retries a request that looked blocked on the next route of its host. */
    object RetryInterceptor : okhttp3.Interceptor {
        override fun intercept(chain: okhttp3.Interceptor.Chain): Response {
            val request = chain.request()
            val host = normalize(request.url.host)
            val fullPlan = plan(host)
            // A body that can only be sent once cannot be retried.
            val plan = if (request.body?.isOneShot() == true) fullPlan.take(1) else fullPlan
            if (plan.size == 1 && plan[0] == UnblockRoute.DIRECT) return chain.proceed(request)

            var lastError: IOException? = null
            for ((index, route) in plan.withIndex()) {
                val hasNext = index < plan.lastIndex
                if (chain.call().isCanceled()) throw lastError ?: IOException("Canceled")
                if (!ready(route)) {
                    // A fixed route with no proxy keeps the old behaviour: connect directly.
                    if (plan.size == 1) return chain.proceed(request)
                    continue
                }
                if (chain.call().isCanceled()) throw lastError ?: IOException("Canceled")
                val previous = attempt.get()
                attempt.set(Attempt(host, route))
                UnblockPhase.reset()
                try {
                    val response = chain.proceed(request)
                    val block = if (hasNext) blockPage(response) else null
                    if (block != null) {
                        VegaLog.i(TAG, "$host showed a block page ($block) over ${route.key}, trying ${plan[index + 1].key}")
                        response.close()
                        lastError = IOException("$host showed a block page")
                        continue
                    }
                    succeeded(host, route, fullPlan)
                    return response
                } catch (e: IOException) {
                    if (chain.call().isCanceled() || e is InterruptedIOException && e !is SocketTimeoutException) throw e
                    lastError = e
                    val phase = UnblockPhase.current()
                    if (!hasNext || !looksBlocked(e, route, phase, request.isHttps)) throw e
                    VegaLog.i(TAG, "$host looked blocked over ${route.key} (${phase ?: "unknown"}: ${e.message}), trying ${plan[index + 1].key}")
                } finally {
                    attempt.set(previous)
                }
            }
            throw lastError ?: IOException("No route to $host")
        }
    }

    /** The proxy for a new connection to uri's host. */
    fun proxyFor(host: String?): List<Proxy> {
        if (host == null || isLocal(host)) return listOf(Proxy.NO_PROXY)
        if (routeFor(host) == UnblockRoute.WARP) {
            val port = warpPort(start = true)
            if (port != null) {
                // WARP only: a direct fallback would quietly send requests past
                // WARP, straight into the block.
                return listOf(Proxy(Proxy.Type.HTTP, InetSocketAddress("127.0.0.1", port)))
            }
        }
        // ByeDPI connections are made by ByeDpiSocket after DNS over HTTPS.
        return listOf(Proxy.NO_PROXY)
    }
}

/**
 * Where the current attempt got to, so a failure can be told apart: a reset
 * during the TLS handshake is SNI filtering; a slow answer is not a block.
 * OkHttp 4 connects on the calling thread, so a thread-local is enough.
 */
internal object UnblockPhase : EventListener() {
    enum class Phase { DNS, CONNECT, TLS, CONNECTED, REQUEST, RESPONSE }

    private val phase = ThreadLocal<Phase?>()

    fun reset() = phase.set(null)
    fun current(): Phase? = phase.get()

    override fun dnsStart(call: Call, domainName: String) = phase.set(Phase.DNS)
    override fun connectStart(call: Call, inetSocketAddress: InetSocketAddress, proxy: Proxy) = phase.set(Phase.CONNECT)
    override fun secureConnectStart(call: Call) = phase.set(Phase.TLS)
    override fun secureConnectEnd(call: Call, handshake: okhttp3.Handshake?) = phase.set(Phase.CONNECTED)
    override fun connectionAcquired(call: Call, connection: okhttp3.Connection) = phase.set(Phase.CONNECTED)
    override fun requestHeadersStart(call: Call) = phase.set(Phase.REQUEST)
    override fun responseHeadersStart(call: Call) = phase.set(Phase.RESPONSE)
}
