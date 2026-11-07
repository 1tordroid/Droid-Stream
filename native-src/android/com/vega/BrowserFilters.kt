package com.vega

import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import java.io.File
import java.util.concurrent.ConcurrentHashMap
import java.util.regex.Pattern

/**
 * Network rules of the browser's ad and tracker blocker. Reads the compiled
 * lines that src/lib/browser/filters/parse.ts writes and matches requests
 * the same way as src/lib/browser/filters/engine.ts (the tested one); keep
 * the two in step.
 *
 * Line: action host regex token party typesIn typesOut domainsIn domainsOut flags
 */
class BrowserFilterRule(
    val exception: Boolean,
    val host: String,
    val regex: String,
    val token: String,
    val party: String,
    val typesIn: Int,
    val typesOut: Int,
    val domainsIn: List<String>,
    val domainsOut: List<String>,
    val flags: String,
) {
    @Volatile private var compiled: Pattern? = null
    @Volatile private var broken = false

    fun pattern(): Pattern? {
        if (broken) return null
        compiled?.let { return it }
        return try {
            val options = if (flags.contains('c')) 0 else Pattern.CASE_INSENSITIVE
            Pattern.compile(regex, options).also { compiled = it }
        } catch (_: Exception) {
            broken = true
            null
        }
    }

    companion object {
        fun parse(line: String): BrowserFilterRule? {
            val parts = line.split('\t')
            if (parts.size < 10 || (parts[0] != "b" && parts[0] != "e")) return null
            return BrowserFilterRule(
                exception = parts[0] == "e",
                host = parts[1],
                regex = parts[2],
                token = parts[3],
                party = parts[4],
                typesIn = parts[5].toIntOrNull() ?: 0,
                typesOut = parts[6].toIntOrNull() ?: 0,
                domainsIn = if (parts[7].isEmpty()) emptyList() else parts[7].split(','),
                domainsOut = if (parts[8].isEmpty()) emptyList() else parts[8].split(','),
                flags = parts[9],
            )
        }
    }
}

class BrowserFilters private constructor() {
    private class RuleSet {
        val byHost = HashMap<String, MutableList<BrowserFilterRule>>()
        val byToken = HashMap<String, MutableList<BrowserFilterRule>>()
        val generic = ArrayList<BrowserFilterRule>()

        fun add(rule: BrowserFilterRule) {
            when {
                rule.host.isNotEmpty() -> byHost.getOrPut(rule.host) { ArrayList(1) }.add(rule)
                rule.token.isNotEmpty() -> byToken.getOrPut(rule.token) { ArrayList(1) }.add(rule)
                else -> generic.add(rule)
            }
        }
    }

    private class Request(
        val url: String,
        val host: String,
        val pageHost: String,
        val type: Int,
        val thirdParty: Boolean,
    )

    private val blocks = RuleSet()
    private val important = RuleSet()
    private val exceptions = RuleSet()
    private val pageRules = ArrayList<BrowserFilterRule>()
    var size = 0
        private set

    private fun add(rule: BrowserFilterRule) {
        size++
        if (rule.exception && rule.flags.any { it == 'd' || it == 'g' || it == 'h' || it == 's' }) {
            pageRules.add(rule)
            return
        }
        when {
            rule.exception -> exceptions.add(rule)
            rule.flags.contains('i') -> important.add(rule)
            else -> blocks.add(rule)
        }
    }

    private fun optionsMatch(rule: BrowserFilterRule, request: Request): Boolean {
        if (rule.party == "3" && !request.thirdParty) return false
        if (rule.party == "1" && request.thirdParty) return false
        if (rule.typesIn != 0 && (rule.typesIn and request.type) == 0) return false
        if (rule.typesOut != 0 && (rule.typesOut and request.type) == request.type) return false
        if (rule.domainsOut.isNotEmpty() && rule.domainsOut.any { domainMatches(request.pageHost, it) }) return false
        if (rule.domainsIn.isNotEmpty() && rule.domainsIn.none { domainMatches(request.pageHost, it) }) return false
        if (rule.regex.isNotEmpty()) {
            val pattern = rule.pattern() ?: return false
            if (!pattern.matcher(request.url).find()) return false
        }
        return true
    }

    private fun findIn(set: RuleSet, request: Request, suffixes: List<String>, tokens: Collection<String>): BrowserFilterRule? {
        for (suffix in suffixes) {
            set.byHost[suffix]?.let { rules -> for (rule in rules) if (optionsMatch(rule, request)) return rule }
        }
        for (token in tokens) {
            set.byToken[token]?.let { rules -> for (rule in rules) if (optionsMatch(rule, request)) return rule }
        }
        for (rule in set.generic) if (optionsMatch(rule, request)) return rule
        return null
    }

    private fun request(url: String, pageUrl: String, type: Int): Request {
        val host = hostOf(url)
        val pageHost = hostOf(pageUrl)
        return Request(url, host, pageHost, type, pageHost.isNotEmpty() && site(host) != site(pageHost))
    }

