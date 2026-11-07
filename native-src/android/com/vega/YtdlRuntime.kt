package com.vega

import android.content.Context
import android.util.Base64
import com.arthenica.ffmpegkit.FFmpegKit
import com.arthenica.ffmpegkit.FFprobeKit
import com.chaquo.python.PyObject
import com.chaquo.python.Python
import com.chaquo.python.android.AndroidPlatform
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayInputStream
import java.io.File
import java.io.FileOutputStream
import java.security.KeyStore
import java.security.MessageDigest
import java.security.cert.X509Certificate
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import java.util.zip.ZipInputStream

/**
 * Runs yt-dlp inside the app's embedded CPython (Chaquopy).
 *
 * yt-dlp is pure Python. The APK carries one pinned release as an asset; "Update
 * yt-dlp" downloads the newest release from GitHub, checks it against the
 * release's SHA2-256SUMS, and keeps it in the app's files folder. The newer of
 * the two is used, and the bundled one is the fallback when an update fails to
 * load.
 */
object YtdlRuntime {
    private const val TAG = "YtdlRuntime"
    private const val PREFS = "droidstream_ytdlp"
    private const val GITHUB_LATEST = "https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest"
    private const val RELEASE_BASE = "https://github.com/yt-dlp/yt-dlp/releases/download"
    private const val MAX_RELEASE_BYTES = 64L * 1024 * 1024
    private val VERSION_PATTERN = Regex("^[0-9]{4}\\.[0-9]{2}\\.[0-9]{2}(\\.[0-9]+)?$")

    @Volatile private var started = false
    @Volatile var activeVersion: String? = null
        private set
    @Volatile var activeSource: String = "bundled"
        private set
    @Volatile var pythonVersion: String? = null
        private set
    @Volatile var startError: String? = null
        private set
    @Volatile private var pendingActivation: File? = null
    private val runningJobs = AtomicInteger(0)
    private val ffmpegSessions = ConcurrentHashMap<String, MutableSet<Long>>()
    private val startLock = Any()
    private var bridge: Bridge? = null

    private val http: OkHttpClient by lazy {
        OkHttpClient.Builder()
            .connectTimeout(20, TimeUnit.SECONDS)
            .readTimeout(60, TimeUnit.SECONDS)
            .followRedirects(true)
            .build()
    }

    fun root(context: Context) = File(context.filesDir, "ytdlp").apply { mkdirs() }
    fun cookieFile(context: Context) = File(root(context), "cookies.txt")
    private fun binDir(context: Context) = File(root(context), "bin")
    private fun releasesDir(context: Context) = File(root(context), "releases")
    private fun prefs(context: Context) = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    /** The Python module, starting Python and loading yt-dlp on first use. */
    fun module(context: Context): PyObject {
        synchronized(startLock) {
            if (!started) start(context.applicationContext)
            val pending = pendingActivation
            if (pending != null && runningJobs.get() == 0) {
                pendingActivation = null
                activate(context.applicationContext, pending, "updated")
            }
            return Python.getInstance().getModule("droidstream_ytdl")
        }
    }

    fun beginJob() = runningJobs.incrementAndGet()
    fun endJob() = runningJobs.decrementAndGet()

    private fun start(context: Context) {
        try {
            if (!Python.isStarted()) Python.start(AndroidPlatform(context))
            val bin = binDir(context).apply { mkdirs() }
            // yt-dlp checks that its ffmpeg folder exists; the files are never run.
            for (name in listOf("ffmpeg", "ffprobe")) File(bin, name).apply { if (!exists()) writeText("") }
            val certs = writeCaBundle(context)
            val bridgeObject = Bridge(context)
            bridge = bridgeObject
            val module = Python.getInstance().getModule("droidstream_ytdl")
            pythonVersion = module.callAttr("setup", bridgeObject, bin.absolutePath, certs?.absolutePath).toString()
            val bundled = ensureBundled(context)
            val updated = updatedRelease(context)
            val preferUpdated = updated != null && bundled != null &&
                compareVersions(updated.name, bundled.name) > 0
            when {
                preferUpdated -> try {
                    activate(context, updated!!, "updated")
                } catch (error: Throwable) {
                    VegaLog.w(TAG, "Updated yt-dlp ${updated!!.name} failed to load, using the bundled one", error)
                    prefs(context).edit().putString("badVersion", updated.name).apply()
                    activate(context, bundled!!, "bundled")
                }
                bundled != null -> activate(context, bundled, "bundled")
                updated != null -> activate(context, updated, "updated")
                else -> throw IllegalStateException("yt-dlp is missing from this build")
            }
            started = true
            startError = null
        } catch (error: Throwable) {
            startError = error.message ?: error.javaClass.simpleName
            VegaLog.e(TAG, "yt-dlp could not start", error)
            throw error
        }
    }

