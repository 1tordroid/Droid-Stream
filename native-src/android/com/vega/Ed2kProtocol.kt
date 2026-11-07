package com.vega

import org.bouncycastle.crypto.digests.MD4Digest
import java.io.ByteArrayOutputStream
import java.io.EOFException
import java.io.IOException
import java.io.InputStream
import java.util.BitSet
import java.util.zip.Inflater

/*
 * eD2k wire format: packet framing, tags, the messages this client sends and
 * reads, part/block bookkeeping, and MD4 part hashing. Written from the public
 * eDonkey/eMule protocol descriptions. Nothing here touches Android, so the
 * encoding and hashing can be checked on a plain JVM.
 *
 * All integers on the wire are little-endian. A packet is
 * [protocol: 1][size: 4 = opcode + payload][opcode: 1][payload].
 */
internal object Ed2k {
    const val PROT_EDONKEY = 0xE3
    const val PROT_EMULE = 0xC5
    const val PROT_PACKED = 0xD4

    /** One eD2k part: 9500 KiB, hashed with MD4. */
    const val PART_SIZE = 9_728_000L
    /** Parts are fetched in 180 KiB blocks. */
    const val BLOCK_SIZE = 184_320L
    /** Files above this need the 64-bit messages. */
    const val OLD_MAX_FILE_SIZE = 4_290_048_000L

    const val DEFAULT_PORT = 4662
    const val EDONKEY_VERSION = 0x3C
    /** Search results and server lists can be large; data packets are ~10 KB. */
    const val MAX_PACKET_SIZE = 4 * 1024 * 1024

    // Client to server.
    const val OP_LOGINREQUEST = 0x01
    const val OP_GETSERVERLIST = 0x14
    const val OP_OFFERFILES = 0x15
    const val OP_SEARCHREQUEST = 0x16
    const val OP_GETSOURCES = 0x19

    // Server to client.
    const val OP_REJECT = 0x05
    const val OP_SERVERLIST = 0x32
    const val OP_SEARCHRESULT = 0x33
    const val OP_SERVERSTATUS = 0x34
    const val OP_CALLBACKREQUESTED = 0x35
    const val OP_CALLBACK_FAIL = 0x36
    const val OP_SERVERMESSAGE = 0x38
    const val OP_IDCHANGE = 0x40
    const val OP_SERVERIDENT = 0x41
    const val OP_FOUNDSOURCES = 0x42
    const val OP_FOUNDSOURCES_OBFU = 0x44

    // Client to client, eDonkey protocol.
    const val OP_HELLO = 0x01
    const val OP_SENDINGPART = 0x46
    const val OP_REQUESTPARTS = 0x47
    const val OP_FILEREQANSNOFIL = 0x48
    const val OP_END_OF_DOWNLOAD = 0x49
    const val OP_ASKSHAREDFILES = 0x4A
    const val OP_HELLOANSWER = 0x4C
    const val OP_SETREQFILEID = 0x4F
    const val OP_FILESTATUS = 0x50
    const val OP_HASHSETREQUEST = 0x51
    const val OP_HASHSETANSWER = 0x52
    const val OP_STARTUPLOADREQ = 0x54
    const val OP_ACCEPTUPLOADREQ = 0x55
    const val OP_CANCELTRANSFER = 0x56
    const val OP_OUTOFPARTREQS = 0x57
    const val OP_REQUESTFILENAME = 0x58
    const val OP_REQFILENAMEANSWER = 0x59
    const val OP_QUEUERANK = 0x5C
    const val OP_ASKSHAREDDIRS = 0x5D
    const val OP_ASKSHAREDFILESDIR = 0x5E
    const val OP_ASKSHAREDDENIEDANS = 0x61

    // Client to client, eMule extensions.
    const val OP_EMULEINFO = 0x01
    const val OP_EMULEINFOANSWER = 0x02
    const val OP_COMPRESSEDPART = 0x40
    const val OP_QUEUERANKING = 0x60
    const val OP_REQUESTSOURCES = 0x81
    const val OP_COMPRESSEDPART_I64 = 0xA1
    const val OP_SENDINGPART_I64 = 0xA2
    const val OP_REQUESTPARTS_I64 = 0xA3

    // Tag types.
    const val TAG_HASH = 0x01
    const val TAG_STRING = 0x02
    const val TAG_UINT32 = 0x03
    const val TAG_FLOAT = 0x04
    const val TAG_BOOL = 0x05
    const val TAG_BOOLARRAY = 0x06
    const val TAG_BLOB = 0x07
    const val TAG_UINT16 = 0x08
    const val TAG_UINT8 = 0x09
    const val TAG_BSOB = 0x0A
    const val TAG_UINT64 = 0x0B
    const val TAG_STR1 = 0x11
    const val TAG_STR16 = 0x20