    /** Page-wide exception flags: d (nothing blocked), g, h, s (element hiding off). */
    fun pageFlags(pageUrl: String): String {
        if (pageRules.isEmpty()) return ""
        val request = request(pageUrl, pageUrl, DOCUMENT)
        val suffixes = hostSuffixes(request.host)
        val flags = LinkedHashSet<Char>()
        for (rule in pageRules) {
            if (rule.host.isNotEmpty() && rule.host !in suffixes) continue
            if (optionsMatch(rule, request)) rule.flags.forEach { if (it != 'c' && it != 'i') flags.add(it) }
        }
        return flags.joinToString("")
    }

    fun matches(url: String, pageUrl: String, type: Int): Boolean {
        val request = request(url, pageUrl, type)
        if (request.host.isEmpty()) return false
        val suffixes = hostSuffixes(request.host)
        val tokens = urlTokens(url)
        if (findIn(important, request, suffixes, tokens) != null) return true
        if (findIn(blocks, request, suffixes, tokens) == null) return false
        return findIn(exceptions, request, suffixes, tokens) == null
    }

    fun shouldBlock(url: String, pageUrl: String, type: Int): Boolean {
        if (type == DOCUMENT) return false
        if (pageFlags(pageUrl).contains('d')) return false
        return matches(url, pageUrl, type)
    }

    companion object {
        const val SCRIPT = 1
        const val IMAGE = 2
        const val STYLESHEET = 4
        const val XHR = 16
        const val SUBDOCUMENT = 32
        const val MEDIA = 64
        const val FONT = 128
        const val WEBSOCKET = 256
        const val OTHER = 1024
        const val DOCUMENT = 2048
        const val UNKNOWN = SCRIPT or XHR or OTHER

        private val HOST = Regex("^[a-zA-Z][a-zA-Z0-9+.-]*://(?:[^@/?#]*@)?([^:/?#]+)")
        private val sites = ConcurrentHashMap<String, String>()
        private val MEDIA_EXT = Regex("\\.(mp4|webm|m3u8|mpd|ts|m4s|m4a|m4v|mp3|aac|ogg|oga|opus|wav|flac|mkv|mov)$")
        private val IMAGE_EXT = Regex("\\.(png|jpe?g|gif|webp|svg|ico|avif|bmp)$")
        private val FONT_EXT = Regex("\\.(woff2?|ttf|otf|eot)$")

        fun load(file: File): BrowserFilters {
            val filters = BrowserFilters()
            file.bufferedReader().useLines { lines ->
                lines.forEach { line -> BrowserFilterRule.parse(line)?.let { filters.add(it) } }
            }
            return filters
        }

        fun hostOf(url: String): String = HOST.find(url)?.groupValues?.get(1)?.lowercase() ?: ""

        fun hostSuffixes(host: String): List<String> {
            val out = ArrayList<String>(5)
            var rest = host
            while (rest.isNotEmpty()) {
                out.add(rest)
                val dot = rest.indexOf('.')
                if (dot < 0) break
                rest = rest.substring(dot + 1)
            }
            return out
        }

        fun urlTokens(url: String): Set<String> {
            val tokens = LinkedHashSet<String>()
            val lower = url.lowercase()
            var start = -1
            for (index in 0..lower.length) {
                val char = if (index < lower.length) lower[index] else ' '
                val word = (char in 'a'..'z') || (char in '0'..'9')
                if (word && start < 0) start = index
                if (!word && start >= 0) {
                    if (index - start >= 2) tokens.add(lower.substring(start, index))
                    start = -1
                }
            }
            return tokens
        }

        fun domainMatches(host: String, domain: String): Boolean =
            host == domain || (host.length > domain.length && host.endsWith(domain) && host[host.length - domain.length - 1] == '.')

        /** The registrable domain ("bbc.co.uk" for "news.bbc.co.uk"). */
        fun site(host: String): String {
            if (host.isEmpty()) return host
            sites[host]?.let { return it }
            val value = "https://$host/".toHttpUrlOrNull()?.topPrivateDomain() ?: host
            if (sites.size > 2000) sites.clear()
            sites[host] = value
            return value
        }

        fun inferType(url: String, accept: String, mainFrame: Boolean): Int {
            if (mainFrame) return DOCUMENT
            val lowerAccept = accept.lowercase()
            if (lowerAccept.startsWith("text/html")) return SUBDOCUMENT
            if (lowerAccept.startsWith("image/")) return IMAGE
            if (lowerAccept.startsWith("text/css")) return STYLESHEET
            if (url.startsWith("ws:", true) || url.startsWith("wss:", true)) return WEBSOCKET
            val path = url.lowercase().substringBefore('#').substringBefore('?')
            return when {
                path.endsWith(".js") || path.endsWith(".mjs") -> SCRIPT
                path.endsWith(".css") -> STYLESHEET
                IMAGE_EXT.containsMatchIn(path) -> IMAGE
                FONT_EXT.containsMatchIn(path) -> FONT
                MEDIA_EXT.containsMatchIn(path) -> MEDIA
                else -> UNKNOWN
            }
        }
    }
}
