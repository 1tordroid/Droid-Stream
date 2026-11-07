package com.vega

import org.bouncycastle.crypto.digests.MD4Digest
import java.io.BufferedInputStream
import java.io.BufferedOutputStream
import java.io.File
import java.io.IOException
import java.io.OutputStream
import java.io.RandomAccessFile
import java.net.InetSocketAddress
import java.net.Socket
import java.net.SocketTimeoutException
import java.nio.ByteBuffer
import java.nio.channels.FileChannel
import java.util.BitSet
import java.util.Timer
import java.util.TimerTask
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicLong
import java.util.zip.Inflater

/*
 * The eD2k download engine: one server connection shared by all downloads and
 * searches, and per download a coordinator thread plus one thread per peer
 * connection. Plain JVM code; Ed2kModule connects it to React Native.
 *
 * This client only downloads. It shares nothing: it offers an empty file list
 * to the server, never listens for connections (so servers give it a low ID),
 * and answers peers' file, upload and shared-list requests with "not found"
 * or "denied", which is all the protocol needs to be allowed to download.
 */

internal data class Ed2kStatus(
    val downloaded: Long,
    val total: Long,
    val speed: Long,
    val sources: Int,
    val downloading: Int,
    val queued: Int,
    val queueRank: Int,
    val state: String,
    val server: String,
    val message: String,
)

internal class Ed2kStoppedException(val reason: String) : IOException("Download $reason")

internal interface Ed2kHost {
    /** Null when transfers may run; otherwise a short reason to show. */
    fun blockedReason(wifiOnly: Boolean): String?
}

internal class Ed2kServerSession(private val userHash: ByteArray, private val listener: Listener) {
    interface Listener {
        fun onSources(hash: ByteArray, sources: List<Ed2kEndpoint>)
        fun onCallback(host: String, port: Int)
    }

    @Volatile var clientId = 0L
        private set
    @Volatile var flags = 0L
        private set
    @Volatile var entry: Ed2kServerEntry? = null
        private set
    @Volatile var serverIp: ByteArray? = null
        private set
    @Volatile var connectedAt = 0L
        private set
    @Volatile var message = ""
        private set
    @Volatile private var socket: Socket? = null
    private var output: OutputStream? = null
    private val writeLock = Any()
    private val searchGate = Any()
    private val searchLock = Object()
    private var pendingSearch: MutableList<Ed2kSearchResult>? = null
    private var searchAnswered = false

    val isConnected: Boolean get() = socket?.isClosed == false && clientId != 0L
    val endpoint: Ed2kEndpoint? get() = entry?.let { Ed2kEndpoint(it.host, it.port) }
    val largeFiles: Boolean get() = flags and Ed2k.SRV_TCPFLG_LARGEFILES != 0L
    val name: String get() = entry?.let { it.name.ifBlank { "${it.host}:${it.port}" } } ?: ""

    fun connect(candidates: List<Ed2kServerEntry>): Boolean {
        for (candidate in candidates) {
            try {
                if (login(candidate)) return true
            } catch (error: Exception) {
                message = error.message ?: "Could not reach ${candidate.host}"
            }
        }
        return false
    }

    private fun login(candidate: Ed2kServerEntry): Boolean {
        val connection = Socket()
        try {
            connection.connect(InetSocketAddress(candidate.host, candidate.port), CONNECT_TIMEOUT_MS)
            connection.soTimeout = LOGIN_TIMEOUT_MS
            connection.tcpNoDelay = true
            connection.keepAlive = true
            val out = BufferedOutputStream(connection.getOutputStream())
            val reader = Ed2kPacketReader(BufferedInputStream(connection.getInputStream()), Ed2k.PROT_EDONKEY)
            out.write(Ed2kMessages.login(userHash, Ed2k.DEFAULT_PORT))
            out.flush()
            val deadline = System.currentTimeMillis() + LOGIN_TIMEOUT_MS
            while (System.currentTimeMillis() < deadline) {
                val packet = reader.read()
                if (packet.isEdonkey() && packet.opcode == Ed2k.OP_IDCHANGE) {
                    val change = Ed2kParse.idChange(packet.payload)
                    if (change.clientId == 0L) throw IOException("The server refused the login")
                    clientId = change.clientId
                    flags = change.flags
                    entry = candidate
                    serverIp = connection.inetAddress?.address?.takeIf { it.size == 4 }
                    synchronized(writeLock) {
                        socket = connection
                        output = out
                    }
                    connectedAt = System.currentTimeMillis()
                    send(Ed2kMessages.offerNoFiles())
                    connection.soTimeout = KEEPALIVE_MS
                    Thread({ readLoop(connection, reader) }, "ed2k-server").apply { isDaemon = true }.start()
                    return true
                }
                if (packet.isEdonkey() && packet.opcode == Ed2k.OP_REJECT) throw IOException("The server rejected the login")
                handle(packet)
            }
            throw IOException("The server did not answer")
        } catch (error: Exception) {
            runCatching { connection.close() }
            throw error
        }
    }