    // Tag names.
    const val CT_NAME = 0x01
    const val CT_PORT = 0x0F
    const val CT_VERSION = 0x11
    const val CT_SERVER_FLAGS = 0x20
    const val CT_EMULE_MISCOPTIONS1 = 0xFA
    const val CT_EMULE_VERSION = 0xFB
    const val CT_EMULE_MISCOPTIONS2 = 0xFE
    const val FT_FILENAME = 0x01
    const val FT_FILESIZE = 0x02
    const val FT_SOURCES = 0x15
    const val FT_COMPLETE_SOURCES = 0x30
    const val FT_FILESIZE_HI = 0x3A
    const val ST_SERVERNAME = 0x01
    const val ST_DESCRIPTION = 0x0B

    // Login capability flags.
    const val SRVCAP_ZLIB = 0x0001
    const val SRVCAP_NEWTAGS = 0x0008
    const val SRVCAP_UNICODE = 0x0010
    const val SRVCAP_LARGEFILES = 0x0100
    // Flags the server returns with the client ID.
    const val SRV_TCPFLG_LARGEFILES = 0x0100L

    /** Below this value a client ID is a low ID: the client cannot take incoming connections. */
    const val LOW_ID_LIMIT = 0x0100_0000L

    val EMPTY_MD4: ByteArray by lazy { Ed2kHash.md4(ByteArray(0)) }
}

internal class Ed2kProtocolException(message: String) : IOException(message)

internal class Ed2kPacket(val protocol: Int, val opcode: Int, val payload: ByteArray) {
    fun reader() = Ed2kReader(payload)
    fun isEmule() = protocol == Ed2k.PROT_EMULE
    fun isEdonkey() = protocol == Ed2k.PROT_EDONKEY
}

/** Builds little-endian message payloads. */
internal class Ed2kWriter {
    private val out = ByteArrayOutputStream(64)

    fun u8(value: Int) = apply { out.write(value and 0xFF) }
    fun u16(value: Int) = apply { u8(value); u8(value ushr 8) }
    fun u32(value: Long) = apply {
        u8(value.toInt()); u8((value ushr 8).toInt()); u8((value ushr 16).toInt()); u8((value ushr 24).toInt())
    }
    fun u64(value: Long) = apply { u32(value and 0xFFFF_FFFFL); u32(value ushr 32) }
    fun bytes(value: ByteArray) = apply { out.write(value, 0, value.size) }
    fun string(value: String) = apply {
        val data = value.toByteArray(Charsets.UTF_8)
        u16(data.size)
        bytes(data)
    }

    /** A tag in the classic layout every peer reads: the name is a 2-byte length and a 1-byte ID. */
    fun tagString(name: Int, value: String) = apply { u8(Ed2k.TAG_STRING); u16(1); u8(name); string(value) }
    fun tagU32(name: Int, value: Long) = apply { u8(Ed2k.TAG_UINT32); u16(1); u8(name); u32(value) }

    fun toByteArray(): ByteArray = out.toByteArray()

    /** Frames the payload as one packet. */
    fun packet(protocol: Int, opcode: Int): ByteArray {
        val payload = out.toByteArray()
        val framed = ByteArray(6 + payload.size)
        val size = payload.size + 1L
        framed[0] = protocol.toByte()
        framed[1] = size.toByte()
        framed[2] = (size ushr 8).toByte()
        framed[3] = (size ushr 16).toByte()
        framed[4] = (size ushr 24).toByte()
        framed[5] = opcode.toByte()
        System.arraycopy(payload, 0, framed, 6, payload.size)
        return framed
    }
}

internal data class Ed2kTag(val id: Int, val name: String?, val value: Any?) {
    val long: Long? get() = (value as? Number)?.toLong()
    val string: String? get() = value as? String
}

/** Reads little-endian fields; throws [Ed2kProtocolException] on a short packet. */
internal class Ed2kReader(private val data: ByteArray, var pos: Int = 0, private val end: Int = data.size) {
    val remaining: Int get() = end - pos

    private fun need(count: Int) {
        if (count < 0 || pos + count > end) throw Ed2kProtocolException("Short eD2k packet")
    }