    private fun activate(context: Context, dir: File, source: String) {
        val version = Python.getInstance().getModule("droidstream_ytdl")
            .callAttr("activate", dir.absolutePath).toString()
        activeVersion = version
        activeSource = source
        VegaLog.i(TAG, "yt-dlp $version ($source) on Python $pythonVersion")
    }

    fun status(context: Context): JSONObject {
        val result = JSONObject()
        try {
            module(context)
            result.put("available", true)
        } catch (error: Throwable) {
            result.put("available", false)
            result.put("error", startError ?: error.message)
        }
        result.put("version", activeVersion)
        result.put("source", activeSource)
        result.put("python", pythonVersion)
        result.put("bundledVersion", bundledInfo(context)?.optString("version"))
        result.put("pendingVersion", pendingActivation?.name)
        result.put("jsSandbox", YtdlJsSandbox.isSupported())
        result.put("cookies", cookieFile(context).exists())
        return result
    }

    // --- Bundled and updated releases ------------------------------------

    private fun bundledInfo(context: Context): JSONObject? = try {
        context.assets.open("ytdlp/bundled.json").use { JSONObject(it.readBytes().toString(Charsets.UTF_8)) }
    } catch (_: Exception) {
        null
    }

    private fun ensureBundled(context: Context): File? {
        val info = bundledInfo(context) ?: return null
        val version = info.optString("version")
        if (!VERSION_PATTERN.matches(version)) return null
        val target = File(File(root(context), "bundled"), version)
        if (File(target, ".complete").exists()) return target
        val bytes = context.assets.open("ytdlp/yt-dlp.zip").use { it.readBytes() }
        File(root(context), "bundled").listFiles()?.forEach { if (it.name != version) it.deleteRecursively() }
        installRelease(bytes, target)
        return target
    }

    private fun updatedRelease(context: Context): File? {
        val version = prefs(context).getString("updatedVersion", null) ?: return null
        if (version == prefs(context).getString("badVersion", null)) return null
        val dir = File(releasesDir(context), version)
        return if (File(dir, ".complete").exists()) dir else null
    }

    /** Strips the zipapp's shebang line, extracts it, and checks the layout. */
    private fun installRelease(release: ByteArray, target: File): String {
        val start = indexOfZip(release)
        require(start >= 0) { "The yt-dlp release is not a zip archive" }
        val temp = File(target.parentFile, "${target.name}.tmp")
        temp.deleteRecursively()
        temp.mkdirs()
        val base = temp.canonicalPath + File.separator
        ZipInputStream(ByteArrayInputStream(release, start, release.size - start)).use { zip ->
            while (true) {
                val entry = zip.nextEntry ?: break
                val out = File(temp, entry.name)
                require(out.canonicalPath.startsWith(base)) { "Unsafe path in the yt-dlp archive" }
                if (entry.isDirectory) {
                    out.mkdirs()
                } else {
                    out.parentFile?.mkdirs()
                    FileOutputStream(out).use { zip.copyTo(it) }
                }
            }
        }
        val versionFile = File(temp, "yt_dlp/version.py")
        require(versionFile.exists() && File(temp, "yt_dlp/__init__.py").exists()) { "The archive does not contain yt-dlp" }
        val version = Regex("__version__\\s*=\\s*'([^']+)'").find(versionFile.readText())?.groupValues?.get(1)
            ?: throw IllegalStateException("The yt-dlp version is unknown")
        val minimum = Regex("sys\\.version_info\\s*<\\s*\\((\\d+),\\s*(\\d+)\\)")
            .find(File(temp, "yt_dlp/__init__.py").readText())
        val running = pythonVersion?.split('.')?.mapNotNull { it.toIntOrNull() }
        if (minimum != null && running != null && running.size >= 2) {
            val needed = minimum.groupValues[1].toInt() to minimum.groupValues[2].toInt()
            require(running[0] > needed.first || (running[0] == needed.first && running[1] >= needed.second)) {
                "yt-dlp $version needs Python ${needed.first}.${needed.second}; this app has Python $pythonVersion"
            }
        }
        File(temp, ".complete").writeText(version)
        target.deleteRecursively()
        require(temp.renameTo(target)) { "Could not install yt-dlp" }
        return version
    }

