package com.vega

import android.content.Context
import android.net.Uri
import android.os.ParcelFileDescriptor
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.modules.core.DeviceEventManagerModule
import org.apache.commons.net.ftp.FTP
import org.apache.commons.net.ftp.FTPClient
import org.apache.commons.net.ftp.FTPReply
import org.apache.commons.net.ftp.FTPSClient
import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.io.InputStream
import java.net.URI
import java.net.URLDecoder
import java.nio.ByteBuffer
import java.nio.channels.FileChannel
import java.time.Duration
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicLong
import javax.net.ssl.HttpsURLConnection
import kotlin.math.max
import kotlin.math.min

private class FtpCancelledException : IOException("Download cancelled")
private class FtpPausedException : IOException("Download paused")
/** Sign-in refused, file missing, or another answer a retry cannot fix. */
private class FtpFatalException(message: String) : IOException(message)
/** The server refused REST, so the download starts again from the first byte. */
private class FtpNoResumeException : IOException("This FTP server cannot resume downloads")

/** Where to sign in and what to fetch. The password is never logged or emitted. */
private data class FtpTarget(
    val host: String,
    val port: Int,
    val user: String,
    val password: String,
    val path: String,
    val tls: String,
    val passive: Boolean,
) {
    val fileName: String get() = path.substringAfterLast('/').ifEmpty { "download" }
}

private class FtpJob(
    val id: String,
    val target: FtpTarget,
    val destination: String,
    val connections: Int,
    val completion: Promise,
) {
    @Volatile var cancelled = false
    @Volatile var paused = false
    @Volatile var deleteOnCancel = false
    @Volatile var cancelPromise: Promise? = null
    /** Set after the server refused REST: the next try starts at byte 0. */
    @Volatile var restartFromZero = false
    val clients: MutableSet<FTPClient> = ConcurrentHashMap.newKeySet()
    val monitor = Object()

    /** Closes every open connection so blocked reads return at once. */
    fun dropConnections() {
        clients.forEach { client -> runCatching { client.disconnect() } }
    }
}

private class FtpRange(var pos: Long, var end: Long) {
    var owned = false
    var notBefore = 0L
    val remaining: Long get() = end - pos
}

/**
 * FTP and FTPS downloads (Apache Commons Net). Passive mode by default, resume
 * with REST, explicit (ftpes://) or implicit (ftps://) TLS. Several connections
 * at once only when the server accepts a second signed-in session and REST;
 * otherwise one. Missing ranges are saved so a stopped download continues.
 */
