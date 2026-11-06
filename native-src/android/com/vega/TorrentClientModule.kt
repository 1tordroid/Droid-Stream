package com.vega

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.net.Uri
import android.os.Build
import android.provider.OpenableColumns
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import androidx.documentfile.provider.DocumentFile
import com.facebook.react.bridge.*
import org.libtorrent4j.*
import org.libtorrent4j.swig.address
import org.libtorrent4j.swig.error_code
import org.libtorrent4j.swig.ip_filter
import org.libtorrent4j.swig.settings_pack
import org.libtorrent4j.swig.torrent_flags_t
import java.io.File
import java.net.Inet4Address

/**
 * Queue, limits, and file controls on the single SessionManager owned by
 * [TorrentModule]. Direct magnet playback and this client share that session.
 */
class TorrentClientModule(reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext), ActivityEventListener {
    // Android keeps the first launch intent on the activity, so a link shared
    // while the app is already running only arrives through onNewIntent.
    private var sharedIntent: Intent? = null

    init {
        reactContext.addActivityEventListener(this)
    }

    override fun onNewIntent(intent: Intent) {
        sharedIntent = intent
        if (reactApplicationContext.hasActiveReactInstance()) {
            reactApplicationContext
                .getJSModule(com.facebook.react.modules.core.DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
                .emit("onVegaSharedLink", null)
        }
    }

    override fun onActivityResult(activity: android.app.Activity, requestCode: Int, resultCode: Int, data: Intent?) {}

    override fun getName(): String = "TorrentClientModule"

    private fun engine(): TorrentModule = TorrentModule(reactApplicationContext)

    private fun flags(): torrent_flags_t {
        var value = TorrentFlags.AUTO_MANAGED
        if (!TorrentModule.transfersAllowed) value = value.or_(TorrentFlags.PAUSED)
        if (!TorrentModule.preferPex) value = value.or_(TorrentFlags.DISABLE_PEX)
        return value
    }

    @ReactMethod
    fun applySettings(settings: ReadableMap, promise: Promise) {
        try {
            val sm = engine().ensureSession()
            val pack = SettingsPack()
            pack.downloadRateLimit(settings.getInt("downloadRateLimit"))
            pack.uploadRateLimit(settings.getInt("uploadRateLimit"))
            pack.activeDownloads(settings.getInt("maxActiveDownloads").coerceAtLeast(1))
            val seeding = settings.getBoolean("seedingEnabled")
            if (seeding) {
                pack.activeSeeds(settings.getInt("maxActiveSeeds").coerceAtLeast(0))
                pack.setInteger(settings_pack.int_types.seed_time_limit.swigValue(), settings.getInt("seedTimeLimitSeconds"))
                // libtorrent treats 100 as a share ratio of 1.0. 0 means no ratio cap.
                pack.setInteger(settings_pack.int_types.share_ratio_limit.swigValue(), settings.getInt("shareRatioPercent"))
            } else {
                pack.activeSeeds(0)
                pack.setInteger(settings_pack.int_types.seed_time_limit.swigValue(), 1)
            }
            pack.setEnableDht(settings.getBoolean("dht"))
            pack.setEnableLsd(settings.getBoolean("lsd"))
            val utp = settings.getBoolean("utp")
            pack.setBoolean(settings_pack.bool_types.enable_incoming_utp.swigValue(), utp)
            pack.setBoolean(settings_pack.bool_types.enable_outgoing_utp.swigValue(), utp)
            val encryption = settings.getInt("encryption")
            pack.setInteger(settings_pack.int_types.out_enc_policy.swigValue(), encryption)
            pack.setInteger(settings_pack.int_types.in_enc_policy.swigValue(), encryption)
            pack.setInteger(settings_pack.int_types.allowed_enc_level.swigValue(), if (encryption == 0) 2 else 3)
            pack.setInteger(settings_pack.int_types.proxy_type.swigValue(), settings.getInt("proxyType"))
            pack.setString(settings_pack.string_types.proxy_hostname.swigValue(), settings.getString("proxyHost") ?: "")
            pack.setInteger(settings_pack.int_types.proxy_port.swigValue(), settings.getInt("proxyPort"))
            pack.setString(settings_pack.string_types.proxy_username.swigValue(), settings.getString("proxyUsername") ?: "")
            pack.setString(settings_pack.string_types.proxy_password.swigValue(), settings.getString("proxyPassword") ?: "")
            pack.setBoolean(settings_pack.bool_types.proxy_peer_connections.swigValue(), settings.getInt("proxyType") != 0)
            pack.setBoolean(settings_pack.bool_types.proxy_tracker_connections.swigValue(), settings.getInt("proxyType") != 0)
            val bind = settings.getString("bindAddress").orEmpty()
            if (bind.isNotBlank()) {
                pack.listenInterfaces("$bind:6881")
                pack.setString(settings_pack.string_types.outgoing_interfaces.swigValue(), bind)
            } else {
                pack.listenInterfaces("0.0.0.0:6881,0.0.0.0:6891")
                pack.setString(settings_pack.string_types.outgoing_interfaces.swigValue(), "")
            }
            sm.applySettings(pack)
            TorrentModule.addPublicTrackers = settings.getBoolean("publicTrackers")
            TorrentModule.preferPex = settings.getBoolean("pex")
            promise.resolve(true)
        } catch (error: Exception) {
            promise.reject("SETTINGS", error.message, error)
        }
    }

    @ReactMethod
    fun enqueue(source: String, savePath: String?, promise: Promise) {
        Thread {
            try {
                val module = engine()
                val sm = module.ensureSession()
                val server = module.ensureServer()
                val dir = if (savePath.isNullOrBlank()) TorrentModule.saveDirectory(reactApplicationContext) else File(savePath).apply { mkdirs() }
                val result = Arguments.createMap()
                if (source.startsWith("magnet:", true)) {
                    val magnet = module.withPublicTrackers(source)
                    val hash = Regex("btih:([a-fA-F0-9]{40})", RegexOption.IGNORE_CASE).find(magnet)?.groupValues?.get(1)?.lowercase()
                        ?: throw IllegalArgumentException("This magnet has no hex info hash")
                    val existing = sm.find(Sha1Hash.parseHex(hash))
                    if (existing == null || !existing.isValid) sm.download(magnet, dir, flags())
                    TorrentModule.torrentSavePaths[hash] = dir.absolutePath
                    result.putString("infoHash", hash)
                    result.putBoolean("hasMetadata", existing?.isValid == true && existing.status().hasMetadata())
                } else {
                    val file = if (source.startsWith("content:")) copyContent(Uri.parse(source), dir) else File(source)
                    val info = TorrentInfo(file)
                    val hash = info.infoHash().toHex()
                    if (sm.find(Sha1Hash.parseHex(hash))?.isValid != true) sm.download(info, dir)
                    TorrentModule.torrentHandles[hash] = sm.find(Sha1Hash.parseHex(hash)) ?: throw IllegalStateException("Torrent was not added")
                    TorrentModule.torrentSavePaths[hash] = dir.absolutePath
                    server.registerTorrent(hash, dir)
                    result.putString("infoHash", hash)
                    result.putString("name", info.name())
                    result.putBoolean("hasMetadata", true)
                }
                TorrentNotifier.update(reactApplicationContext)
                promise.resolve(result)
            } catch (error: Exception) {
                promise.reject("ENQUEUE", error.message, error)
            }
        }.start()
    }

    @ReactMethod
    fun listTorrents(promise: Promise) {
        try {
            val sm = engine().ensureSession()
            val rows = Arguments.createArray()
            val vector = sm.swig().get_torrents()
            for (index in 0 until vector.size) {
                val handle = TorrentHandle(vector.get(index))
                if (!handle.isValid) continue
                rows.pushMap(summary(handle))
            }
            promise.resolve(rows)
        } catch (error: Exception) {
            promise.reject("LIST", error.message, error)
        }
    }

    @ReactMethod
    fun getDetails(infoHash: String, promise: Promise) {
        try {
            val handle = handle(infoHash) ?: return promise.reject("NOT_FOUND", "Torrent is not in the session")
            val status = handle.status(TorrentHandle.QUERY_PIECES)
            val map = summary(handle)
            val peers = Arguments.createArray()
            for (peer in handle.peerInfo()) {
                peers.pushMap(Arguments.createMap().apply {
                    putString("address", peer.ip())
                    putString("client", peer.client())
                    putDouble("progress", peer.progress().toDouble())
                    putDouble("downSpeed", peer.downSpeed().toDouble())
                    putDouble("upSpeed", peer.upSpeed().toDouble())
                })
            }
            map.putArray("peers", peers)
            val trackers = Arguments.createArray()
            for (tracker in handle.trackers()) {
                trackers.pushMap(Arguments.createMap().apply {
                    putString("url", tracker.url())
                    putInt("tier", tracker.tier())
                    putBoolean("verified", tracker.isVerified)
                })
            }
            map.putArray("trackers", trackers)
            val info = handle.torrentFile()
            if (info != null) {
                val files = Arguments.createArray()
                val storage = info.files()
                val progress = handle.fileProgress()
                val priorities = handle.filePriorities()
                for (index in 0 until storage.numFiles()) {
                    files.pushMap(Arguments.createMap().apply {
                        putInt("index", index)
                        putString("name", storage.fileName(index))
                        putString("path", storage.filePath(index))
                        putDouble("size", storage.fileSize(index).toDouble())
                        putDouble("progress", progress.getOrNull(index)?.toDouble() ?: 0.0)
                        putInt("priority", priorities.getOrNull(index)?.swig()?.toInt() ?: 4)
                    })
                }
                map.putArray("files", files)
                val pieces = status.pieces()
                val sample = StringBuilder()
                val step = (pieces.size() / 180).coerceAtLeast(1)
                var cursor = 0
                while (cursor < pieces.size()) {
                    sample.append(if (pieces.getBit(cursor)) '1' else '0')
                    cursor += step
                }
                map.putString("pieces", sample.toString())
                map.putBoolean("sequential", status.flags().and_(TorrentFlags.SEQUENTIAL_DOWNLOAD).non_zero())
            }
            promise.resolve(map)
        } catch (error: Exception) {
            promise.reject("DETAILS", error.message, error)
        }
    }

    @ReactMethod
    fun setFilePriorities(infoHash: String, priorities: ReadableArray, promise: Promise) {
        try {
            val handle = handle(infoHash) ?: return promise.reject("NOT_FOUND", "Torrent is not in the session")
            val next = handle.filePriorities()
            for (index in 0 until minOf(priorities.size(), next.size)) {
                next[index] = when (priorities.getInt(index)) {
                    0 -> Priority.IGNORE
                    1 -> Priority.LOW
                    7 -> Priority.TOP_PRIORITY
                    else -> Priority.DEFAULT
                }
            }
            handle.prioritizeFiles(next)
            promise.resolve(true)
        } catch (error: Exception) {
            promise.reject("PRIORITY", error.message, error)
        }
    }

    @ReactMethod
    fun setSequential(infoHash: String, enabled: Boolean, promise: Promise) {
        try {
            val handle = handle(infoHash) ?: return promise.reject("NOT_FOUND", "Torrent is not in the session")
            if (enabled) handle.setFlags(TorrentFlags.SEQUENTIAL_DOWNLOAD) else handle.unsetFlags(TorrentFlags.SEQUENTIAL_DOWNLOAD)
            promise.resolve(true)
        } catch (error: Exception) {
            promise.reject("SEQUENTIAL", error.message, error)
        }
    }

    @ReactMethod
    fun setLimits(infoHash: String, download: Int, upload: Int, promise: Promise) {
        try {
            val handle = handle(infoHash) ?: return promise.reject("NOT_FOUND", "Torrent is not in the session")
            handle.setDownloadLimit(download)
            handle.setUploadLimit(upload)
            promise.resolve(true)
        } catch (error: Exception) {
            promise.reject("LIMITS", error.message, error)
        }
    }

    @ReactMethod
    fun setStopped(infoHash: String, stopped: Boolean, promise: Promise) {
        try {
            val handle = handle(infoHash) ?: return promise.reject("NOT_FOUND", "Torrent is not in the session")
            if (stopped) {
                TorrentModule.userStopped.add(infoHash)
                handle.unsetFlags(TorrentFlags.AUTO_MANAGED)
                handle.pause()
            } else {
                TorrentModule.userStopped.remove(infoHash)
                handle.setFlags(TorrentFlags.AUTO_MANAGED)
                if (TorrentModule.transfersAllowed) handle.resume()
            }
            promise.resolve(true)
        } catch (error: Exception) {
            promise.reject("STOP", error.message, error)
        }
    }

    @ReactMethod
    fun setTrackers(infoHash: String, urls: ReadableArray, promise: Promise) {
        try {
            val handle = handle(infoHash) ?: return promise.reject("NOT_FOUND", "Torrent is not in the session")
            val entries = mutableListOf<AnnounceEntry>()
            for (index in 0 until urls.size()) urls.getString(index)?.let { entries.add(AnnounceEntry(it)) }
            handle.replaceTrackers(entries)
            promise.resolve(true)
        } catch (error: Exception) {
            promise.reject("TRACKERS", error.message, error)
        }
    }

    @ReactMethod
    fun moveStorage(infoHash: String, path: String, promise: Promise) {
        try {
            val handle = handle(infoHash) ?: return promise.reject("NOT_FOUND", "Torrent is not in the session")
            File(path).mkdirs()
            handle.moveStorage(path)
            TorrentModule.torrentSavePaths[infoHash] = path
            promise.resolve(true)
        } catch (error: Exception) {
            promise.reject("MOVE", error.message, error)
        }
    }

    @ReactMethod
    fun createTorrent(path: String, trackers: ReadableArray, comment: String, outputPath: String, promise: Promise) {
        Thread {
            try {
                val builder = TorrentBuilder().creator("Droid Stream").comment(comment).path(File(path))
                for (index in 0 until trackers.size()) trackers.getString(index)?.let { builder.addTracker(it) }
                val bytes = builder.generate().entry().bencode()
                val output = File(outputPath)
                output.parentFile?.mkdirs()
                output.writeBytes(bytes)
                promise.resolve(output.absolutePath)
            } catch (error: Exception) {
                promise.reject("CREATE", error.message, error)
            }
        }.start()
    }

    @ReactMethod
    fun applyBlocklist(text: String, promise: Promise) {
        try {
            val filter = ip_filter()
            var applied = 0
            for (line in text.lineSequence()) {
                val range = parseBlockLine(line) ?: continue
                val startError = error_code()
                val endError = error_code()
                val start = address.from_string(range.first, startError)
                val end = address.from_string(range.second, endError)
                if (startError.to_bool() || endError.to_bool()) continue
                filter.add_rule(start, end, ip_filter.access_flags.blocked.swigValue().toLong())
                applied += 1
            }
            engine().ensureSession().swig().set_ip_filter(filter)
            promise.resolve(Arguments.createMap().apply {
                putBoolean("applied", true)
                putInt("ranges", applied)
                putString("reason", "")
            })
        } catch (error: Exception) {
            promise.resolve(Arguments.createMap().apply {
                putBoolean("applied", false)
                putInt("ranges", 0)
                putString("reason", error.message ?: "This session could not apply an IP filter")
            })
        }
    }

    @ReactMethod
    fun setTransfersAllowed(allowed: Boolean, promise: Promise) {
        try {
            TorrentModule.transfersAllowed = allowed
            val sm = TorrentModule.sessionManager
            if (sm != null && sm.isRunning) {
                val vector = sm.swig().get_torrents()
                for (index in 0 until vector.size) {
                    val handle = TorrentHandle(vector.get(index))
                    if (!handle.isValid) continue
                    val hash = handle.infoHash().toHex()
                    if (TorrentModule.userStopped.contains(hash)) continue
                    if (!allowed) {
                        TorrentModule.policyPaused.add(hash)
                        handle.pause()
                    } else if (TorrentModule.policyPaused.remove(hash)) {
                        handle.resume()
                    }
                }
            }
            promise.resolve(allowed)
        } catch (error: Exception) {
            promise.reject("POLICY", error.message, error)
        }
    }

    @ReactMethod
    fun networkStatus(promise: Promise) {
        try {
            val manager = reactApplicationContext.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
            val capabilities = manager.getNetworkCapabilities(manager.activeNetwork)
            val battery = reactApplicationContext.registerReceiver(null, android.content.IntentFilter(Intent.ACTION_BATTERY_CHANGED))
            val status = battery?.getIntExtra(android.os.BatteryManager.EXTRA_STATUS, -1)
            promise.resolve(Arguments.createMap().apply {
                putBoolean("wifi", capabilities?.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) == true)
                putBoolean("vpn", capabilities?.hasTransport(NetworkCapabilities.TRANSPORT_VPN) == true)
                putBoolean("charging", status == android.os.BatteryManager.BATTERY_STATUS_CHARGING || status == android.os.BatteryManager.BATTERY_STATUS_FULL)
                putBoolean("powerSave", (reactApplicationContext.getSystemService(Context.POWER_SERVICE) as android.os.PowerManager).isPowerSaveMode)
                putString("vpnAddress", vpnAddress(manager))
            })
        } catch (error: Exception) {
            promise.resolve(Arguments.createMap().apply {
                putBoolean("wifi", true)
                putBoolean("charging", true)
                putBoolean("vpn", false)
                putBoolean("powerSave", false)
                putString("vpnAddress", "")
            })
        }
    }