    private fun indexOfZip(bytes: ByteArray): Int {
        val limit = minOf(bytes.size - 4, 4096)
        for (index in 0..limit) {
            if (bytes[index] == 0x50.toByte() && bytes[index + 1] == 0x4b.toByte() &&
                bytes[index + 2] == 0x03.toByte() && bytes[index + 3] == 0x04.toByte()) return index
        }
        return -1
    }

    fun latestVersion(): String {
        val request = Request.Builder().url(GITHUB_LATEST).header("Accept", "application/vnd.github+json").build()
        http.newCall(request).execute().use { response ->
            if (!response.isSuccessful) throw IllegalStateException("GitHub answered HTTP ${response.code}")
            val tag = JSONObject(response.body?.string().orEmpty()).optString("tag_name")
            require(VERSION_PATTERN.matches(tag)) { "Unexpected yt-dlp release tag: $tag" }
            return tag
        }
    }

    private fun fetch(url: String): ByteArray {
        http.newCall(Request.Builder().url(url).build()).execute().use { response ->
            if (!response.isSuccessful) throw IllegalStateException("HTTP ${response.code} for $url")
            val body = response.body ?: throw IllegalStateException("Empty response for $url")
            if (body.contentLength() > MAX_RELEASE_BYTES) throw IllegalStateException("The release is too large")
            val bytes = body.bytes()
            if (bytes.size > MAX_RELEASE_BYTES) throw IllegalStateException("The release is too large")
            return bytes
        }
    }

    /** Downloads, verifies and installs the newest release. Returns its version and whether it is new. */
    fun update(context: Context): JSONObject {
        module(context)
        val latest = latestVersion()
        val current = activeVersion
        if (current != null && compareVersions(latest, current) <= 0) {
            return JSONObject().put("version", current).put("updated", false)
        }
        val sums = fetch("$RELEASE_BASE/$latest/SHA2-256SUMS").toString(Charsets.UTF_8)
        val expected = sums.lineSequence()
            .map { it.trim().split(Regex("\\s+")) }
            .firstOrNull { it.size == 2 && it[1].removePrefix("*") == "yt-dlp" }
            ?.get(0)?.lowercase()
            ?: throw IllegalStateException("SHA2-256SUMS has no entry for yt-dlp")
        val release = fetch("$RELEASE_BASE/$latest/yt-dlp")
        val actual = MessageDigest.getInstance("SHA-256").digest(release).joinToString("") { "%02x".format(it) }
        if (actual != expected) throw SecurityException("The downloaded yt-dlp does not match its SHA-256 checksum")
        val target = File(releasesDir(context).apply { mkdirs() }, latest)
        val installed = installRelease(release, target)
        prefs(context).edit().putString("updatedVersion", latest).remove("badVersion").apply()
        releasesDir(context).listFiles()?.forEach { if (it.name != latest) it.deleteRecursively() }
        synchronized(startLock) {
            if (runningJobs.get() == 0) {
                try {
                    activate(context, target, "updated")
                } catch (error: Throwable) {
                    prefs(context).edit().putString("badVersion", latest).apply()
                    ensureBundled(context)?.let { activate(context, it, "bundled") }
                    throw IllegalStateException("yt-dlp $installed did not load: ${error.message}", error)
                }
            } else {
                pendingActivation = target
            }
        }
        return JSONObject().put("version", installed).put("updated", true).put("pending", pendingActivation != null)
    }

    fun resetToBundled(context: Context): JSONObject {
        prefs(context).edit().remove("updatedVersion").apply()
        releasesDir(context).deleteRecursively()
        synchronized(startLock) {
            pendingActivation = null
            if (started && runningJobs.get() == 0) ensureBundled(context)?.let { activate(context, it, "bundled") }
        }
        return status(context)
    }

    fun compareVersions(left: String, right: String): Int {
        val a = left.split('.').map { it.toIntOrNull() ?: 0 }
        val b = right.split('.').map { it.toIntOrNull() ?: 0 }
        for (index in 0 until maxOf(a.size, b.size)) {
            val diff = (a.getOrNull(index) ?: 0) - (b.getOrNull(index) ?: 0)
            if (diff != 0) return diff
        }
        return 0
    }

    // --- Certificates ------------------------------------------------------