    fun u8(): Int { need(1); return data[pos++].toInt() and 0xFF }
    fun u16(): Int { val low = u8(); return low or (u8() shl 8) }
    fun u32(): Long {
        need(4)
        var value = 0L
        for (shift in 0 until 4) value = value or ((data[pos++].toLong() and 0xFF) shl (shift * 8))
        return value
    }
    fun u64(): Long { val low = u32(); return low or (u32() shl 32) }
    fun bytes(count: Int): ByteArray { need(count); val value = data.copyOfRange(pos, pos + count); pos += count; return value }
    fun hash(): ByteArray = bytes(16)
    fun skip(count: Int) { need(count); pos += count }
    fun string(): String = text(u16())
    fun text(count: Int): String { need(count); val value = String(data, pos, count, Charsets.UTF_8); pos += count; return value }

    fun tag(): Ed2kTag {
        var type = u8()
        val id: Int
        var name: String? = null
        if (type and 0x80 != 0) {
            // Compact layout: the name is a single byte.
            type = type and 0x7F
            id = u8()
        } else {
            val length = u16()
            if (length == 1) {
                id = u8()
            } else {
                id = -1
                name = text(length)
            }
        }
        val value: Any? = when (type) {
            Ed2k.TAG_HASH -> hash()
            Ed2k.TAG_STRING -> string()
            Ed2k.TAG_UINT32 -> u32()
            Ed2k.TAG_FLOAT -> java.lang.Float.intBitsToFloat(u32().toInt())
            Ed2k.TAG_BOOL -> u8()
            Ed2k.TAG_BOOLARRAY -> bytes((u16() + 7) / 8)
            Ed2k.TAG_BLOB -> bytes(u32().toInt())
            Ed2k.TAG_UINT16 -> u16().toLong()
            Ed2k.TAG_UINT8 -> u8().toLong()
            Ed2k.TAG_BSOB -> bytes(u8())
            Ed2k.TAG_UINT64 -> u64()
            in Ed2k.TAG_STR1..Ed2k.TAG_STR16 -> text(type - Ed2k.TAG_STR1 + 1)
            else -> throw Ed2kProtocolException("Unknown eD2k tag type $type")
        }
        return Ed2kTag(id, name, value)
    }

    fun tags(count: Long): List<Ed2kTag> {
        if (count > 1024) throw Ed2kProtocolException("Too many eD2k tags")
        return List(count.toInt()) { tag() }
    }
}

/**
 * Reads whole packets from a stream. Packed packets (0xD4) are inflated and
 * reported with [packedAs]: the eDonkey protocol for a server, eMule for a peer.
 */
internal class Ed2kPacketReader(private val input: InputStream, private val packedAs: Int) {
    private val header = ByteArray(6)

    fun read(): Ed2kPacket {
        readFully(header, 0, 6)
        val protocol = header[0].toInt() and 0xFF
        if (protocol != Ed2k.PROT_EDONKEY && protocol != Ed2k.PROT_EMULE && protocol != Ed2k.PROT_PACKED) {
            throw Ed2kProtocolException("Not an eD2k packet")
        }
        val size = (header[1].toLong() and 0xFF) or ((header[2].toLong() and 0xFF) shl 8) or
            ((header[3].toLong() and 0xFF) shl 16) or ((header[4].toLong() and 0xFF) shl 24)
        if (size < 1 || size > Ed2k.MAX_PACKET_SIZE) throw Ed2kProtocolException("Bad eD2k packet size")
        val opcode = header[5].toInt() and 0xFF
        val payload = ByteArray((size - 1).toInt())
        readFully(payload, 0, payload.size)
        if (protocol == Ed2k.PROT_PACKED) {
            return Ed2kPacket(packedAs, opcode, Ed2kZlib.inflate(payload, Ed2k.MAX_PACKET_SIZE))
        }
        return Ed2kPacket(protocol, opcode, payload)
    }

    private fun readFully(buffer: ByteArray, offset: Int, length: Int) {
        var done = 0
        while (done < length) {
            val count = input.read(buffer, offset + done, length - done)
            if (count < 0) throw EOFException("Connection closed")
            done += count
        }
    }
}

internal object Ed2kZlib {
    fun inflate(data: ByteArray, limit: Int): ByteArray {
        val inflater = Inflater()
        try {
            inflater.setInput(data)
            val out = ByteArrayOutputStream(data.size * 3)
            val buffer = ByteArray(16 * 1024)
            while (!inflater.finished()) {
                val count = inflater.inflate(buffer)
                if (count == 0 && (inflater.needsInput() || inflater.needsDictionary())) break
                out.write(buffer, 0, count)
                if (out.size() > limit) throw Ed2kProtocolException("Packed eD2k packet is too large")
            }
            return out.toByteArray()
        } catch (error: java.util.zip.DataFormatException) {
            throw Ed2kProtocolException("Bad packed eD2k packet")
        } finally {
            inflater.end()
        }
    }
}