    @ReactMethod
    fun consumeLaunchIntent(promise: Promise) {
        try {
            val activity = reactApplicationContext.currentActivity
            val intent = sharedIntent ?: activity?.intent
            sharedIntent = null
            if (intent == null) {
                promise.resolve(null)
                return
            }
            val shared = intent.getStringExtra(Intent.EXTRA_TEXT)?.trim().orEmpty()
            val data = intent.data
            val mime = intent.type.orEmpty()
            val value = when {
                shared.startsWith("magnet:", true) || shared.startsWith("http", true) -> shared
                data?.scheme.equals("magnet", true) -> data.toString()
                data != null && (mime == "application/x-bittorrent" || data.lastPathSegment?.endsWith(".torrent") == true) -> data.toString()
                else -> ""
            }
            if (value.isEmpty()) {
                promise.resolve(null)
                return
            }
            intent.action = Intent.ACTION_MAIN
            intent.data = null
            intent.removeExtra(Intent.EXTRA_TEXT)
            val kind = when {
                value.startsWith("magnet:", true) -> "magnet"
                value.startsWith("content:", true) || value.endsWith(".torrent") -> "torrent"
                else -> "http"
            }
            promise.resolve(Arguments.createMap().apply {
                putString("kind", kind)
                putString("value", value)
            })
        } catch (error: Exception) {
            promise.reject("INTENT", error.message, error)
        }
    }

