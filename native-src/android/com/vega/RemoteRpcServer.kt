package com.vega

import android.util.Base64
import java.io.BufferedInputStream
import java.io.ByteArrayOutputStream
import java.io.IOException
import java.io.InputStream
import java.io.OutputStream
import java.net.Inet4Address
import java.net.Inet6Address
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.ServerSocket
import java.net.Socket
import java.net.SocketException
import java.security.MessageDigest
import java.util.concurrent.RejectedExecutionException
import java.util.concurrent.SynchronousQueue
import java.util.concurrent.ThreadPoolExecutor
import java.util.concurrent.TimeUnit

/**
 * A small HTTP and WebSocket server for remote control (aria2-style JSON-RPC
 * at /jsonrpc). Written for Droid Stream.
 *
 * It listens on the Wi-Fi address only and drops connections from addresses
 * outside the home network before reading them. Request heads and bodies have
 * size limits, a few connections are served at a time, and slow clients time
 * out. The JSON-RPC itself (token checks included) is answered by [handler].
 */
class RemoteRpcServer(
    private val bindAddress: InetAddress,
    val port: Int,
    private val maxBodyBytes: Int,
    private val handler: (client: String, body: String) -> String?,
) {
    companion object {
        private const val TAG = "RemoteRpcServer"
        private const val MAX_HEAD_BYTES = 16 * 1024
        private const val MAX_CONNECTIONS = 12
        private const val HTTP_TIMEOUT_MS = 15_000
        private const val WEBSOCKET_IDLE_MS = 5 * 60_000
        private const val WEBSOCKET_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"

        /** Loopback, RFC 1918, link-local and IPv6 unique local addresses. */
        fun isLanClient(address: InetAddress?): Boolean {
            if (address == null) return false
            if (address.isLoopbackAddress || address.isLinkLocalAddress) return true
            return when (address) {
                is Inet4Address -> address.isSiteLocalAddress
                is Inet6Address -> (address.address[0].toInt() and 0xfe) == 0xfc
                else -> false
            }
        }
    }

    private val serverSocket = ServerSocket()
    private val workers = ThreadPoolExecutor(1, MAX_CONNECTIONS, 30, TimeUnit.SECONDS, SynchronousQueue()) { runnable ->
        Thread(runnable, "RemoteRpc").apply { isDaemon = true }
    }
    private val openSockets = java.util.Collections.newSetFromMap(java.util.concurrent.ConcurrentHashMap<Socket, Boolean>())
    @Volatile private var running = false

    val address: InetAddress get() = bindAddress

    @Throws(IOException::class)
    fun start() {
        serverSocket.reuseAddress = true
        serverSocket.bind(InetSocketAddress(bindAddress, port), 16)
        running = true
        Thread({ acceptLoop() }, "RemoteRpcAccept").apply { isDaemon = true }.start()
    }

    fun stop() {
        running = false
        runCatching { serverSocket.close() }
        openSockets.toList().forEach { runCatching { it.close() } }
        workers.shutdownNow()
    }

    private fun acceptLoop() {
        while (running) {
            val socket = try {
                serverSocket.accept()
            } catch (error: IOException) {
                if (running) VegaLog.w(TAG, "Accept failed: ${error.message}")
                break
            }
            if (!isLanClient(socket.inetAddress)) {
                runCatching { socket.close() }
                continue
            }
            try {
                workers.execute { serve(socket) }
            } catch (_: RejectedExecutionException) {
                runCatching { socket.close() }
            }
        }
    }

    private class HttpRequest(val method: String, val path: String, val headers: Map<String, String>)

    private fun serve(socket: Socket) {
        openSockets.add(socket)
        try {
            socket.soTimeout = HTTP_TIMEOUT_MS
            socket.tcpNoDelay = true
            val input = BufferedInputStream(socket.getInputStream())
            val output = socket.getOutputStream()
            val client = socket.inetAddress.hostAddress ?: ""
            val request = readHead(input) ?: return respond(output, 400, "Bad Request")
            val path = request.path.substringBefore('?')
            if (path != "/jsonrpc") return respond(output, 404, "Not Found")
            when {
                request.method == "OPTIONS" -> preflight(output, request)
                request.method == "GET" && request.headers["upgrade"]?.equals("websocket", true) == true ->
                    webSocket(socket, input, output, request, client)
                request.method == "POST" -> post(input, output, request, client)
                else -> respond(output, 405, "Method Not Allowed")
            }
        } catch (_: SocketException) {
        } catch (error: IOException) {
            VegaLog.w(TAG, "Request failed: ${error.message}")
        } catch (error: Exception) {
            VegaLog.e(TAG, "Request failed", error)
        } finally {
            openSockets.remove(socket)
            runCatching { socket.close() }
        }
    }

    private fun readHead(input: InputStream): HttpRequest? {
        val bytes = ByteArrayOutputStream()
        var matched = 0
        val end = byteArrayOf('\r'.code.toByte(), '\n'.code.toByte(), '\r'.code.toByte(), '\n'.code.toByte())
        while (matched < 4) {
            val next = input.read()
            if (next < 0) return null
            bytes.write(next)
            if (bytes.size() > MAX_HEAD_BYTES) return null
            matched = if (next.toByte() == end[matched]) matched + 1 else if (next.toByte() == end[0]) 1 else 0
        }
        val lines = bytes.toString(Charsets.ISO_8859_1.name()).split("\r\n")
        val parts = lines.firstOrNull()?.split(' ') ?: return null
        if (parts.size != 3 || !parts[2].startsWith("HTTP/1.")) return null
        val headers = HashMap<String, String>()
        for (line in lines.drop(1)) {
            if (line.isEmpty()) continue
            val colon = line.indexOf(':')
            if (colon <= 0) return null
            headers[line.substring(0, colon).trim().lowercase()] = line.substring(colon + 1).trim()
        }
        return HttpRequest(parts[0].uppercase(), parts[1], headers)
    }

    private fun corsHeaders(request: HttpRequest?): String {
        val builder = StringBuilder("Access-Control-Allow-Origin: *\r\n")
        if (request?.headers?.get("access-control-request-private-network") == "true") {
            builder.append("Access-Control-Allow-Private-Network: true\r\n")
        }
        return builder.toString()
    }

    private fun respond(output: OutputStream, status: Int, reason: String, body: ByteArray = ByteArray(0), contentType: String = "text/plain; charset=utf-8", extra: String = "") {
        val head = StringBuilder()
            .append("HTTP/1.1 $status $reason\r\n")
            .append("Content-Type: $contentType\r\n")
            .append("Content-Length: ${body.size}\r\n")
            .append("Cache-Control: no-store\r\n")
            .append("Connection: close\r\n")
            .append(extra)
            .append("\r\n")
        output.write(head.toString().toByteArray(Charsets.ISO_8859_1))
        output.write(body)
        output.flush()
    }

    private fun preflight(output: OutputStream, request: HttpRequest) {
        val asked = request.headers["access-control-request-headers"]
            ?.split(',')
            ?.map { it.trim() }
            ?.filter { it.matches(Regex("[A-Za-z0-9-]{1,64}")) }
            ?.joinToString(", ")
            ?.ifEmpty { null }
            ?: "Content-Type"
        respond(
            output, 204, "No Content",
            extra = corsHeaders(request) +
                "Access-Control-Allow-Methods: POST, GET, OPTIONS\r\n" +
                "Access-Control-Allow-Headers: $asked\r\n" +
                "Access-Control-Max-Age: 1728000\r\n",
        )
    }

    private fun post(input: InputStream, output: OutputStream, request: HttpRequest, client: String) {
        if (request.headers["transfer-encoding"] != null) return respond(output, 411, "Length Required")
        val length = request.headers["content-length"]?.toLongOrNull() ?: return respond(output, 411, "Length Required")
        if (length < 0 || length > maxBodyBytes) return respond(output, 413, "Payload Too Large")
        val body = ByteArray(length.toInt())
        var read = 0
        while (read < body.size) {
            val count = input.read(body, read, body.size - read)
            if (count < 0) return
            read += count
        }
        val reply = handler(client, String(body, Charsets.UTF_8))
        respond(
            output, 200, "OK",
            body = (reply ?: "").toByteArray(Charsets.UTF_8),
            contentType = "application/json-rpc; charset=utf-8",
            extra = corsHeaders(request),
        )
    }

    // ---- WebSocket (RFC 6455): text messages carry the same JSON-RPC ----

    private fun webSocket(socket: Socket, input: InputStream, output: OutputStream, request: HttpRequest, client: String) {
        val key = request.headers["sec-websocket-key"]
        val connection = request.headers["connection"]?.lowercase() ?: ""
        if (key.isNullOrBlank() || !connection.contains("upgrade") || request.headers["sec-websocket-version"] != "13") {
            return respond(output, 400, "Bad Request")
        }
        val accept = Base64.encodeToString(
            MessageDigest.getInstance("SHA-1").digest((key.trim() + WEBSOCKET_GUID).toByteArray(Charsets.ISO_8859_1)),
            Base64.NO_WRAP,
        )
        output.write(
            ("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n" +
                "Sec-WebSocket-Accept: $accept\r\n\r\n").toByteArray(Charsets.ISO_8859_1),
        )
        output.flush()
        socket.soTimeout = WEBSOCKET_IDLE_MS
        val message = ByteArrayOutputStream()
        var messageOpcode = -1
        while (true) {
            val first = input.read()
            if (first < 0) return
            val second = input.read()
            if (second < 0) return
            val fin = (first and 0x80) != 0
            val opcode = first and 0x0f
            if ((second and 0x80) == 0) return close(output, 1002)
            var length = (second and 0x7f).toLong()
            if (length == 126L) length = readNumber(input, 2)
            else if (length == 127L) length = readNumber(input, 8)
            if (length < 0 || length > maxBodyBytes || message.size() + length > maxBodyBytes) return close(output, 1009)
            val mask = readExactly(input, 4) ?: return
            val payload = readExactly(input, length.toInt()) ?: return
            for (index in payload.indices) payload[index] = (payload[index].toInt() xor mask[index % 4].toInt()).toByte()
            when (opcode) {
                0x8 -> return close(output, 1000)
                0x9 -> writeFrame(output, 0xA, payload)
                0xA -> Unit
                0x1, 0x0 -> {
                    if (opcode == 0x1) {
                        message.reset()
                        messageOpcode = 0x1
                    } else if (messageOpcode != 0x1) {
                        return close(output, 1002)
                    }
                    message.write(payload)
                    if (fin) {
                        val text = message.toString(Charsets.UTF_8.name())
                        message.reset()
                        messageOpcode = -1
                        handler(client, text)?.let { writeFrame(output, 0x1, it.toByteArray(Charsets.UTF_8)) }
                    }
                }
                else -> return close(output, 1003)
            }
        }
    }

    private fun readNumber(input: InputStream, bytes: Int): Long {
        var value = 0L
        repeat(bytes) {
            val next = input.read()
            if (next < 0) return -1
            value = (value shl 8) or next.toLong()
        }
        return value
    }

    private fun readExactly(input: InputStream, size: Int): ByteArray? {
        val buffer = ByteArray(size)
        var read = 0
        while (read < size) {
            val count = input.read(buffer, read, size - read)
            if (count < 0) return null
            read += count
        }
        return buffer
    }

    private fun writeFrame(output: OutputStream, opcode: Int, payload: ByteArray) {
        synchronized(output) {
            val head = ByteArrayOutputStream()
            head.write(0x80 or opcode)
            when {
                payload.size < 126 -> head.write(payload.size)
                payload.size <= 0xffff -> {
                    head.write(126)
                    head.write(payload.size shr 8)
                    head.write(payload.size and 0xff)
                }
                else -> {
                    head.write(127)
                    for (shift in 56 downTo 0 step 8) head.write(((payload.size.toLong() shr shift) and 0xff).toInt())
                }
            }
            output.write(head.toByteArray())
            output.write(payload)
            output.flush()
        }
    }

    private fun close(output: OutputStream, code: Int) {
        runCatching { writeFrame(output, 0x8, byteArrayOf((code shr 8).toByte(), (code and 0xff).toByte())) }
    }
}