internal object Ed2kHash {
    fun md4(data: ByteArray, offset: Int = 0, length: Int = data.size): ByteArray {
        val digest = MD4Digest()
        digest.update(data, offset, length)
        val out = ByteArray(16)
        digest.doFinal(out, 0)
        return out
    }

    /** Number of 9.28 MB parts; a file always has at least one. */
    fun partCount(size: Long): Int = maxOf(1L, (size + Ed2k.PART_SIZE - 1) / Ed2k.PART_SIZE).toInt()

    fun partStart(part: Int): Long = part * Ed2k.PART_SIZE
    fun partEnd(size: Long, part: Int): Long = minOf(size, (part + 1) * Ed2k.PART_SIZE)

    /**
     * The file hashes that match these part hashes. For a file that is an
     * exact multiple of the part size, eMule hashes one extra empty part; other
     * tools do not, so both forms are accepted.
     */
    fun fileHashCandidates(partHashes: List<ByteArray>, size: Long): List<ByteArray> {
        val exact = size > 0 && size % Ed2k.PART_SIZE == 0L
        val result = mutableListOf<ByteArray>()
        if (partHashes.size == 1) {
            result.add(partHashes[0])
        } else {
            result.add(md4(concat(partHashes)))
        }
        if (exact) result.add(md4(concat(partHashes + listOf(Ed2k.EMPTY_MD4))))
        return result
    }

    fun matchesFile(fileHash: ByteArray, partHashes: List<ByteArray>, size: Long): Boolean =
        fileHashCandidates(partHashes, size).any { it.contentEquals(fileHash) }

    /**
     * Checks a hashset from a peer or a link against the file hash and returns
     * one hash per part, or null when it does not belong to this file.
     */
    fun acceptHashset(fileHash: ByteArray, hashes: List<ByteArray>, size: Long): List<ByteArray>? {
        val parts = partCount(size)
        val trimmed = when {
            hashes.size == parts -> hashes
            hashes.size == parts + 1 && size % Ed2k.PART_SIZE == 0L &&
                hashes.last().contentEquals(Ed2k.EMPTY_MD4) -> hashes.subList(0, parts)
            else -> return null
        }
        return if (matchesFile(fileHash, trimmed, size)) trimmed else null
    }

    private fun concat(hashes: List<ByteArray>): ByteArray {
        val out = ByteArray(hashes.size * 16)
        hashes.forEachIndexed { index, hash -> System.arraycopy(hash, 0, out, index * 16, 16) }
        return out
    }

    fun hex(bytes: ByteArray): String = bytes.joinToString("") { "%02x".format(it.toInt() and 0xFF) }

    fun fromHex(value: String): ByteArray {
        require(value.length % 2 == 0) { "Bad hex" }
        return ByteArray(value.length / 2) { index -> value.substring(index * 2, index * 2 + 2).toInt(16).toByte() }
    }
}

internal data class Ed2kEndpoint(val host: String, val port: Int)

internal data class Ed2kServerEntry(val host: String, val port: Int, val name: String = "", val description: String = "")

internal data class Ed2kSearchResult(
    val hash: ByteArray,
    val name: String,
    val size: Long,
    val sources: Long,
    val completeSources: Long,
)

/** Messages this client sends. Every function returns a framed packet. */
internal object Ed2kMessages {
    // The low byte of CT_EMULE_VERSION: an identifier for this client, not eMule's.
    private const val COMPAT_CLIENT = 0x44
    private const val CLIENT_NAME = "Droid Stream"

    /**
     * What this client supports, announced in the hello:
     * data compression v1 (peers may send zlib blocks), Unicode names, and
     * "no view shared files". No source exchange, secure ident, UDP or AICH.
     */
    val MISC_OPTIONS_1: Long = (1L shl 28) or (1L shl 20) or (1L shl 2)
    /** Large files (64-bit offsets). No Kad, no crypt layer. */
    val MISC_OPTIONS_2: Long = 1L shl 4
    private val EMULE_VERSION: Long = (COMPAT_CLIENT.toLong() shl 24) or (1L shl 17)