    @ReactMethod
    fun readClipboard(promise: Promise) {
        try {
            val clipboard = reactApplicationContext.getSystemService(Context.CLIPBOARD_SERVICE) as android.content.ClipboardManager
            promise.resolve(clipboard.primaryClip?.getItemAt(0)?.coerceToText(reactApplicationContext)?.toString())
        } catch (error: Exception) {
            promise.resolve(null)
        }
    }

    @ReactMethod
    fun exportToFolder(infoHash: String, treeUri: String, promise: Promise) {
        Thread {
            try {
                val save = TorrentModule.torrentSavePaths[infoHash] ?: throw IllegalStateException("Save folder is unknown")
                val tree = DocumentFile.fromTreeUri(reactApplicationContext, Uri.parse(treeUri))
                    ?: throw IllegalStateException("The selected folder is not available")
                var copied = 0
                File(save).walkTopDown().filter { it.isFile }.forEach { file ->
                    val dest = tree.createFile("application/octet-stream", file.name) ?: return@forEach
                    reactApplicationContext.contentResolver.openOutputStream(dest.uri)?.use { output ->
                        file.inputStream().use { it.copyTo(output) }
                    }
                    copied += 1
                }
                promise.resolve(copied)
            } catch (error: Exception) {
                promise.reject("EXPORT", error.message, error)
            }
        }.start()
    }

