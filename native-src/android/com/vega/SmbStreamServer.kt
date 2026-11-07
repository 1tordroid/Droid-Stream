package com.vega

import com.hierynomus.msdtyp.AccessMask
import com.hierynomus.msfscc.fileinformation.FileStandardInformation
import com.hierynomus.mssmb2.SMB2CreateDisposition
import com.hierynomus.mssmb2.SMB2ShareAccess
import com.hierynomus.smbj.SMBClient
import com.hierynomus.smbj.auth.AuthenticationContext
import com.hierynomus.smbj.connection.Connection
import com.hierynomus.smbj.session.Session
import com.hierynomus.smbj.share.DiskShare
import com.hierynomus.smbj.share.File
import fi.iki.elonen.NanoHTTPD
import java.io.ByteArrayInputStream
import java.io.IOException
import java.io.InputStream
import java.net.URLEncoder
import java.security.SecureRandom
import java.util.EnumSet
import java.util.Timer
import java.util.concurrent.ConcurrentHashMap
import kotlin.concurrent.schedule

/**
 * Serves SMB files to the player over HTTP with Range support. Bound to
 * loopback on a random port, so other devices cannot read it. Each opened
 * file gets a random 128-bit token; there is no listing route, and a token
 * stops working 30 minutes after its last read or when it is closed.
 */
class SmbStreamServer : NanoHTTPD("127.0.0.1", 0) {

    companion object {
        private const val TAG = "SmbStreamServer"
        private const val READ_CHUNK = 1024 * 1024
        private const val IDLE_MS = 30L * 60L * 1000L
        private const val SWEEP_MS = 60L * 1000L
    }

    private class OpenFile(
        val client: SMBClient,
        val connection: Connection,
        val session: Session,
        val share: DiskShare,
        val file: File,
        val size: Long,
        val name: String,
    ) {
        @Volatile var lastUsed: Long = System.currentTimeMillis()
        private val lock = Any()

        /** One positioned read; smbj answers a single request at a time per file here. */
        fun read(buffer: ByteArray, offset: Long, length: Int): Int = synchronized(lock) {
            lastUsed = System.currentTimeMillis()
            file.read(buffer, offset, 0, length)
        }

        fun close() {
            try { file.close() } catch (_: Exception) {}
            try { share.close() } catch (_: Exception) {}
            try { session.close() } catch (_: Exception) {}
            try { connection.close() } catch (_: Exception) {}
            try { client.close() } catch (_: Exception) {}
        }
    }

    private val streams = ConcurrentHashMap<String, OpenFile>()
    private val random = SecureRandom()
    private var sweeper: Timer? = null

    @Synchronized
    fun ensureStarted() {
        if (!isAlive) start(SOCKET_READ_TIMEOUT, true)
        if (sweeper == null) {
            sweeper = Timer("smb-stream-sweep", true).also { timer ->
                timer.schedule(SWEEP_MS, SWEEP_MS) { sweep() }
            }
        }
    }

    private fun sweep() {
        val now = System.currentTimeMillis()
        for ((token, entry) in streams) {
            if (now - entry.lastUsed > IDLE_MS) {
                streams.remove(token)?.close()
                VegaLog.d(TAG, "Closed idle SMB stream")
            }
        }
    }

    private fun newToken(): String {
        val bytes = ByteArray(16)
        random.nextBytes(bytes)
        return bytes.joinToString("") { "%02x".format(it) }
    }

    /** Opens the file and returns its loopback address. Throws when SMB refuses it. */
    fun open(host: String, shareName: String, path: String, username: String, password: String, domain: String): String {
        ensureStarted()
        val client = SMBClient()
        var connection: Connection? = null
        var session: Session? = null
        var share: DiskShare? = null
        try {
            connection = client.connect(host)
            session = connection.authenticate(
                AuthenticationContext(username, password.toCharArray(), domain.ifBlank { null }),
            )
            share = session.connectShare(shareName) as DiskShare
            val smbPath = path.trim().trim('/').replace('/', '\\')
            val file = share.openFile(
                smbPath,
                EnumSet.of(AccessMask.GENERIC_READ),
                null,
                SMB2ShareAccess.ALL,
                SMB2CreateDisposition.FILE_OPEN,
                null,
            )
            val size = file.getFileInformation(FileStandardInformation::class.java).endOfFile
            val name = smbPath.substringAfterLast('\\').ifBlank { "video" }
            val token = newToken()
            streams[token] = OpenFile(client, connection, session, share, file, size, name)
            val encoded = URLEncoder.encode(name, "UTF-8").replace("+", "%20")
            return "http://127.0.0.1:$listeningPort/$token/$encoded"
        } catch (error: Exception) {
            try { share?.close() } catch (_: Exception) {}
            try { session?.close() } catch (_: Exception) {}
            try { connection?.close() } catch (_: Exception) {}
            try { client.close() } catch (_: Exception) {}
            throw error
        }
    }