    fun login(userHash: ByteArray, port: Int): ByteArray = Ed2kWriter()
        .bytes(userHash)
        .u32(0)
        .u16(port)
        .u32(4)
        .tagString(Ed2k.CT_NAME, CLIENT_NAME)
        .tagU32(Ed2k.CT_VERSION, Ed2k.EDONKEY_VERSION.toLong())
        .tagU32(Ed2k.CT_SERVER_FLAGS, (Ed2k.SRVCAP_ZLIB or Ed2k.SRVCAP_NEWTAGS or Ed2k.SRVCAP_UNICODE or Ed2k.SRVCAP_LARGEFILES).toLong())
        .tagU32(Ed2k.CT_EMULE_VERSION, EMULE_VERSION)
        .packet(Ed2k.PROT_EDONKEY, Ed2k.OP_LOGINREQUEST)

    /** An empty offer: this client shares nothing. Servers also take it as a keep-alive. */
    fun offerNoFiles(): ByteArray = Ed2kWriter().u32(0).packet(Ed2k.PROT_EDONKEY, Ed2k.OP_OFFERFILES)

    fun getSources(hash: ByteArray, size: Long, largeFiles: Boolean): ByteArray {
        val writer = Ed2kWriter().bytes(hash)
        if (size > Ed2k.OLD_MAX_FILE_SIZE) {
            if (!largeFiles) throw Ed2kProtocolException("This server does not support files over 4 GB")
            writer.u32(0).u64(size)
        } else {
            writer.u32(size)
        }
        return writer.packet(Ed2k.PROT_EDONKEY, Ed2k.OP_GETSOURCES)
    }

    /** A keyword search. Servers split the words and match all of them. */
    fun search(query: String): ByteArray {
        val words = query.trim().replace(Regex("\\s+"), " ")
        require(words.isNotEmpty()) { "Enter a search" }
        return Ed2kWriter().u8(0x01).string(words).packet(Ed2k.PROT_EDONKEY, Ed2k.OP_SEARCHREQUEST)
    }

    fun hello(userHash: ByteArray, clientId: Long, port: Int, server: Ed2kEndpoint?, serverIp: ByteArray?, answer: Boolean): ByteArray {
        val writer = Ed2kWriter()
        if (!answer) writer.u8(16)
        writer.bytes(userHash)
            .u32(clientId)
            .u16(port)
            .u32(5)
            .tagString(Ed2k.CT_NAME, CLIENT_NAME)
            .tagU32(Ed2k.CT_VERSION, Ed2k.EDONKEY_VERSION.toLong())
            .tagU32(Ed2k.CT_EMULE_VERSION, EMULE_VERSION)
            .tagU32(Ed2k.CT_EMULE_MISCOPTIONS1, MISC_OPTIONS_1)
            .tagU32(Ed2k.CT_EMULE_MISCOPTIONS2, MISC_OPTIONS_2)
        if (serverIp != null && server != null) {
            writer.bytes(serverIp).u16(server.port)
        } else {
            writer.u32(0).u16(0)
        }
        return writer.packet(Ed2k.PROT_EDONKEY, if (answer) Ed2k.OP_HELLOANSWER else Ed2k.OP_HELLO)
    }

    fun requestFileName(hash: ByteArray) = Ed2kWriter().bytes(hash).packet(Ed2k.PROT_EDONKEY, Ed2k.OP_REQUESTFILENAME)
    fun setRequestedFile(hash: ByteArray) = Ed2kWriter().bytes(hash).packet(Ed2k.PROT_EDONKEY, Ed2k.OP_SETREQFILEID)
    fun hashsetRequest(hash: ByteArray) = Ed2kWriter().bytes(hash).packet(Ed2k.PROT_EDONKEY, Ed2k.OP_HASHSETREQUEST)
    fun startUpload(hash: ByteArray) = Ed2kWriter().bytes(hash).packet(Ed2k.PROT_EDONKEY, Ed2k.OP_STARTUPLOADREQ)
    fun cancelTransfer() = Ed2kWriter().packet(Ed2k.PROT_EDONKEY, Ed2k.OP_CANCELTRANSFER)
    fun fileNotFound(hash: ByteArray) = Ed2kWriter().bytes(hash).packet(Ed2k.PROT_EDONKEY, Ed2k.OP_FILEREQANSNOFIL)
    fun sharedFilesDenied() = Ed2kWriter().packet(Ed2k.PROT_EDONKEY, Ed2k.OP_ASKSHAREDDENIEDANS)

    /** For old peers that still start with the separate eMule info message. */
    fun emuleInfoAnswer(): ByteArray = Ed2kWriter()
        .u8(0x01) // client version
        .u8(0x01) // eMule protocol version
        .u32(1)
        .tagU32(0x20, 1) // data compression
        .packet(Ed2k.PROT_EMULE, Ed2k.OP_EMULEINFOANSWER)