    private fun handle(infoHash: String): TorrentHandle? =
        try {
            engine().ensureSession().find(Sha1Hash.parseHex(infoHash))?.takeIf { it.isValid }
        } catch (_: Exception) {
            null
        }

    private fun summary(handle: TorrentHandle): WritableNativeMap {
        val status = handle.status()
        val hash = handle.infoHash().toHex()
        return WritableNativeMap().apply {
            putString("infoHash", hash)
            putString("name", status.name().ifBlank { hash })
            putString("state", when (status.state()) {
                TorrentStatus.State.CHECKING_FILES, TorrentStatus.State.CHECKING_RESUME_DATA -> "checking"
                TorrentStatus.State.DOWNLOADING_METADATA -> "metadata"
                TorrentStatus.State.DOWNLOADING -> "downloading"
                TorrentStatus.State.FINISHED -> "finished"
                TorrentStatus.State.SEEDING -> "seeding"
                else -> "unknown"
            })
            putBoolean("paused", status.flags().and_(TorrentFlags.PAUSED).non_zero() || TorrentModule.userStopped.contains(hash))
            putBoolean("stopped", TorrentModule.userStopped.contains(hash))
            putDouble("progress", status.progress().toDouble())
            putDouble("downloadRate", status.downloadRate().toDouble())
            putDouble("uploadRate", status.uploadRate().toDouble())
            putInt("numPeers", status.numPeers())
            putInt("numSeeds", status.numSeeds())
            putDouble("totalDone", status.totalDone().toDouble())
            putDouble("totalWanted", status.totalWanted().toDouble())
            putDouble("allTimeDownload", status.allTimeDownload().toDouble())
            putDouble("allTimeUpload", status.allTimeUpload().toDouble())
            putBoolean("hasMetadata", status.hasMetadata())
            putString("savePath", handle.savePath())
        }
    }