class FtpDownloadModule(private val reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {
    companion object {
        private const val PROGRESS_EVENT = "VegaFtpDownloadProgress"
        private const val STATE_EVENT = "VegaFtpDownloadState"
        private const val BUFFER_SIZE = 256 * 1024
        private const val PROGRESS_INTERVAL_MS = 500L
        private const val PERSIST_INTERVAL_MS = 2_000L
        private const val MIN_SPLIT_BYTES = 4L * 1024 * 1024
        private const val MAX_CONNECTIONS = 8
        private const val MAX_FAILURES = 8
        private const val MAX_RETRY_DELAY_MS = 30_000L
        private val jobs = ConcurrentHashMap<String, FtpJob>()
        private val executor = Executors.newCachedThreadPool()
    }

    private val metadata by lazy { reactContext.getSharedPreferences("vega_ftp_downloads", Context.MODE_PRIVATE) }

    override fun getName(): String = "FtpDownloadModule"

    @ReactMethod fun addListener(eventName: String) = Unit
    @ReactMethod fun removeListeners(count: Double) = Unit

    @ReactMethod
    fun start(downloadId: String, url: String, password: String?, destination: String, options: ReadableMap?, promise: Promise) {
        if (jobs.containsKey(downloadId)) {
            promise.reject("DOWNLOAD_ACTIVE", "Download is already active")
            return
        }
        val target = try {
            parseTarget(url, password, options)
        } catch (error: Exception) {
            promise.reject("FTP_BAD_LINK", error.message ?: "This FTP link is not valid", error)
            return
        }
        val connections = (if (options?.hasKey("connections") == true) options.getInt("connections") else 1).coerceIn(1, MAX_CONNECTIONS)
        val job = FtpJob(downloadId, target, destination, connections, promise)
        jobs[downloadId] = job
        executor.execute { runJob(job) }
    }

    @ReactMethod
    fun pause(downloadId: String, promise: Promise) {
        val job = jobs[downloadId]
        if (job == null || job.cancelled) {
            promise.reject("DOWNLOAD_NOT_ACTIVE", "Download is not active")
            return
        }
        job.paused = true
        job.dropConnections()
        emitState(job.id, "paused")
        promise.resolve(null)
    }

    @ReactMethod
    fun resume(downloadId: String, promise: Promise) {
        val job = jobs[downloadId]
        if (job == null || job.cancelled) {
            promise.reject("DOWNLOAD_NOT_ACTIVE", "Download is not active")
            return
        }
        synchronized(job.monitor) {
            job.paused = false
            job.monitor.notifyAll()
        }
        emitState(job.id, "connecting")
        promise.resolve(null)
    }

    @ReactMethod
    fun cancel(downloadId: String, deleteDestination: Boolean, promise: Promise) {
        val job = jobs[downloadId]
        if (job == null) {
            if (deleteDestination) clearMetadata(downloadId)
            promise.resolve(null)
            return
        }
        job.cancelPromise = promise
        job.deleteOnCancel = deleteDestination
        job.cancelled = true
        job.dropConnections()
        synchronized(job.monitor) {
            job.paused = false
            job.monitor.notifyAll()
        }
    }

    /** Size, name and whether the server can resume (REST). */
    @ReactMethod
    fun probe(url: String, password: String?, options: ReadableMap?, promise: Promise) {
        executor.execute {
            var client: FTPClient? = null
            try {
                val target = parseTarget(url, password, options)
                client = connect(target)
                val size = remoteSize(client, target.path)
                val rest = client.hasFeature("REST") || client.hasFeature("REST", "STREAM")
                promise.resolve(Arguments.createMap().apply {
                    putDouble("size", size.toDouble())
                    putString("fileName", target.fileName)
                    putBoolean("acceptRanges", rest)
                })
            } catch (error: Exception) {
                promise.reject("FTP_PROBE_FAILED", friendly(error), error)
            } finally {
                client?.let { close(it) }
            }
        }
    }

    /** Saved state of a stopped download: the size it expects. */
    @ReactMethod
    fun resumeInfo(downloadId: String, promise: Promise) {
        val total = metadata.getLong("$downloadId:total", -1L)
        if (total <= 0L) {
            promise.resolve(null)
            return
        }
        promise.resolve(Arguments.createMap().apply {
            putDouble("totalBytes", total.toDouble())
            putBoolean("hasRanges", metadata.contains("$downloadId:remaining"))
        })
    }

    private fun parseTarget(url: String, password: String?, options: ReadableMap?): FtpTarget {
        val uri = URI(url.trim())
        val scheme = uri.scheme?.lowercase() ?: throw IOException("This FTP link is not valid")
        val tls = when (scheme) {
            "ftp" -> "none"
            "ftpes" -> "explicit"
            "ftps" -> "implicit"
            else -> throw IOException("Not an FTP link")
        }
        val host = uri.host ?: throw IOException("This FTP link has no server")
        val port = if (uri.port > 0) uri.port else if (tls == "implicit") 990 else 21
        val info = uri.rawUserInfo
        val user = info?.substringBefore(':')?.takeIf { it.isNotEmpty() }?.let { URLDecoder.decode(it, "UTF-8") } ?: "anonymous"
        val inlinePassword = info?.takeIf { it.contains(':') }?.substringAfter(':')?.let { URLDecoder.decode(it, "UTF-8") }
        val secret = password ?: inlinePassword ?: if (user == "anonymous" || user == "ftp") "anonymous@" else ""
        // As curl reads it: "/dir/file" is relative to the sign-in folder, "/%2Fdir/file" is absolute.
        val rawPath = uri.rawPath ?: "/"
        val path = URLDecoder.decode(rawPath.removePrefix("/").replace("+", "%2B"), "UTF-8")
        if (path.isEmpty() || path.endsWith("/")) throw IOException("This FTP link is a folder, not a file")
        val passive = options?.takeIf { it.hasKey("passive") }?.getBoolean("passive") ?: true
        return FtpTarget(host, port, user, secret, path, tls, passive)
    }

    private fun connect(target: FtpTarget, job: FtpJob? = null): FTPClient {
        val client = when (target.tls) {
            "implicit" -> FTPSClient("TLS", true)
            "explicit" -> FTPSClient("TLS", false)
            else -> FTPClient()
        }
        if (client is FTPSClient) {
            client.hostnameVerifier = HttpsURLConnection.getDefaultHostnameVerifier()
            client.isEndpointCheckingEnabled = true
        }
        client.controlEncoding = "UTF-8"
        client.connectTimeout = 30_000
        client.defaultTimeout = 30_000
        client.setDataTimeout(Duration.ofSeconds(60))
        client.bufferSize = BUFFER_SIZE
        job?.clients?.add(client)
        try {
            client.connect(target.host, target.port)
            client.soTimeout = 60_000
            if (!FTPReply.isPositiveCompletion(client.replyCode)) {
                throw IOException("The FTP server refused the connection (${client.replyCode})")
            }
            if (!client.login(target.user, target.password)) {
                val code = client.replyCode
                if (code == 421) throw IOException("The FTP server has too many connections")
                throw FtpFatalException("FTP sign-in failed. Check the user name and password.")
            }
            if (client is FTPSClient) {
                client.execPBSZ(0)
                client.execPROT("P")
            }
            if (!client.setFileType(FTP.BINARY_FILE_TYPE)) throw IOException("The FTP server refused binary mode")
            if (target.passive) client.enterLocalPassiveMode() else client.enterLocalActiveMode()
            return client
        } catch (error: Exception) {
            job?.clients?.remove(client)
            close(client)
            throw error
        }
    }

    /** Signs out politely, or with [quick] just drops the connection (no reply to wait for). */
    private fun close(client: FTPClient, quick: Boolean = false) {
        if (!quick) runCatching { if (client.isConnected) client.logout() }
        runCatching { if (client.isConnected) client.disconnect() }
    }

    /** Size in bytes, or -1 when the server does not say. */
    private fun remoteSize(client: FTPClient, path: String): Long {
        client.getSize(path)?.trim()?.toLongOrNull()?.let { if (it >= 0L) return it }
        val code = client.replyCode
        runCatching { client.mlistFile(path) }.getOrNull()?.size?.let { if (it >= 0L) return it }
        if (code == 550) throw FtpFatalException("The file is not on the FTP server")
        return -1L
    }

    private fun openDestination(job: FtpJob): Pair<java.io.Closeable, FileChannel> {
        return if (job.destination.startsWith("content://")) {
            val descriptor = reactContext.contentResolver.openFileDescriptor(Uri.parse(job.destination), "rw")
                ?: throw FtpFatalException("Unable to open the download location")
            val output = FileOutputStream(descriptor.fileDescriptor)
            val closer = java.io.Closeable {
                runCatching { output.close() }
                runCatching { descriptor.close() }
            }
            closer to output.channel
        } else {
            val file = File(job.destination.removePrefix("file://"))
            file.parentFile?.mkdirs()
            val descriptor = ParcelFileDescriptor.open(
                file,
                ParcelFileDescriptor.MODE_READ_WRITE or ParcelFileDescriptor.MODE_CREATE,
            )
            val output = FileOutputStream(descriptor.fileDescriptor)
            java.io.Closeable {
                runCatching { output.close() }
                runCatching { descriptor.close() }
            } to output.channel
        }
    }

    private fun runJob(job: FtpJob) {
        var failures = 0
        var delay = 1_000L
        try {
            while (true) {
                synchronized(job.monitor) {
                    while (job.paused && !job.cancelled) job.monitor.wait()
                }
                if (job.cancelled) throw FtpCancelledException()
                try {
                    emitState(job.id, "connecting")
                    val (downloaded, total) = transfer(job) { failures = 0; delay = 1_000L }
                    clearMetadata(job.id)
                    emitProgress(job.id, downloaded, total, 0.0)
                    emitState(job.id, "completed")
                    job.completion.resolve(Arguments.createMap().apply {
                        putDouble("downloadedBytes", downloaded.toDouble())
                        putDouble("totalBytes", total.toDouble())
                    })
                    return
                } catch (error: Exception) {
                    if (job.cancelled) throw FtpCancelledException()
                    if (job.paused) continue
                    if (error is FtpNoResumeException && !job.restartFromZero) {
                        job.restartFromZero = true
                        clearMetadata(job.id)
                        continue
                    }
                    if (error is FtpFatalException || error is FtpNoResumeException) throw error
                    failures++
                    if (failures >= MAX_FAILURES) throw error
                    emitState(job.id, "waitingForNetwork", friendly(error))
                    synchronized(job.monitor) { job.monitor.wait(delay) }
                    delay = min(delay * 2, MAX_RETRY_DELAY_MS)
                }
            }
        } catch (error: FtpCancelledException) {
            emitState(job.id, "cancelled")
            job.completion.reject("DOWNLOAD_CANCELLED", error.message, error)
        } catch (error: Exception) {
            emitState(job.id, "failed", friendly(error))
            job.completion.reject("DOWNLOAD_FAILED", friendly(error), error)
        } finally {
            jobs.remove(job.id, job)
            job.dropConnections()
            if (job.cancelled && job.deleteOnCancel) {
                if (job.destination.startsWith("content://")) {
                    runCatching { reactContext.contentResolver.delete(Uri.parse(job.destination), null, null) }
                } else {
                    File(job.destination.removePrefix("file://")).delete()
                }
                clearMetadata(job.id)
            }
            job.cancelPromise?.resolve(null)
        }
    }

    /** Downloads what is missing. [onProgress] runs once data arrives. */
    private fun transfer(job: FtpJob, onProgress: () -> Unit): Pair<Long, Long> {
        val first = connect(job.target, job)
        var handedOff = false
        try {
            val total = remoteSize(first, job.target.path)
            val (closer, channel) = openDestination(job)
            try {
                val fileSize = channel.size()
                val savedTotal = if (job.restartFromZero) -2L else metadata.getLong("${job.id}:total", -1L)
                var ranges = if (savedTotal == total && total > 0L) parseRanges(metadata.getString("${job.id}:remaining", null)) else null
                if (ranges == null) {
                    // A different or unknown size: never append to bytes of another file.
                    val start = when {
                        job.restartFromZero -> 0L
                        total > 0L && savedTotal == total -> min(fileSize, total)
                        total < 0L && savedTotal == -1L && metadata.contains("${job.id}:total") -> fileSize
                        else -> 0L
                    }
                    if (start == 0L && fileSize > 0L) channel.truncate(0L)
                    ranges = mutableListOf(FtpRange(start, if (total > 0L) total else Long.MAX_VALUE))
                }
                metadata.edit().putLong("${job.id}:total", total).apply()
                val pending = ranges.filter { it.remaining > 0L }.toMutableList()
                if (pending.isEmpty()) return total to total
                // Ranges need REST; after the server refused it, one connection from byte 0.
                val parallel = !job.restartFromZero && total >= MIN_SPLIT_BYTES * 2 && job.connections > 1
                handedOff = true
                return RangedTransfer(job, channel, pending, total, if (parallel) job.connections else 1, onProgress).run(first)
            } finally {
                runCatching { channel.force(false) }
                closer.close()
            }
        } finally {
            if (!handedOff) {
                job.clients.remove(first)
                close(first)
            }
        }
    }

    private inner class RangedTransfer(
        private val job: FtpJob,
        private val channel: FileChannel,
        private val ranges: MutableList<FtpRange>,
        private val total: Long,
        private val wanted: Int,
        private val onProgress: () -> Unit,
    ) {
        private val lock = Object()
        private var active = 0
        private var limit = 1
        private var fatal: Exception? = null
        private var lastError: Exception? = null
        private var failures = 0
        private val downloaded = AtomicLong(
            if (total > 0L) total - ranges.sumOf { it.remaining } else ranges.first().pos,
        )

        fun run(first: FTPClient): Pair<Long, Long> {
            var lastBytes = downloaded.get()
            var lastTime = System.currentTimeMillis()
            var lastPersist = lastTime
            try {
                synchronized(lock) { startWorker(ranges.first(), first) }
                // A second signed-in session shows the server allows parallel transfers.
                if (wanted > 1) executor.execute { probeParallel() }
                while (true) {
                    synchronized(lock) {
                        fatal?.let { throw it }
                        if (ranges.all { it.remaining <= 0L } && active == 0) {
                            val done = downloaded.get()
                            return done to if (total > 0L) total else done
                        }
                        val error = lastError
                        if (error != null && active == 0 && failures >= 3) throw error
                        schedule()
                        lock.wait(250L)
                    }
                    if (job.cancelled) throw FtpCancelledException()
                    if (job.paused) throw FtpPausedException()
                    val now = System.currentTimeMillis()
                    if (now - lastTime >= PROGRESS_INTERVAL_MS) {
                        val bytes = downloaded.get()
                        if (bytes > lastBytes) onProgress()
                        emitProgress(job.id, bytes, max(total, 0L), (bytes - lastBytes) * 1000.0 / (now - lastTime))
                        lastBytes = bytes
                        lastTime = now
                    }
                    if (now - lastPersist >= PERSIST_INTERVAL_MS) {
                        persist()
                        lastPersist = now
                    }
                }
            } finally {
                job.dropConnections()
                synchronized(lock) {
                    val deadline = System.currentTimeMillis() + 10_000L
                    while (active > 0 && System.currentTimeMillis() < deadline) lock.wait(100L)
                }
                persist()
            }
        }

        private fun probeParallel() {
            val client = try {
                connect(job.target, job)
            } catch (error: Exception) {
                return
            }
            synchronized(lock) {
                if (fatal == null && !job.cancelled && !job.paused) {
                    limit = wanted
                    startWorker(null, client)
                    return
                }
            }
            job.clients.remove(client)
            close(client)
        }

        /** Caller holds [lock]. */
        private fun schedule() {
            val now = System.currentTimeMillis()
            while (active < limit) {
                val waiting = ranges.firstOrNull { !it.owned && it.remaining > 0L && it.notBefore <= now }
                if (waiting != null) {
                    startWorker(waiting, null)
                    continue
                }
                if (total <= 0L) return
                val largest = ranges.filter { it.owned }.maxByOrNull { it.remaining } ?: return
                if (largest.remaining < MIN_SPLIT_BYTES * 2) return
                val middle = largest.pos + largest.remaining / 2
                val second = FtpRange(middle, largest.end)
                largest.end = middle
                ranges.add(ranges.indexOf(largest) + 1, second)
                startWorker(second, null)
            }
        }

        /** Caller holds [lock]. A null range means: pick one when the client is ready. */
        private fun startWorker(range: FtpRange?, client: FTPClient?) {
            val chosen = range ?: run {
                schedulePick() ?: run {
                    client?.let { job.clients.remove(it); close(it) }
                    return
                }
            }
            chosen.owned = true
            active++
            executor.execute { work(chosen, client) }
        }

        /** An unowned range, or the second half of the largest one. Caller holds [lock]. */
        private fun schedulePick(): FtpRange? {
            ranges.firstOrNull { !it.owned && it.remaining > 0L }?.let { return it }
            if (total <= 0L) return null
            val largest = ranges.filter { it.owned }.maxByOrNull { it.remaining } ?: return null
            if (largest.remaining < MIN_SPLIT_BYTES * 2) return null
            val middle = largest.pos + largest.remaining / 2
            val second = FtpRange(middle, largest.end)
            largest.end = middle
            ranges.add(ranges.indexOf(largest) + 1, second)
            return second
        }

        private fun work(range: FtpRange, initial: FTPClient?) {
            var client = initial
            try {
                if (client == null) client = connect(job.target, job)
                val start = synchronized(lock) { range.pos }
                if (start > 0L) client.setRestartOffset(start)
                val input = client.retrieveFileStream(job.target.path)
                if (input == null) {
                    val code = client.replyCode
                    if (code == 550) throw FtpFatalException("The file is not on the FTP server")
                    if (start > 0L && code in 500..504) throw FtpNoResumeException()
                    throw IOException("The FTP server refused the download (${client.replyString?.trim()})")
                }
                // At the range end the rest of the stream belongs to another range:
                // closing the stream and the connection stops the transfer.
                val reachedEnd = input.use { readInto(range, it) }
                if (!reachedEnd) {
                    runCatching { client.completePendingCommand() }
                    synchronized(lock) {
                        if (range.end == Long.MAX_VALUE) range.end = range.pos
                        else if (range.remaining > 0L) throw IOException("The FTP connection ended early")
                    }
                }
                synchronized(lock) {
                    failures = 0
                    lastError = null
                }
            } catch (error: Exception) {
                synchronized(lock) {
                    if (!job.cancelled && !job.paused) {
                        if (error is FtpFatalException || error is FtpNoResumeException) {
                            fatal = error
                        } else {
                            failures++
                            lastError = error
                            range.notBefore = System.currentTimeMillis() + min(1_000L shl min(failures, 5), MAX_RETRY_DELAY_MS)
                            // A refused extra connection means one at a time is the limit.
                            if (active > 1) limit = max(1, limit - 1)
                        }
                    }
                }
            } finally {
                client?.let {
                    job.clients.remove(it)
                    close(it, quick = true)
                }
                synchronized(lock) {
                    range.owned = false
                    if (range.remaining <= 0L) ranges.remove(range)
                    active--
                    lock.notifyAll()
                }
            }
        }

        /** True when the range end was reached, false when the stream ended first. */
        private fun readInto(range: FtpRange, input: InputStream): Boolean {
            val buffer = ByteArray(BUFFER_SIZE)
            while (true) {
                if (job.cancelled) throw FtpCancelledException()
                if (job.paused) throw FtpPausedException()
                val read = input.read(buffer)
                if (read < 0) return false
                val position: Long
                val count: Int
                synchronized(lock) {
                    position = range.pos
                    count = min(read.toLong(), range.end - range.pos).toInt()
                }
                if (count > 0) {
                    val data = ByteBuffer.wrap(buffer, 0, count)
                    var at = position
                    while (data.hasRemaining()) at += channel.write(data, at)
                    downloaded.addAndGet(count.toLong())
                    DownloadRateGate.await(count, 0)
                }
                synchronized(lock) {
                    range.pos += count
                    if (range.pos >= range.end) return true
                }
            }
        }

        private fun persist() {
            if (total <= 0L) return
            val text = synchronized(lock) { ranges.filter { it.remaining > 0L }.joinToString(",") { "${it.pos}-${it.end}" } }
            metadata.edit().putLong("${job.id}:total", total).putString("${job.id}:remaining", text).apply()
        }
    }

    private fun parseRanges(value: String?): MutableList<FtpRange>? {
        if (value == null) return null
        if (value.isEmpty()) return mutableListOf()
        return value.split(",").map { part ->
            val bounds = part.split("-")
            val start = bounds.getOrNull(0)?.toLongOrNull() ?: return null
            val end = bounds.getOrNull(1)?.toLongOrNull() ?: return null
            if (start < 0L || end <= start) return null
            FtpRange(start, end)
        }.sortedBy { it.pos }.toMutableList()
    }

    private fun clearMetadata(downloadId: String) {
        metadata.edit().remove("$downloadId:total").remove("$downloadId:remaining").apply()
    }

    /** Short text for the user. Never contains the password. */
    private fun friendly(error: Throwable): String = when (error) {
        is FtpFatalException -> error.message ?: "The FTP download failed"
        is java.net.UnknownHostException -> "The FTP server could not be found"
        is java.net.SocketTimeoutException -> "The FTP server stopped answering"
        is javax.net.ssl.SSLException -> "The secure FTP connection failed: ${error.message.orEmpty().take(120)}"
        else -> error.message?.take(200) ?: "The FTP download failed"
    }

    private fun emitProgress(downloadId: String, downloaded: Long, total: Long, speed: Double) {
        emit(PROGRESS_EVENT, Arguments.createMap().apply {
            putString("downloadId", downloadId)
            putDouble("downloadedBytes", downloaded.toDouble())
            putDouble("totalBytes", total.toDouble())
            putDouble("speed", speed)
        })
    }

    private fun emitState(downloadId: String, state: String, message: String? = null) {
        emit(STATE_EVENT, Arguments.createMap().apply {
            putString("downloadId", downloadId)
            putString("state", state)
            message?.let { putString("message", it) }
        })
    }

    private fun emit(eventName: String, payload: Any) {
        if (reactContext.hasActiveReactInstance()) {
            reactContext.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java).emit(eventName, payload)
        }
    }
}