    /** Python's OpenSSL does not read Android's certificate store, so write it out as PEM. */
    private fun writeCaBundle(context: Context): File? = try {
        val file = File(root(context), "cacert.pem")
        val store = KeyStore.getInstance("AndroidCAStore").apply { load(null) }
        val pem = StringBuilder()
        for (alias in store.aliases()) {
            val cert = store.getCertificate(alias) as? X509Certificate ?: continue
            pem.append("-----BEGIN CERTIFICATE-----\n")
            pem.append(Base64.encodeToString(cert.encoded, Base64.DEFAULT))
            pem.append("-----END CERTIFICATE-----\n")
        }
        file.writeText(pem.toString())
        file
    } catch (error: Exception) {
        VegaLog.w(TAG, "Could not export the certificate store", error)
        null
    }

    // --- Cookies -------------------------------------------------------------

    private fun hostOf(url: String): String? = try {
        java.net.URI(if (url.contains("://")) url else "https://$url").host?.lowercase()?.removePrefix("www.")
    } catch (_: Exception) {
        null
    }

    fun cookieSites(context: Context): JSONArray =
        JSONArray(prefs(context).getString("cookieSites", "[]"))

    /** Copies the WebView cookies of each saved site into a Netscape cookie file for yt-dlp. */
    fun saveCookies(context: Context, siteUrl: String?): Int {
        val sites = linkedSetOf<String>()
        val saved = cookieSites(context)
        for (index in 0 until saved.length()) sites.add(saved.getString(index))
        siteUrl?.let { hostOf(it) }?.let { sites.add(it) }
        val manager = android.webkit.CookieManager.getInstance()
        val expiry = System.currentTimeMillis() / 1000 + 180L * 24 * 3600
        val lines = StringBuilder("# Netscape HTTP Cookie File\n# Written by Droid Stream from its sign-in browser\n")
        var count = 0
        for (host in sites) {
            val seen = HashSet<String>()
            for (url in listOf("https://$host/", "https://www.$host/", "https://m.$host/")) {
                val header = manager.getCookie(url) ?: continue
                for (pair in header.split(';')) {
                    val index = pair.indexOf('=')
                    if (index <= 0) continue
                    val name = pair.substring(0, index).trim()
                    val value = pair.substring(index + 1).trim()
                    if (name.isEmpty() || !seen.add(name)) continue
                    lines.append(".$host\tTRUE\t/\tTRUE\t$expiry\t$name\t$value\n")
                    count++
                }
            }
        }
        val file = cookieFile(context)
        if (count == 0) {
            file.delete()
        } else {
            file.writeText(lines.toString())
        }
        prefs(context).edit().putString("cookieSites", JSONArray(sites.toList()).toString()).apply()
        return count
    }

    fun clearCookies(context: Context, siteUrl: String?) {
        if (siteUrl == null) {
            prefs(context).edit().remove("cookieSites").apply()
            cookieFile(context).delete()
            return
        }
        val host = hostOf(siteUrl)
        val saved = cookieSites(context)
        val kept = (0 until saved.length()).map { saved.getString(it) }.filter { it != host }
        prefs(context).edit().putString("cookieSites", JSONArray(kept).toString()).apply()
        saveCookies(context, null)
    }

    // --- Jobs ----------------------------------------------------------------

    fun cancelFfmpeg(jobId: String) {
        ffmpegSessions[jobId]?.forEach { FFmpegKit.cancel(it) }
    }

    /** Called from Python. Keep the method names in step with droidstream_ytdl.py. */
    class Bridge(private val context: Context) {
        fun log(message: String) = VegaLog.i(TAG, message.take(2000))

        fun runFfmpeg(jobId: String, tool: String, argsJson: String): String {
            val list = JSONArray(argsJson)
            val args = Array(list.length()) { list.getString(it) }
            val done = CountDownLatch(1)
            val session = if (tool == "ffprobe") {
                FFprobeKit.executeWithArgumentsAsync(args) { done.countDown() }
            } else {
                FFmpegKit.executeWithArgumentsAsync(args, { done.countDown() }, null, null)
            }
            val sessions = ffmpegSessions.getOrPut(jobId) { ConcurrentHashMap.newKeySet() }
            sessions.add(session.sessionId)
            try {
                done.await()
            } finally {
                sessions.remove(session.sessionId)
                if (sessions.isEmpty()) ffmpegSessions.remove(jobId, sessions)
            }
            val output = (session.getAllLogsAsString(5000) ?: "").let { if (it.length > 262_144) it.takeLast(262_144) else it }
            return JSONObject()
                .put("code", session.returnCode?.value ?: 1)
                .put("output", output)
                .toString()
        }

        fun cancelFfmpeg(jobId: String) = YtdlRuntime.cancelFfmpeg(jobId)

        fun jsAvailable(): Boolean = YtdlJsSandbox.isSupported()

        fun runJs(script: String): String = YtdlJsSandbox.run(context, script)
    }
}