    /**
     * Asks for up to three byte ranges, end exclusive. Unused slots are zero.
     * Files over 4 GB use the 64-bit form.
     */
    fun requestParts(hash: ByteArray, ranges: List<LongRange>, largeFile: Boolean): ByteArray {
        require(ranges.size in 1..3) { "One to three ranges" }
        val writer = Ed2kWriter().bytes(hash)
        val starts = LongArray(3)
        val ends = LongArray(3)
        ranges.forEachIndexed { index, range ->
            starts[index] = range.first
            ends[index] = range.last + 1
        }
        if (largeFile) {
            starts.forEach { writer.u64(it) }
            ends.forEach { writer.u64(it) }
            return writer.packet(Ed2k.PROT_EMULE, Ed2k.OP_REQUESTPARTS_I64)
        }
        starts.forEach { writer.u32(it) }
        ends.forEach { writer.u32(it) }
        return writer.packet(Ed2k.PROT_EDONKEY, Ed2k.OP_REQUESTPARTS)
    }
}

/** Reads the server and peer messages this client handles. */
internal object Ed2kParse {
    fun ipString(ip: ByteArray): String =
        "${ip[0].toInt() and 0xFF}.${ip[1].toInt() and 0xFF}.${ip[2].toInt() and 0xFF}.${ip[3].toInt() and 0xFF}"

    /** A client ID read as a little-endian number. High IDs are the client's IPv4 address. */
    fun isLowId(id: Long) = id < Ed2k.LOW_ID_LIMIT

    fun idToIp(id: Long): ByteArray = byteArrayOf(id.toByte(), (id ushr 8).toByte(), (id ushr 16).toByte(), (id ushr 24).toByte())

    data class IdChange(val clientId: Long, val flags: Long)

    fun idChange(payload: ByteArray): IdChange {
        val reader = Ed2kReader(payload)
        val id = reader.u32()
        val flags = if (reader.remaining >= 4) reader.u32() else 0L
        return IdChange(id, flags)
    }

    fun serverMessage(payload: ByteArray): String = runCatching { Ed2kReader(payload).string() }.getOrDefault("")

    data class FoundSources(val hash: ByteArray, val sources: List<Ed2kEndpoint>)

    /** Found sources; low-ID peers are left out because a low-ID client cannot reach them. */
    fun foundSources(payload: ByteArray, obfuscated: Boolean): FoundSources {
        val reader = Ed2kReader(payload)
        val hash = reader.hash()
        val count = reader.u8()
        val sources = mutableListOf<Ed2kEndpoint>()
        repeat(count) {
            val id = reader.u32()
            val port = reader.u16()
            if (obfuscated) {
                val options = reader.u8()
                if (options and 0x80 != 0) reader.skip(16)
            }
            if (!isLowId(id) && port != 0) sources.add(Ed2kEndpoint(ipString(idToIp(id)), port))
        }
        return FoundSources(hash, sources)
    }

    data class Callback(val host: String, val port: Int)

    fun callbackRequested(payload: ByteArray): Callback {
        val reader = Ed2kReader(payload)
        val ip = reader.bytes(4)
        return Callback(ipString(ip), reader.u16())
    }

    fun serverList(payload: ByteArray): List<Ed2kServerEntry> {
        val reader = Ed2kReader(payload)
        val count = reader.u8()
        return List(count) {
            val ip = reader.bytes(4)
            Ed2kServerEntry(ipString(ip), reader.u16())
        }.filter { it.port != 0 }
    }

    fun searchResults(payload: ByteArray): List<Ed2kSearchResult> {
        val reader = Ed2kReader(payload)
        val count = reader.u32()
        if (count > 10_000) throw Ed2kProtocolException("Too many search results")
        val results = mutableListOf<Ed2kSearchResult>()
        repeat(count.toInt()) {
            val hash = reader.hash()
            reader.u32() // client ID
            reader.u16() // client port
            val tags = reader.tags(reader.u32())
            var name = ""
            var low = 0L
            var high = 0L
            var sources = 0L
            var complete = 0L
            for (tag in tags) {
                when (tag.id) {
                    Ed2k.FT_FILENAME -> name = tag.string ?: name
                    Ed2k.FT_FILESIZE -> low = tag.long ?: low
                    Ed2k.FT_FILESIZE_HI -> high = tag.long ?: high
                    Ed2k.FT_SOURCES -> sources = tag.long ?: sources
                    Ed2k.FT_COMPLETE_SOURCES -> complete = tag.long ?: complete
                }
            }
            // A 64-bit size tag carries the whole size on its own.
            val size = if (low > 0xFFFF_FFFFL) low else (high shl 32) or (low and 0xFFFF_FFFFL)
            if (name.isNotEmpty() && size > 0) results.add(Ed2kSearchResult(hash, name, size, sources, complete))
        }
        return results
    }