    private fun copyContent(uri: Uri, dir: File): File {
        val name = reactApplicationContext.contentResolver.query(uri, null, null, null, null)?.use { cursor ->
            val index = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
            if (index >= 0 && cursor.moveToFirst()) cursor.getString(index) else null
        } ?: "incoming.torrent"
        val dest = File(dir, name)
        reactApplicationContext.contentResolver.openInputStream(uri)?.use { input ->
            dest.outputStream().use { input.copyTo(it) }
        } ?: throw IllegalStateException("Unable to read the torrent file")
        return dest
    }

    private fun vpnAddress(manager: ConnectivityManager): String {
        for (network in manager.allNetworks) {
            val capabilities = manager.getNetworkCapabilities(network) ?: continue
            if (!capabilities.hasTransport(NetworkCapabilities.TRANSPORT_VPN)) continue
            val address = manager.getLinkProperties(network)?.linkAddresses
                ?.firstOrNull { it.address is Inet4Address }?.address?.hostAddress
            if (!address.isNullOrBlank()) return address
        }
        return ""
    }

    private fun parseBlockLine(raw: String): kotlin.Pair<String, String>? {
        val line = raw.trim()
        if (line.isEmpty() || line.startsWith("#")) return null
        val token = if (line.contains(':')) line.substring(line.lastIndexOf(':') + 1).trim() else line
        val cidr = Regex("^(.+)/(\\d{1,2})$").find(token)
        if (cidr != null) {
            val base = ipv4(cidr.groupValues[1]) ?: return null
            val bits = cidr.groupValues[2].toInt()
            if (bits > 32) return null
            val mask = if (bits == 0) 0 else (-1 shl (32 - bits))
            val start = base and mask
            val end = start or mask.inv()
            return ipv4Text(start) to ipv4Text(end)
        }
        val span = Regex("^(.+)-(.+)$").find(token)
        if (span != null && ipv4(span.groupValues[1]) != null && ipv4(span.groupValues[2]) != null) {
            return span.groupValues[1].trim() to span.groupValues[2].trim()
        }
        return if (ipv4(token) != null) token to token else null
    }