    private fun readLoop(connection: Socket, reader: Ed2kPacketReader) {
        try {
            while (!connection.isClosed) {
                try {
                    handle(reader.read())
                } catch (idle: SocketTimeoutException) {
                    // An empty offer keeps the login alive.
                    if (!send(Ed2kMessages.offerNoFiles())) break
                }
            }
        } catch (error: Exception) {
            message = error.message ?: "Server connection lost"
        } finally {
            if (socket === connection) close()
        }
    }

    private fun handle(packet: Ed2kPacket) {
        if (!packet.isEdonkey()) return
        try {
            when (packet.opcode) {
                Ed2k.OP_SERVERMESSAGE -> Ed2kParse.serverMessage(packet.payload)
                    .lines().map { it.trim() }.lastOrNull { it.isNotEmpty() }?.let { message = it.take(200) }
                Ed2k.OP_IDCHANGE -> Ed2kParse.idChange(packet.payload).let {
                    if (it.clientId != 0L) {
                        clientId = it.clientId
                        flags = it.flags
                    }
                }
                Ed2k.OP_FOUNDSOURCES, Ed2k.OP_FOUNDSOURCES_OBFU -> {
                    val found = Ed2kParse.foundSources(packet.payload, packet.opcode == Ed2k.OP_FOUNDSOURCES_OBFU)
                    listener.onSources(found.hash, found.sources)
                }
                Ed2k.OP_CALLBACKREQUESTED -> Ed2kParse.callbackRequested(packet.payload).let {
                    listener.onCallback(it.host, it.port)
                }
                Ed2k.OP_SEARCHRESULT -> {
                    val results = Ed2kParse.searchResults(packet.payload)
                    synchronized(searchLock) {
                        pendingSearch?.addAll(results)
                        searchAnswered = true
                        searchLock.notifyAll()
                    }
                }
            }
        } catch (error: Ed2kProtocolException) {
            // One message we cannot read does not end the login.
        }
    }

    fun send(packet: ByteArray): Boolean = synchronized(writeLock) {
        val out = output ?: return false
        try {
            out.write(packet)
            out.flush()
            true
        } catch (error: IOException) {
            close()
            false
        }
    }

    fun requestSources(hash: ByteArray, size: Long): Boolean =
        runCatching { send(Ed2kMessages.getSources(hash, size, largeFiles)) }.getOrDefault(false)

    fun search(query: String, timeoutMs: Long): List<Ed2kSearchResult> = synchronized(searchGate) {
        synchronized(searchLock) {
            pendingSearch = mutableListOf()
            searchAnswered = false
            try {
                if (!send(Ed2kMessages.search(query))) throw IOException("Lost the server connection")
                val deadline = System.currentTimeMillis() + timeoutMs
                while (!searchAnswered) {
                    val left = deadline - System.currentTimeMillis()
                    if (left <= 0) break
                    searchLock.wait(left)
                }
                pendingSearch.orEmpty().toList()
            } finally {
                pendingSearch = null
            }
        }
    }

    fun close() {
        synchronized(writeLock) {
            runCatching { socket?.close() }
            socket = null
            output = null
        }
        clientId = 0L
    }

    companion object {
        private const val CONNECT_TIMEOUT_MS = 10_000
        private const val LOGIN_TIMEOUT_MS = 30_000
        private const val KEEPALIVE_MS = 10 * 60_000
    }
}

/** Owns the shared server connection and routes server messages to downloads. */
internal class Ed2kEngine(val userHash: ByteArray, val host: Ed2kHost) : Ed2kServerSession.Listener {
    private val transfers = ConcurrentHashMap<String, Ed2kTransfer>()
    @Volatile var servers: List<Ed2kServerEntry> = emptyList()
    @Volatile private var session: Ed2kServerSession? = null
    private val connectLock = Any()
    @Volatile private var connecting = false
    @Volatile private var failure = ""
    private var lastAttempt = 0L
    private var nextServer = 0
    private var searches = 0
    private val timer = Timer("ed2k-idle", true)
    private var idleTask: TimerTask? = null

    val lastMessage: String get() = session?.message?.ifBlank { null } ?: failure

    fun currentServer(): Ed2kServerSession? = session?.takeIf { it.isConnected }

    /**
     * The connected server, or null while a connection is being made in the
     * background. A failed attempt is not repeated for half a minute.
     */
    fun server(): Ed2kServerSession? {
        currentServer()?.let { return it }
        synchronized(connectLock) {
            val now = System.currentTimeMillis()
            if (connecting || servers.isEmpty() || now - lastAttempt < SERVER_RETRY_MS) return null
            connecting = true
            lastAttempt = now
        }
        Thread({
            try {
                connectNow()
            } finally {
                connecting = false
            }
        }, "ed2k-connect").apply { isDaemon = true }.start()
        return null
    }