    /** The parts a peer has, or null when it has the complete file. */
    fun fileStatus(payload: ByteArray, partCount: Int): BitSet? {
        val reader = Ed2kReader(payload)
        reader.hash()
        val count = reader.u16()
        if (count == 0) return null
        if (count != partCount) throw Ed2kProtocolException("Part count does not match")
        val bytes = reader.bytes((count + 7) / 8)
        val parts = BitSet(count)
        for (index in 0 until count) {
            if ((bytes[index / 8].toInt() shr (index % 8)) and 1 == 1) parts.set(index)
        }
        return parts
    }

    data class Hashset(val hash: ByteArray, val parts: List<ByteArray>)

    fun hashset(payload: ByteArray): Hashset {
        val reader = Ed2kReader(payload)
        val hash = reader.hash()
        val count = reader.u16()
        return Hashset(hash, List(count) { reader.hash() })
    }

    /** Queue position from either the eDonkey (32-bit) or the eMule (16-bit) message. */
    fun queueRank(packet: Ed2kPacket): Int {
        val reader = packet.reader()
        return if (packet.isEmule()) reader.u16() else reader.u32().coerceAtMost(Int.MAX_VALUE.toLong()).toInt()
    }

    /** Header of a plain data block; the data runs from [dataOffset] to the end of the payload. */
    data class DataBlock(val hash: ByteArray, val start: Long, val end: Long, val dataOffset: Int)

    fun sendingPart(payload: ByteArray, wide: Boolean): DataBlock {
        val reader = Ed2kReader(payload)
        val hash = reader.hash()
        val start = if (wide) reader.u64() else reader.u32()
        val end = if (wide) reader.u64() else reader.u32()
        if (end < start || end - start != reader.remaining.toLong()) throw Ed2kProtocolException("Bad data block")
        return DataBlock(hash, start, end, reader.pos)
    }

    /** Header of a compressed block piece; [end] holds the total compressed size. */
    fun compressedPart(payload: ByteArray, wide: Boolean): DataBlock {
        val reader = Ed2kReader(payload)
        val hash = reader.hash()
        val start = if (wide) reader.u64() else reader.u32()
        val packedSize = reader.u32()
        return DataBlock(hash, start, packedSize, reader.pos)
    }

    /** server.met: a version byte, a count, then IP, port and tags per server. */
    fun serverMet(data: ByteArray): List<Ed2kServerEntry> {
        val reader = Ed2kReader(data)
        val version = reader.u8()
        if (version != 0x0E && version != 0xE0) throw Ed2kProtocolException("Not a server.met file")
        val count = reader.u32()
        if (count > 100_000) throw Ed2kProtocolException("Too many servers")
        val servers = mutableListOf<Ed2kServerEntry>()
        repeat(count.toInt()) {
            val ip = reader.bytes(4)
            val port = reader.u16()
            var name = ""
            var description = ""
            for (tag in reader.tags(reader.u32())) {
                if (tag.id == Ed2k.ST_SERVERNAME) name = tag.string ?: name
                if (tag.id == Ed2k.ST_DESCRIPTION) description = tag.string ?: description
            }
            if (port != 0) servers.add(Ed2kServerEntry(ipString(ip), port, name, description))
        }
        return servers
    }
}

/**
 * Which 180 KiB blocks of a file are on disk and which parts are verified.
 * Blocks never cross a part boundary. Saved next to the partial file so a
 * download resumes after a restart.
 */
internal class Ed2kPartMap(val size: Long) {
    val partCount = Ed2kHash.partCount(size)
    private val firstBlock = IntArray(partCount + 1)
    val blockCount: Int

    init {
        require(size > 0) { "Empty file" }
        var total = 0
        for (part in 0 until partCount) {
            firstBlock[part] = total
            val length = Ed2kHash.partEnd(size, part) - Ed2kHash.partStart(part)
            total += ((length + Ed2k.BLOCK_SIZE - 1) / Ed2k.BLOCK_SIZE).toInt()
        }
        firstBlock[partCount] = total
        blockCount = total
    }

    val done = BitSet(blockCount)
    val verified = BitSet(partCount)

    fun blocksOf(part: Int): IntRange = firstBlock[part] until firstBlock[part + 1]