    /** Ends a token from an address open() returned. Unknown addresses are ignored. */
    fun close(url: String) {
        val token = url.substringAfter("127.0.0.1:", "").substringAfter('/', "").substringBefore('/')
        if (token.isNotEmpty()) streams.remove(token)?.close()
    }

    override fun serve(session: IHTTPSession): Response {
        if (session.method != Method.GET && session.method != Method.HEAD) {
            return newFixedLengthResponse(Response.Status.METHOD_NOT_ALLOWED, MIME_PLAINTEXT, "")
        }
        val token = session.uri.trimStart('/').substringBefore('/')
        val entry = streams[token]
            ?: return newFixedLengthResponse(Response.Status.NOT_FOUND, MIME_PLAINTEXT, "")
        entry.lastUsed = System.currentTimeMillis()

        val size = entry.size
        val rangeHeader = session.headers["range"]
        val range = parseRange(rangeHeader, size)
        if (range == null && rangeHeader != null) {
            return newFixedLengthResponse(Response.Status.RANGE_NOT_SATISFIABLE, MIME_PLAINTEXT, "").apply {
                addHeader("Content-Range", "bytes */$size")
            }
        }
        val start = range?.first ?: 0L
        val end = range?.last ?: (size - 1L)
        val length = if (size > 0) end - start + 1 else 0L
        val status = if (range != null) Response.Status.PARTIAL_CONTENT else Response.Status.OK
        val mime = guessMimeType(entry.name)

        val body: InputStream = if (session.method == Method.HEAD || length <= 0L) {
            ByteArrayInputStream(ByteArray(0))
        } else {
            RangeStream(entry, start, length)
        }
        val response = newFixedLengthResponse(status, mime, body, length)
        if (range != null) response.addHeader("Content-Range", "bytes $start-$end/$size")
        response.addHeader("Accept-Ranges", "bytes")
        response.addHeader("Content-Length", length.toString())
        return response
    }

    private fun parseRange(rangeHeader: String?, fileSize: Long): LongRange? {
        if (rangeHeader == null) return null
        if (!rangeHeader.startsWith("bytes=") || fileSize <= 0L) return null
        val value = rangeHeader.removePrefix("bytes=").substringBefore(',').trim()
        val separator = value.indexOf('-')
        if (separator < 0) return null
        val startValue = value.substring(0, separator).trim()
        val endValue = value.substring(separator + 1).trim()
        if (startValue.isEmpty()) {
            val suffix = endValue.toLongOrNull()?.takeIf { it > 0L } ?: return null
            return maxOf(0L, fileSize - suffix)..(fileSize - 1L)
        }
        val start = startValue.toLongOrNull()?.takeIf { it in 0L until fileSize } ?: return null
        val end = if (endValue.isEmpty()) fileSize - 1L else minOf(endValue.toLongOrNull() ?: return null, fileSize - 1L)
        if (end < start) return null
        return start..end
    }

    /** Reads [start, start + total) in 1 MB positioned reads. */
    private class RangeStream(private val entry: OpenFile, start: Long, total: Long) : InputStream() {
        private val buffer = ByteArray(READ_CHUNK)
        private var bufferStart = 0
        private var bufferEnd = 0
        private var position = start
        private var remaining = total

        private fun fill(): Boolean {
            if (remaining <= 0L) return false
            val want = minOf(READ_CHUNK.toLong(), remaining).toInt()
            val read = try {
                entry.read(buffer, position, want)
            } catch (error: Exception) {
                throw IOException("SMB read failed at $position: ${error.message}", error)
            }
            if (read <= 0) {
                remaining = 0L
                return false
            }
            bufferStart = 0
            bufferEnd = read
            position += read
            remaining -= read
            return true
        }

        override fun read(): Int {
            if (bufferStart >= bufferEnd && !fill()) return -1
            return buffer[bufferStart++].toInt() and 0xff
        }

        override fun read(b: ByteArray, off: Int, len: Int): Int {
            if (len == 0) return 0
            if (bufferStart >= bufferEnd && !fill()) return -1
            val count = minOf(len, bufferEnd - bufferStart)
            System.arraycopy(buffer, bufferStart, b, off, count)
            bufferStart += count
            return count
        }

        override fun available(): Int = bufferEnd - bufferStart
    }

    private fun guessMimeType(name: String): String {
        val lower = name.lowercase()
        return when {
            lower.endsWith(".mp4") || lower.endsWith(".m4v") -> "video/mp4"
            lower.endsWith(".mkv") -> "video/x-matroska"
            lower.endsWith(".avi") -> "video/x-msvideo"
            lower.endsWith(".webm") -> "video/webm"
            lower.endsWith(".mov") -> "video/quicktime"
            lower.endsWith(".ts") || lower.endsWith(".m2ts") -> "video/mp2t"
            lower.endsWith(".wmv") -> "video/x-ms-wmv"
            lower.endsWith(".srt") || lower.endsWith(".ass") || lower.endsWith(".ssa") -> "text/plain"
            else -> "application/octet-stream"
        }
    }
}