    private fun ipv4(value: String): Int? {
        val parts = value.trim().split('.')
        if (parts.size != 4) return null
        var result = 0
        for (part in parts) {
            val number = part.toIntOrNull() ?: return null
            if (number !in 0..255) return null
            result = (result shl 8) or number
        }
        return result
    }

    private fun ipv4Text(value: Int): String =
        listOf(24, 16, 8, 0).joinToString(".") { ((value ushr it) and 255).toString() }
}

class TorrentForegroundService : Service() {
    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val text = intent?.getStringExtra("text") ?: "Torrents"
        val notification = TorrentNotifier.build(this, text)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(72, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
        } else {
            startForeground(72, notification)
        }
        return START_STICKY
    }

    override fun onBind(intent: Intent?) = null
}

internal object TorrentNotifier {
    fun update(context: Context) {
        val manager = TorrentModule.sessionManager
        val text = if (manager != null && manager.isRunning) {
            "Down ${manager.downloadRate() / 1024} KB/s · Up ${manager.uploadRate() / 1024} KB/s"
        } else {
            "Torrents"
        }
        val intent = Intent(context, TorrentForegroundService::class.java).putExtra("text", text)
        ContextCompat.startForegroundService(context, intent)
    }

    fun build(context: Context, text: String): android.app.Notification {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val manager = context.getSystemService(NotificationManager::class.java)
            if (manager.getNotificationChannel("droidstream-torrents") == null) {
                manager.createNotificationChannel(NotificationChannel("droidstream-torrents", "Torrents", NotificationManager.IMPORTANCE_LOW))
            }
        }
        return NotificationCompat.Builder(context, "droidstream-torrents")
            .setSmallIcon(android.R.drawable.stat_sys_download)
            .setContentTitle("Droid Stream torrents")
            .setContentText(text)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .build()
    }
}