    fun partOf(block: Int): Int {
        var low = 0
        var high = partCount - 1
        while (low < high) {
            val mid = (low + high + 1) / 2
            if (firstBlock[mid] <= block) low = mid else high = mid - 1
        }
        return low
    }

    /** Byte range of a block, end inclusive. */
    fun range(block: Int): LongRange {
        val part = partOf(block)
        val start = Ed2kHash.partStart(part) + (block - firstBlock[part]) * Ed2k.BLOCK_SIZE
        val end = minOf(start + Ed2k.BLOCK_SIZE, Ed2kHash.partEnd(size, part))
        return start until end
    }

    fun isPartFilled(part: Int): Boolean = blocksOf(part).all { done.get(it) }

    fun clearPart(part: Int) {
        val blocks = blocksOf(part)
        done.clear(blocks.first, blocks.last + 1)
        verified.clear(part)
    }

    fun complete(): Boolean = verified.cardinality() == partCount

    fun doneBytes(): Long {
        var total = 0L
        var block = done.nextSetBit(0)
        while (block >= 0) {
            total += range(block).let { it.last - it.first + 1 }
            block = done.nextSetBit(block + 1)
        }
        return total
    }

    /**
     * Up to [max] blocks to ask a peer for. Prefers the part this peer worked
     * on, then parts other peers are not on, then parts closest to done.
     * When every missing block is already requested elsewhere, the end game
     * asks for those again so one slow peer cannot hold up the finish.
     * Blocks in [mine] (already asked of this peer) are never picked.
     */
    fun pick(peerHas: BitSet?, inFlight: Set<Int>, busyParts: Map<Int, Int>, preferred: Int?, max: Int, mine: Set<Int>): List<Int> {
        val free = HashMap<Int, List<Int>>()
        for (part in 0 until partCount) {
            if (verified.get(part) || (peerHas != null && !peerHas.get(part))) continue
            free[part] = blocksOf(part).filter { !done.get(it) && it !in inFlight && it !in mine }
        }
        val order = free.keys.sortedWith(
            compareBy<Int>({ if (it == preferred) 0 else 1 }, { busyParts[it] ?: 0 }, { free[it]!!.size }),
        )
        val picked = mutableListOf<Int>()
        for (part in order) {
            for (block in free[part]!!) {
                picked.add(block)
                if (picked.size == max) return picked
            }
            if (picked.isNotEmpty()) return picked
        }
        for (part in order) {
            for (block in blocksOf(part)) {
                if (!done.get(block) && block !in mine) {
                    picked.add(block)
                    if (picked.size == max) return picked
                }
            }
            if (picked.isNotEmpty()) return picked
        }
        return picked
    }

    /** True when the peer has a part this download still needs. */
    fun wants(peerHas: BitSet?): Boolean = (0 until partCount).any { !verified.get(it) && (peerHas == null || peerHas.get(it)) }

    fun encode(fileHash: ByteArray, partHashes: List<ByteArray>?): ByteArray {
        val writer = Ed2kWriter().u32(MAGIC).u8(1).bytes(fileHash).u64(size)
        val doneBytes = done.toByteArray()
        writer.u32(doneBytes.size.toLong()).bytes(doneBytes)
        val verifiedBytes = verified.toByteArray()
        writer.u32(verifiedBytes.size.toLong()).bytes(verifiedBytes)
        writer.u16(partHashes?.size ?: 0)
        partHashes?.forEach { writer.bytes(it) }
        return writer.toByteArray()
    }

    companion object {
        private const val MAGIC = 0x4B443245L // "E2DK"

        data class Saved(val map: Ed2kPartMap, val partHashes: List<ByteArray>?)

        /** Reads a saved map, or null when it is missing, damaged, or for another file. */
        fun decode(data: ByteArray, fileHash: ByteArray, size: Long): Saved? = runCatching {
            val reader = Ed2kReader(data)
            if (reader.u32() != MAGIC || reader.u8() != 1) return null
            if (!reader.hash().contentEquals(fileHash) || reader.u64() != size) return null
            val map = Ed2kPartMap(size)
            map.done.or(BitSet.valueOf(reader.bytes(reader.u32().toInt())))
            map.verified.or(BitSet.valueOf(reader.bytes(reader.u32().toInt())))
            val hashCount = reader.u16()
            val hashes = List(hashCount) { reader.hash() }
            if (map.done.length() > map.blockCount || map.verified.length() > map.partCount) return null
            Saved(map, hashes.takeIf { it.size == map.partCount })
        }.getOrNull()
    }
}