    /** Waits for a server connection; used by search. */
    private fun serverNow(): Ed2kServerSession? {
        currentServer()?.let { return it }
        val deadline = System.currentTimeMillis() + 60_000
        while (connecting && System.currentTimeMillis() < deadline) Thread.sleep(250)
        currentServer()?.let { return it }
        synchronized(connectLock) {
            connecting = true
            lastAttempt = System.currentTimeMillis()
        }
        try {
            return connectNow()
        } finally {
            connecting = false
        }
    }

    /** Tries a few servers, starting where the last attempt stopped. */
    private fun connectNow(): Ed2kServerSession? {
        val list = servers
        if (list.isEmpty()) {
            failure = "Add an eD2k server first"
            return null
        }
        val start = synchronized(connectLock) { nextServer % list.size }
        val batch = (0 until minOf(SERVERS_PER_ATTEMPT, list.size)).map { list[(start + it) % list.size] }
        val next = Ed2kServerSession(userHash, this)
        val connected = next.connect(batch)
        synchronized(connectLock) {
            if (connected) {
                session?.close()
                session = next
                failure = ""
                nextServer = list.indexOf(next.entry).coerceAtLeast(0)
            } else {
                failure = next.message.ifBlank { "Could not reach an eD2k server" }
                nextServer = start + batch.size
            }
        }
        if (connected) transfers.values.forEach { it.wake() }
        return if (connected) next else null
    }

    fun add(transfer: Ed2kTransfer) {
        transfers[transfer.id] = transfer
        cancelIdle()
    }

    fun remove(transfer: Ed2kTransfer) {
        transfers.remove(transfer.id, transfer)
        closeWhenIdle()
    }

    fun search(query: String): List<Ed2kSearchResult> {
        synchronized(connectLock) { searches += 1 }
        cancelIdle()
        try {
            val server = serverNow()
                ?: throw IOException(lastMessage.ifBlank { "Could not reach an eD2k server. Check the server list." })
            return server.search(query, SEARCH_TIMEOUT_MS)
        } finally {
            synchronized(connectLock) { searches -= 1 }
            closeWhenIdle()
        }
    }

    override fun onSources(hash: ByteArray, sources: List<Ed2kEndpoint>) {
        transfers.values.filter { it.hash.contentEquals(hash) }.forEach { it.addSources(sources) }
    }

    override fun onCallback(host: String, port: Int) {
        transfers.values.forEach { it.onCallback(host, port) }
    }

    private fun cancelIdle() {
        synchronized(connectLock) {
            idleTask?.cancel()
            idleTask = null
        }
    }

    /** The server connection only stays while something uses it. */
    private fun closeWhenIdle() {
        synchronized(connectLock) {
            if (transfers.isNotEmpty() || searches > 0) return
            idleTask?.cancel()
            idleTask = object : TimerTask() {
                override fun run() {
                    synchronized(connectLock) {
                        if (transfers.isEmpty() && searches == 0) {
                            session?.close()
                            session = null
                        }
                    }
                }
            }.also { timer.schedule(it, IDLE_CLOSE_MS) }
        }
    }

    companion object {
        private const val SERVER_RETRY_MS = 30_000L
        private const val SERVERS_PER_ATTEMPT = 4
        private const val SEARCH_TIMEOUT_MS = 25_000L
        private const val IDLE_CLOSE_MS = 60_000L
    }
}

/** Received byte ranges of one block, merged; end exclusive. */
internal class Ed2kCoverage(private val start: Long, private val end: Long) {
    private val ranges = mutableListOf<LongArray>()

    fun add(from: Long, to: Long) {
        var low = maxOf(from, start)
        var high = minOf(to, end)
        if (low >= high) return
        val kept = mutableListOf<LongArray>()
        for (range in ranges) {
            if (range[1] < low || range[0] > high) {
                kept.add(range)
            } else {
                low = minOf(low, range[0])
                high = maxOf(high, range[1])
            }
        }
        kept.add(longArrayOf(low, high))
        kept.sortBy { it[0] }
        ranges.clear()
        ranges.addAll(kept)
    }

    val complete: Boolean get() = ranges.size == 1 && ranges[0][0] <= start && ranges[0][1] >= end
}

internal class Ed2kTransfer(
    val id: String,
    val hash: ByteArray,
    val size: Long,
    private val file: File,
    linkSources: List<Ed2kEndpoint>,
    linkPartHashes: List<ByteArray>?,
    private val wifiOnly: Boolean,
    private val engine: Ed2kEngine,
    private val onStatus: (Ed2kStatus) -> Unit,
    private val onDone: (Ed2kTransfer, Throwable?) -> Unit,
) {
    enum class Stop { NONE, PAUSE, CANCEL }

    @Volatile var stop = Stop.NONE
        private set

    private val lock = Object()
    private val stateFile = File(file.path + ".ed2k")
    private val map: Ed2kPartMap
    private var partHashes: List<ByteArray>?
    private lateinit var channel: FileChannel
    private val sources = LinkedHashMap<String, Source>()
    private val inFlight = HashMap<Int, Int>()
    private val partUsers = HashMap<Int, Int>()
    private val peers: MutableSet<Peer> = ConcurrentHashMap.newKeySet()
    private val written = AtomicLong(0)
    private val largeFile = size > Ed2k.OLD_MAX_FILE_SIZE
    private var dirty = false
    private var completed = false
    private var lastSourceRequest = 0L
    private var sourceRequestServer = 0L
    private var everHadSources = false
    private var message = ""
    private val startedAt = System.currentTimeMillis()

    private class Source(val endpoint: Ed2kEndpoint, val fromLink: Boolean) {
        var nextAttempt = 0L
        var failures = 0
        var connected = false
        var downloading = false
        var queueRank = 0
        var dead = false
    }

    private enum class Outcome { CONNECT_FAILED, FAILED, NO_FILE, NOTHING_NEEDED, QUEUED, SESSION_ENDED, STOPPED }

    init {
        val saved = if (file.exists() && stateFile.exists()) {
            runCatching { Ed2kPartMap.decode(stateFile.readBytes(), hash, size) }.getOrNull()
        } else {
            null
        }
        map = saved?.map ?: Ed2kPartMap(size)
        partHashes = saved?.partHashes ?: linkPartHashes?.let { Ed2kHash.acceptHashset(hash, it, size) }
        if (saved?.partHashes == null && partHashes != null) dirty = true
        addSources(linkSources, fromLink = true)
    }

    fun start() {
        engine.add(this)
        Thread({ run() }, "ed2k-$id").apply { isDaemon = true }.start()
    }

    fun requestStop(reason: Stop) {
        if (stop != Stop.NONE) return
        stop = reason
        peers.forEach { it.close() }
        wake()
    }

    /** Runs the coordinator loop now instead of after its pause. */
    fun wake() {
        synchronized(lock) { lock.notifyAll() }
    }

    private fun run() {
        var error: Throwable? = null
        try {
            file.parentFile?.mkdirs()
            RandomAccessFile(file, "rw").use { raf ->
                channel = raf.channel
                loop()
            }
        } catch (failure: Throwable) {
            error = failure
        } finally {
            peers.forEach { it.close() }
            engine.remove(this)
            when {
                stop == Stop.CANCEL -> {
                    file.delete()
                    stateFile.delete()
                }
                !completed -> runCatching { saveState() }
            }
        }
        val result = when {
            stop == Stop.PAUSE -> Ed2kStoppedException("paused")
            stop == Stop.CANCEL -> Ed2kStoppedException("cancelled")
            completed -> null
            else -> error ?: IOException("Download stopped")
        }
        onDone(this, result)
    }

    private fun loop() {
        var lastEmit = 0L
        var lastSave = System.currentTimeMillis()
        var lastWritten = 0L
        var speed = 0.0
        // Parts finished before a restart that could not be checked then.
        verifyFilledParts()
        while (stop == Stop.NONE) {
            if (map.complete()) {
                finishFile()
                return
            }
            val now = System.currentTimeMillis()
            val blocked = engine.host.blockedReason(wifiOnly)
            if (blocked != null) {
                peers.forEach { it.close() }
                emit(Ed2kStatus(doneBytes(), size, 0, 0, 0, 0, 0, "waitingForNetwork", "", blocked))
                lastEmit = now
                sleep(3_000)
                continue
            }
            val server = engine.server()
            if (server != null && (now - lastSourceRequest > SOURCE_REASK_MS || sourceRequestServer != server.connectedAt)) {
                if (server.requestSources(hash, size)) {
                    lastSourceRequest = now
                    sourceRequestServer = server.connectedAt
                }
            }
            startPeers(now)
            if (dirty && now - lastSave > SAVE_INTERVAL_MS) {
                saveState()
                lastSave = now
            }
            if (now - lastEmit >= EMIT_INTERVAL_MS) {
                val total = written.get()
                val elapsed = (now - lastEmit).coerceAtLeast(1)
                val instant = if (lastEmit == 0L) 0.0 else (total - lastWritten) * 1000.0 / elapsed
                speed = if (speed == 0.0) instant else speed * 0.6 + instant * 0.4
                lastWritten = total
                lastEmit = now
                emit(status(speed.toLong(), server))
            }
            val noSources = synchronized(lock) { sources.values.none { !it.dead } }
            if (noSources && !everHadSources && now - startedAt > NO_SOURCES_TIMEOUT_MS) {
                throw IOException("No sources found for this file right now. Try again later.")
            }
            // Check less often while no peer connection is open.
            sleep(if (peers.isEmpty()) 3_000 else 1_000)
        }
    }

    private fun sleep(ms: Long) {
        synchronized(lock) {
            if (stop == Stop.NONE) lock.wait(ms)
        }
    }

    private fun emit(status: Ed2kStatus) {
        runCatching { onStatus(status) }
    }

    private fun doneBytes(): Long = synchronized(lock) { map.doneBytes() }

    private fun status(speed: Long, server: Ed2kServerSession?): Ed2kStatus = synchronized(lock) {
        val live = sources.values.filter { !it.dead }
        val downloading = live.count { it.downloading }
        val queued = live.filter { it.queueRank > 0 && !it.downloading }
        val state = when {
            downloading > 0 -> "downloading"
            queued.isNotEmpty() -> "queued"
            server == null -> "connecting"
            else -> "searching"
        }
        Ed2kStatus(
            downloaded = map.doneBytes(),
            total = size,
            speed = if (downloading > 0) speed else 0,
            sources = live.size,
            downloading = downloading,
            queued = queued.size,
            queueRank = queued.minOfOrNull { it.queueRank } ?: 0,
            state = state,
            server = server?.name.orEmpty(),
            message = message.ifBlank { if (server == null) engine.lastMessage else "" },
        )
    }

    private fun startPeers(now: Long) {
        synchronized(lock) {
            val free = MAX_PEERS - peers.size
            if (free <= 0) return
            val ready = sources.values
                .filter { !it.connected && !it.dead && it.nextAttempt <= now }
                .sortedBy { it.nextAttempt }
                .take(free)
            for (source in ready) {
                source.connected = true
                val peer = Peer(source)
                peers.add(peer)
                Thread(peer, "ed2k-peer").apply { isDaemon = true }.start()
            }
        }
    }

    fun addSources(found: List<Ed2kEndpoint>, fromLink: Boolean = false) {
        synchronized(lock) {
            for (endpoint in found) {
                if (sources.size >= MAX_SOURCES) break
                val key = "${endpoint.host}:${endpoint.port}"
                if (!sources.containsKey(key)) sources[key] = Source(endpoint, fromLink)
            }
            if (sources.isNotEmpty()) everHadSources = true
            lock.notifyAll()
        }
    }

    /** A peer whose queue we wait in asked, through the server, for us to connect now. */
    fun onCallback(host: String, port: Int) {
        synchronized(lock) {
            val known = sources.values.filter { it.endpoint.host == host }
            if (known.isEmpty()) {
                if (sources.size < MAX_SOURCES) sources["$host:$port"] = Source(Ed2kEndpoint(host, port), false)
            } else {
                known.forEach { if (!it.dead) it.nextAttempt = 0 }
            }
            lock.notifyAll()
        }
    }

    private fun needsHashset(): Boolean = synchronized(lock) { map.partCount > 1 && partHashes == null }

    private fun offerHashset(hashes: List<ByteArray>) {
        synchronized(lock) {
            if (partHashes != null) return
            partHashes = Ed2kHash.acceptHashset(hash, hashes, size) ?: return
            dirty = true
        }
        verifyFilledParts()
    }

    private fun claimBlocks(peer: Peer, max: Int): List<Int> = synchronized(lock) {
        val blocks = map.pick(peer.parts, inFlight.keys, partUsers, peer.part, max, peer.blocks.keys)
        blocks.forEach { inFlight[it] = (inFlight[it] ?: 0) + 1 }
        blocks.firstOrNull()?.let { block -> usePart(peer, map.partOf(block)) }
        blocks
    }

    private fun usePart(peer: Peer, part: Int?) {
        if (peer.part == part) return
        peer.part?.let { old -> partUsers[old] = (partUsers[old] ?: 1) - 1 }
        part?.let { partUsers[it] = (partUsers[it] ?: 0) + 1 }
        peer.part = part
    }

    private fun releaseBlock(block: Int) {
        val count = (inFlight[block] ?: return) - 1
        if (count <= 0) inFlight.remove(block) else inFlight[block] = count
    }

    private fun blockDone(block: Int) {
        val part: Int
        synchronized(lock) {
            releaseBlock(block)
            if (map.done.get(block)) return
            map.done.set(block)
            dirty = true
            part = map.partOf(block)
            if (!map.isPartFilled(part) || map.verified.get(part)) return
        }
        verifyPart(part)
    }

    private fun verifyFilledParts() {
        val filled = synchronized(lock) { (0 until map.partCount).filter { !map.verified.get(it) && map.isPartFilled(it) } }
        filled.forEach { verifyPart(it) }
    }

    /** Checks a filled part against its MD4 hash. A bad part is downloaded again. */
    private fun verifyPart(part: Int) {
        val expected = synchronized(lock) { partHashes?.getOrNull(part) }
        if (map.partCount > 1 && expected == null) return // Checked once the hashset arrives.
        val actual = md4Of(Ed2kHash.partStart(part), Ed2kHash.partEnd(size, part))
        val good = if (map.partCount == 1) Ed2kHash.matchesFile(hash, listOf(actual), size) else expected!!.contentEquals(actual)
        synchronized(lock) {
            if (good) {
                map.verified.set(part)
            } else {
                map.clearPart(part)
                message = "A part failed its check and is downloading again"
            }
            dirty = true
            lock.notifyAll()
        }
    }

    private fun md4Of(start: Long, end: Long): ByteArray {
        val digest = MD4Digest()
        val buffer = ByteBuffer.allocate(256 * 1024)
        var position = start
        while (position < end) {
            buffer.clear()
            buffer.limit(minOf(buffer.capacity().toLong(), end - position).toInt())
            val count = channel.read(buffer, position)
            if (count <= 0) throw IOException("Partial file is shorter than expected")
            digest.update(buffer.array(), 0, count)
            position += count
        }
        val out = ByteArray(16)
        digest.doFinal(out, 0)
        return out
    }

    /** Every part matched its hash and the part hashes match the file hash. */
    private fun finishFile() {
        val hashes = synchronized(lock) { partHashes }
        if (map.partCount > 1 && (hashes == null || !Ed2kHash.matchesFile(hash, hashes, size))) {
            throw IOException("The finished file does not match its eD2k hash")
        }
        if (channel.size() > size) channel.truncate(size)
        channel.force(true)
        completed = true
        stateFile.delete()
        emit(Ed2kStatus(size, size, 0, 0, 0, 0, 0, "completed", "", ""))
    }

    private fun saveState() {
        val data = synchronized(lock) {
            dirty = false
            map.encode(hash, partHashes)
        }
        val temp = File(stateFile.path + ".tmp")
        temp.writeBytes(data)
        if (!temp.renameTo(stateFile)) {
            stateFile.delete()
            temp.renameTo(stateFile)
        }
    }

    /** One connection to one peer, from hello to the end of its upload slot. */
    private inner class Peer(private val source: Source) : Runnable {
        private val socket = Socket()
        @Volatile private var closed = false
        private var out: OutputStream? = null
        private var outcome = Outcome.CONNECT_FAILED
        private var asked = false
        private var downloading = false
        // Guarded by the transfer lock.
        var parts: BitSet? = null
        var part: Int? = null
        val blocks = LinkedHashMap<Int, Ed2kCoverage>()
        // Compressed block being received.
        private var inflater: Inflater? = null
        private var packedStart = -1L
        private var packedSize = 0L
        private var packedReceived = 0L
        private var unpacked = 0L
        private val inflateBuffer = ByteArray(64 * 1024)

        override fun run() {
            try {
                socket.connect(InetSocketAddress(source.endpoint.host, source.endpoint.port), CONNECT_TIMEOUT_MS)
                socket.soTimeout = READ_TIMEOUT_MS
                socket.tcpNoDelay = true
                out = BufferedOutputStream(socket.getOutputStream(), 8 * 1024)
                val reader = Ed2kPacketReader(BufferedInputStream(socket.getInputStream(), 64 * 1024), Ed2k.PROT_EMULE)
                val server = engine.currentServer()
                send(Ed2kMessages.hello(engine.userHash, server?.clientId ?: 0, Ed2k.DEFAULT_PORT, server?.endpoint, server?.serverIp, answer = false))
                while (!closed && stop == Stop.NONE) {
                    if (!handle(reader.read())) break
                }
            } catch (error: Exception) {
                // The outcome set so far decides when this source is tried again.
            } finally {
                finish()
            }
        }

        fun close() {
            if (closed) return
            closed = true
            if (downloading) runCatching { send(Ed2kMessages.cancelTransfer()) }
            runCatching { socket.close() }
        }

        private fun send(packet: ByteArray) {
            val stream = out ?: throw IOException("Not connected")
            synchronized(stream) {
                stream.write(packet)
                stream.flush()
            }
        }

        /** Returns false when the connection should end. */
        private fun handle(packet: Ed2kPacket): Boolean {
            if (packet.isEdonkey()) {
                when (packet.opcode) {
                    Ed2k.OP_HELLOANSWER -> {
                        outcome = Outcome.FAILED
                        send(Ed2kMessages.requestFileName(hash))
                        send(Ed2kMessages.setRequestedFile(hash))
                    }
                    Ed2k.OP_HELLO -> {
                        val server = engine.currentServer()
                        send(Ed2kMessages.hello(engine.userHash, server?.clientId ?: 0, Ed2k.DEFAULT_PORT, server?.endpoint, server?.serverIp, answer = true))
                    }
                    Ed2k.OP_FILEREQANSNOFIL -> if (isOurs(packet.payload)) {
                        outcome = Outcome.NO_FILE
                        return false
                    }
                    Ed2k.OP_FILESTATUS -> {
                        if (!isOurs(packet.payload)) return true
                        val status = Ed2kParse.fileStatus(packet.payload, map.partCount)
                        val wanted = synchronized(lock) {
                            parts = status
                            map.wants(status)
                        }
                        if (!wanted) {
                            outcome = Outcome.NOTHING_NEEDED
                            return false
                        }
                        if (needsHashset()) send(Ed2kMessages.hashsetRequest(hash)) else askUpload()
                    }
                    Ed2k.OP_HASHSETANSWER -> {
                        val set = Ed2kParse.hashset(packet.payload)
                        if (set.hash.contentEquals(hash)) offerHashset(set.parts)
                        askUpload()
                    }
                    Ed2k.OP_QUEUERANK -> return queued(Ed2kParse.queueRank(packet))
                    Ed2k.OP_ACCEPTUPLOADREQ -> {
                        downloading = true
                        synchronized(lock) {
                            source.downloading = true
                            source.queueRank = 0
                            source.failures = 0
                        }
                        outcome = Outcome.SESSION_ENDED
                        return requestMore()
                    }
                    Ed2k.OP_SENDINGPART -> return onData(packet.payload, Ed2kParse.sendingPart(packet.payload, false))
                    Ed2k.OP_OUTOFPARTREQS -> {
                        // The upload slot ended; join the queue again.
                        endSlot()
                        asked = false
                        askUpload()
                    }
                    // This client shares nothing.
                    Ed2k.OP_REQUESTFILENAME, Ed2k.OP_SETREQFILEID, Ed2k.OP_STARTUPLOADREQ, Ed2k.OP_HASHSETREQUEST ->
                        if (packet.payload.size >= 16) send(Ed2kMessages.fileNotFound(packet.payload.copyOfRange(0, 16)))
                    Ed2k.OP_ASKSHAREDFILES, Ed2k.OP_ASKSHAREDDIRS, Ed2k.OP_ASKSHAREDFILESDIR ->
                        send(Ed2kMessages.sharedFilesDenied())
                }
            } else if (packet.isEmule()) {
                when (packet.opcode) {
                    Ed2k.OP_EMULEINFO -> send(Ed2kMessages.emuleInfoAnswer())
                    Ed2k.OP_QUEUERANKING -> return queued(Ed2kParse.queueRank(packet))
                    Ed2k.OP_SENDINGPART_I64 -> return onData(packet.payload, Ed2kParse.sendingPart(packet.payload, true))
                    Ed2k.OP_COMPRESSEDPART -> return onCompressed(packet.payload, Ed2kParse.compressedPart(packet.payload, false))
                    Ed2k.OP_COMPRESSEDPART_I64 -> return onCompressed(packet.payload, Ed2kParse.compressedPart(packet.payload, true))
                }
            }
            return true
        }

        private fun isOurs(payload: ByteArray) = payload.size >= 16 && payload.copyOfRange(0, 16).contentEquals(hash)

        private fun askUpload() {
            if (asked) return
            asked = true
            send(Ed2kMessages.startUpload(hash))
        }

        private fun queued(rank: Int): Boolean {
            synchronized(lock) { source.queueRank = rank.coerceAtLeast(1) }
            outcome = Outcome.QUEUED
            // The peer closes the connection now; we ask again later or when it calls back.
            return false
        }

        /** Keeps three blocks requested. Returns false when nothing is left to ask this peer for. */
        private fun requestMore(): Boolean {
            val want = synchronized(lock) { MAX_REQUESTED - blocks.size }
            if (want <= 0) return true
            val picked = claimBlocks(this, want)
            if (picked.isEmpty()) {
                val idle = synchronized(lock) { blocks.isEmpty() }
                if (idle) {
                    outcome = Outcome.NOTHING_NEEDED
                    return false
                }
                return true
            }
            val ranges = synchronized(lock) {
                picked.map { block ->
                    val range = map.range(block)
                    blocks[block] = Ed2kCoverage(range.first, range.last + 1)
                    range
                }
            }
            send(Ed2kMessages.requestParts(hash, ranges, largeFile))
            return true
        }

        private fun onData(payload: ByteArray, block: Ed2kParse.DataBlock): Boolean {
            if (!block.hash.contentEquals(hash)) return true
            store(block.start, payload, block.dataOffset, (block.end - block.start).toInt())
            return requestMore()
        }

        private fun onCompressed(payload: ByteArray, block: Ed2kParse.DataBlock): Boolean {
            if (!block.hash.contentEquals(hash)) return true
            if (block.start != packedStart) {
                inflater?.end()
                inflater = Inflater()
                packedStart = block.start
                packedSize = block.end
                packedReceived = 0
                unpacked = 0
            }
            val zip = inflater!!
            val length = payload.size - block.dataOffset
            zip.setInput(payload, block.dataOffset, length)
            packedReceived += length
            try {
                while (true) {
                    val count = zip.inflate(inflateBuffer)
                    if (count == 0) {
                        if (zip.finished() || zip.needsInput()) break
                        throw Ed2kProtocolException("Bad compressed block")
                    }
                    store(packedStart + unpacked, inflateBuffer, 0, count)
                    unpacked += count
                }
            } catch (error: java.util.zip.DataFormatException) {
                throw Ed2kProtocolException("Bad compressed block")
            }
            if (packedReceived >= packedSize || zip.finished()) {
                zip.end()
                inflater = null
                packedStart = -1
            }
            return requestMore()
        }

        /** Writes only the bytes that fall inside blocks this peer was asked for. */
        private fun store(position: Long, data: ByteArray, offset: Int, length: Int) {
            if (length <= 0) return
            val end = position + length
            val finished = mutableListOf<Int>()
            val targets = synchronized(lock) {
                // A block another peer already finished (end game) is not written again.
                blocks.keys.filter { map.done.get(it) }.forEach {
                    blocks.remove(it)
                    releaseBlock(it)
                }
                blocks.entries.map { it.key to it.value }
            }
            for ((block, coverage) in targets) {
                val range = map.range(block)
                val from = maxOf(position, range.first)
                val to = minOf(end, range.last + 1)
                if (from >= to) continue
                val buffer = ByteBuffer.wrap(data, offset + (from - position).toInt(), (to - from).toInt())
                var at = from
                while (buffer.hasRemaining()) at += channel.write(buffer, at)
                written.addAndGet(to - from)
                synchronized(lock) {
                    coverage.add(from, to)
                    if (coverage.complete) {
                        blocks.remove(block)
                        finished.add(block)
                    }
                }
            }
            finished.forEach { blockDone(it) }
        }

        private fun endSlot() {
            synchronized(lock) {
                blocks.keys.forEach { releaseBlock(it) }
                blocks.clear()
                usePart(this, null)
                source.downloading = false
            }
            downloading = false
            inflater?.end()
            inflater = null
            packedStart = -1
        }

        private fun finish() {
            if (stop != Stop.NONE || closed) outcome = Outcome.STOPPED
            runCatching { socket.close() }
            closed = true
            endSlot()
            peers.remove(this)
            val now = System.currentTimeMillis()
            synchronized(lock) {
                source.connected = false
                when (outcome) {
                    Outcome.CONNECT_FAILED -> {
                        source.failures += 1
                        if (source.failures >= MAX_CONNECT_FAILURES && !source.fromLink) source.dead = true
                        source.nextAttempt = now + RETRY_MS * source.failures
                    }
                    Outcome.FAILED -> {
                        source.failures += 1
                        if (source.failures >= MAX_CONNECT_FAILURES * 2) source.dead = true
                        source.nextAttempt = now + RETRY_MS * 2
                    }
                    Outcome.NO_FILE -> {
                        source.dead = !source.fromLink
                        source.nextAttempt = now + REASK_MS
                    }
                    Outcome.NOTHING_NEEDED -> source.nextAttempt = now + NOTHING_NEEDED_RETRY_MS
                    // eMule drops waiting clients that ask again too often.
                    Outcome.QUEUED -> source.nextAttempt = now + REASK_MS
                    Outcome.SESSION_ENDED -> source.nextAttempt = now + SESSION_RETRY_MS
                    Outcome.STOPPED -> source.nextAttempt = now + STOPPED_RETRY_MS
                }
                lock.notifyAll()
            }
        }
    }

    companion object {
        private const val MAX_PEERS = 8
        private const val MAX_SOURCES = 400
        private const val MAX_REQUESTED = 3
        private const val MAX_CONNECT_FAILURES = 3
        private const val CONNECT_TIMEOUT_MS = 10_000
        private const val READ_TIMEOUT_MS = 40_000
        private const val RETRY_MS = 5 * 60_000L
        private const val REASK_MS = 29 * 60_000L
        private const val NOTHING_NEEDED_RETRY_MS = 20 * 60_000L
        private const val SESSION_RETRY_MS = 60_000L
        private const val STOPPED_RETRY_MS = 5_000L
        private const val SOURCE_REASK_MS = 15 * 60_000L
        private const val SAVE_INTERVAL_MS = 5_000L
        private const val EMIT_INTERVAL_MS = 1_000L
        private const val NO_SOURCES_TIMEOUT_MS = 20 * 60_000L
    }
}
