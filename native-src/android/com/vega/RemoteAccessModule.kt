package com.vega

import android.content.Context
import android.net.ConnectivityManager
import android.net.LinkProperties
import android.net.Network
import android.net.NetworkCapabilities
import androidx.core.content.ContextCompat
import com.facebook.react.ReactPackage
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableArray
import com.facebook.react.bridge.WritableMap
import com.facebook.react.modules.core.DeviceEventManagerModule
import com.facebook.react.uimanager.ViewManager
import org.json.JSONArray
import org.json.JSONObject
import java.lang.ref.WeakReference
import java.net.Inet4Address
import java.net.InetAddress
import java.net.NetworkInterface
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/**
 * Remote control (an aria2-style JSON-RPC server on the home network), command
 * access (token-checked broadcasts) and the browser-like connection list.
 * All of it is off until the user turns it on. The server and its foreground
 * service live here, outside the React module, so a JavaScript reload does not
 * stop them; JavaScript answers every request through [RemoteAccessModule].
 */
object RemoteAccess {
    private const val TAG = "RemoteAccess"
    const val PREFS = "droidstream_remote_access"
    private const val KEY_COMMANDS_ENABLED = "commands_enabled"
    private const val KEY_COMMAND_TOKEN = "command_token"
    private const val KEY_PENDING = "pending_commands"
    private const val KEY_STOPPED_FROM_NOTIFICATION = "rpc_stopped_from_notification"
    private const val MAX_PENDING = 20
    private const val MAX_WAITING_REQUESTS = 64
    private const val RPC_TIMEOUT_SECONDS = 30L

    private class Slot {
        val latch = CountDownLatch(1)
        @Volatile var value: String? = null
        @Volatile var ok: Boolean = false
    }

    private val rpcSlots = ConcurrentHashMap<String, Slot>()
    private val commandSlots = ConcurrentHashMap<String, Slot>()
    @Volatile private var moduleRef: WeakReference<RemoteAccessModule>? = null
    @Volatile private var appContext: Context? = null

    private var server: RemoteRpcServer? = null
    private var wantedPort = 0
    private var maxBodyBytes = 0
    @Volatile var lastError: String? = null
        private set
    private var networkCallback: ConnectivityManager.NetworkCallback? = null

    fun attach(module: RemoteAccessModule, context: Context) {
        moduleRef = WeakReference(module)
        appContext = context.applicationContext
    }

    fun detach(module: RemoteAccessModule) {
        if (moduleRef?.get() === module) moduleRef = null
    }

    internal fun module(): RemoteAccessModule? = moduleRef?.get()?.takeIf { it.canEmit() }

    // ---- Home network address ----

    /** The device's IPv4 address on Wi-Fi or Ethernet (or its own hotspot), if any. */
    @Suppress("DEPRECATION")
    fun lanAddress(context: Context): Inet4Address? {
        val manager = context.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
        val fromNetworks = runCatching {
            manager.allNetworks.firstNotNullOfOrNull { network ->
                val capabilities = manager.getNetworkCapabilities(network) ?: return@firstNotNullOfOrNull null
                val local = capabilities.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) ||
                    capabilities.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET)
                if (!local) return@firstNotNullOfOrNull null
                manager.getLinkProperties(network)?.linkAddresses
                    ?.map { it.address }
                    ?.firstOrNull { it is Inet4Address && it.isSiteLocalAddress } as Inet4Address?
            }
        }.getOrNull()
        if (fromNetworks != null) return fromNetworks
        // A hotspot this device runs is not a "network" to ConnectivityManager.
        return runCatching {
            NetworkInterface.getNetworkInterfaces()?.toList().orEmpty()
                .filter { it.isUp && !it.isLoopback && Regex("^(wlan|ap|swlan|softap|eth)\\d*").containsMatchIn(it.name) }
                .flatMap { it.inetAddresses.toList() }
                .firstOrNull { it is Inet4Address && it.isSiteLocalAddress } as Inet4Address?
        }.getOrNull()
    }

    // ---- Server ----

    @Synchronized
    fun state(): WritableMap = Arguments.createMap().apply {
        val current = server
        putBoolean("running", current != null)
        if (current != null) {
            putString("address", current.address.hostAddress)
            putInt("port", current.port)
        } else if (wantedPort > 0) {
            putInt("port", wantedPort)
        }
        lastError?.let { putString("error", it) }
    }

    @Synchronized
    fun start(context: Context, port: Int, maxBody: Int): WritableMap {
        val app = context.applicationContext
        appContext = app
        wantedPort = port
        maxBodyBytes = maxBody
        bind(app)
        // The notification stays while remote control is on, also while it waits for Wi-Fi.
        try {
            ContextCompat.startForegroundService(app, android.content.Intent(app, RemoteControlService::class.java))
        } catch (error: Exception) {
            VegaLog.w(TAG, "Foreground service not allowed: ${error.message}")
            wantedPort = 0
            server?.stop()
            server = null
            lastError = "Could not show the notification remote control needs. Open Droid Stream and try again."
            return state()
        }
        watchNetwork(app)
        return state()
    }

    /** (Re)binds to the current home-network address. */
    @Synchronized
    private fun bind(context: Context) {
        if (wantedPort <= 0) return
        val address = lanAddress(context)
        val current = server
        if (current != null && current.address == address && current.port == wantedPort) return
        current?.stop()
        server = null
        if (address == null) {
            lastError = "Connect to Wi-Fi to use remote control."
            return
        }
        val next = RemoteRpcServer(address, wantedPort, maxBodyBytes) { client, body -> dispatchRpc(client, body) }
        try {
            next.start()
            server = next
            lastError = null
            VegaLog.i(TAG, "Remote control on ${address.hostAddress}:$wantedPort")
        } catch (error: Exception) {
            next.stop()
            lastError = "Port $wantedPort is in use. Choose another port."
            VegaLog.w(TAG, "Could not listen on $wantedPort: ${error.message}")
        }
    }

    @Synchronized
    fun stop(context: Context, fromNotification: Boolean, error: String? = null) {
        wantedPort = 0
        server?.stop()
        server = null
        lastError = error ?: if (fromNotification) "stopped-from-notification" else null
        unwatchNetwork(context.applicationContext)
        context.applicationContext.stopService(android.content.Intent(context.applicationContext, RemoteControlService::class.java))
        if (fromNotification) {
            context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
                .putBoolean(KEY_STOPPED_FROM_NOTIFICATION, true).apply()
        }
        emitState()
        if (fromNotification) lastError = null
    }

    fun isWanted(): Boolean = wantedPort > 0

    @Synchronized
    fun notificationText(): String {
        val current = server ?: return lastError ?: "Waiting for Wi-Fi"
        return "http://${current.address.hostAddress}:${current.port}/jsonrpc"
    }

    private fun watchNetwork(context: Context) {
        if (networkCallback != null) return
        val manager = context.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
        val callback = object : ConnectivityManager.NetworkCallback() {
            override fun onAvailable(network: Network) = recheck()
            override fun onLost(network: Network) = recheck()
            override fun onLinkPropertiesChanged(network: Network, linkProperties: LinkProperties) = recheck()
        }
        runCatching { manager.registerDefaultNetworkCallback(callback) }.onSuccess { networkCallback = callback }
    }

    private fun unwatchNetwork(context: Context) {
        val callback = networkCallback ?: return
        networkCallback = null
        val manager = context.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
        runCatching { manager.unregisterNetworkCallback(callback) }
    }

    private fun recheck() {
        val context = appContext ?: return
        val before = synchronized(this) { server?.address }
        synchronized(this) { if (wantedPort > 0) bind(context) }
        val after = synchronized(this) { server?.address }
        if (before != after) {
            RemoteControlService.refresh(context)
            emitState()
        }
    }

    private fun emitState() {
        module()?.emit("RemoteRpcState", state())
    }

    // ---- Requests to JavaScript ----

    private fun errorReply(message: String) =
        JSONObject().put("jsonrpc", "2.0").put("id", JSONObject.NULL)
            .put("error", JSONObject().put("code", 1).put("message", message)).toString()

    /** Runs on a server thread: hands the body to JavaScript and waits for its answer. */
    fun dispatchRpc(client: String, body: String): String? {
        val module = module() ?: return errorReply("Open Droid Stream to use remote control")
        if (rpcSlots.size >= MAX_WAITING_REQUESTS) return errorReply("Busy, try again")
        val id = UUID.randomUUID().toString()
        val slot = Slot()
        rpcSlots[id] = slot
        try {
            module.emit("RemoteRpcRequest", Arguments.createMap().apply {
                putString("id", id)
                putString("client", client)
                putString("body", body)
            })
            if (!slot.latch.await(RPC_TIMEOUT_SECONDS, TimeUnit.SECONDS)) return errorReply("Droid Stream did not answer in time")
            return slot.value
        } finally {
            rpcSlots.remove(id)
        }
    }

    fun answerRpc(id: String, body: String?) {
        val slot = rpcSlots[id] ?: return
        slot.value = body
        slot.latch.countDown()
    }

    // ---- Command access ----

    fun commandsEnabled(context: Context): Boolean =
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getBoolean(KEY_COMMANDS_ENABLED, false)

    fun commandToken(context: Context): String =
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY_COMMAND_TOKEN, "") ?: ""

    fun setCommandAccess(context: Context, enabled: Boolean, token: String) {
        val editor = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
            .putBoolean(KEY_COMMANDS_ENABLED, enabled && token.length >= 16)
            .putString(KEY_COMMAND_TOKEN, if (enabled) token else "")
        if (!enabled) editor.remove(KEY_PENDING)
        editor.apply()
    }

    /** Sends a command to JavaScript and waits for its answer: (worked, text). */
    fun dispatchCommand(action: String, extras: Map<String, String>, timeoutSeconds: Long): Pair<Boolean, String> {
        val module = module() ?: return false to "Droid Stream is not open. Open it and try again."
        val id = UUID.randomUUID().toString()
        val slot = Slot()
        commandSlots[id] = slot
        try {
            module.emit("RemoteCommand", Arguments.createMap().apply {
                putString("id", id)
                putString("action", action)
                putMap("extras", Arguments.createMap().apply { extras.forEach { (key, value) -> putString(key, value) } })
            })
            if (!slot.latch.await(timeoutSeconds, TimeUnit.SECONDS)) return false to "Droid Stream did not answer in time"
            return slot.ok to (slot.value ?: "")
        } finally {
            commandSlots.remove(id)
        }
    }

    fun answerCommand(id: String, ok: Boolean, text: String) {
        val slot = commandSlots[id] ?: return
        slot.ok = ok
        slot.value = text
        slot.latch.countDown()
    }

    /** Keeps an ADD_DOWNLOAD for the next start of the app. Returns false when the list is full. */
    @Synchronized
    fun savePending(context: Context, action: String, extras: Map<String, String>): Boolean {
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val list = runCatching { JSONArray(prefs.getString(KEY_PENDING, "[]")) }.getOrDefault(JSONArray())
        if (list.length() >= MAX_PENDING) return false
        list.put(JSONObject().put("action", action).put("extras", JSONObject(extras)).toString())
        prefs.edit().putString(KEY_PENDING, list.toString()).apply()
        return true
    }

    @Synchronized
    fun takePending(context: Context): List<String> {
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val list = runCatching { JSONArray(prefs.getString(KEY_PENDING, "[]")) }.getOrDefault(JSONArray())
        prefs.edit().remove(KEY_PENDING).apply()
        return (0 until list.length()).map { list.getString(it) }
    }

    fun consumeStoppedFromNotification(context: Context): Boolean {
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val stopped = prefs.getBoolean(KEY_STOPPED_FROM_NOTIFICATION, false)
        if (stopped) prefs.edit().remove(KEY_STOPPED_FROM_NOTIFICATION).apply()
        return stopped
    }
}

class RemoteAccessModule(private val reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {
    override fun getName(): String = "RemoteAccessModule"

    init {
        RemoteAccess.attach(this, reactContext)
        BrowserLikeConnection.load(reactContext)
    }

    override fun getConstants(): MutableMap<String, Any> = mutableMapOf("packageName" to reactContext.packageName)

    override fun invalidate() {
        RemoteAccess.detach(this)
        super.invalidate()
    }

    internal fun canEmit(): Boolean = reactContext.hasActiveReactInstance()

    internal fun emit(name: String, params: WritableMap) {
        runCatching {
            reactContext.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java).emit(name, params)
        }
    }

    @ReactMethod fun addListener(eventName: String) = Unit
    @ReactMethod fun removeListeners(count: Double) = Unit

    @ReactMethod
    fun startServer(port: Double, maxBodyBytes: Double, promise: Promise) {
        val wanted = port.toInt()
        if (wanted !in 1024..65535) return promise.reject("BAD_PORT", "Choose a port from 1024 to 65535")
        Thread {
            try {
                promise.resolve(RemoteAccess.start(reactContext, wanted, maxBodyBytes.toInt().coerceIn(64 * 1024, 16 * 1024 * 1024)))
            } catch (error: Exception) {
                promise.reject("START_FAILED", error.message, error)
            }
        }.start()
    }

    @ReactMethod
    fun stopServer(promise: Promise) {
        RemoteAccess.stop(reactContext, fromNotification = false)
        promise.resolve(null)
    }

    @ReactMethod
    fun serverState(promise: Promise) {
        promise.resolve(RemoteAccess.state())
    }

    @ReactMethod
    fun respond(id: String, body: String?) {
        RemoteAccess.answerRpc(id, body)
    }

    @ReactMethod
    fun consumeStoppedFromNotification(promise: Promise) {
        promise.resolve(RemoteAccess.consumeStoppedFromNotification(reactContext))
    }

    @ReactMethod
    fun setCommandAccess(enabled: Boolean, token: String, promise: Promise) {
        RemoteAccess.setCommandAccess(reactContext, enabled, token)
        promise.resolve(null)
    }

    @ReactMethod
    fun respondCommand(id: String, ok: Boolean, text: String) {
        RemoteAccess.answerCommand(id, ok, text)
    }

    @ReactMethod
    fun takePendingCommands(promise: Promise) {
        val array = Arguments.createArray()
        RemoteAccess.takePending(reactContext).forEach { array.pushString(it) }
        promise.resolve(array)
    }

    @ReactMethod
    fun setBrowserLikeSites(sites: ReadableArray, never: ReadableArray, promise: Promise) {
        fun strings(array: ReadableArray) = (0 until array.size()).mapNotNull { array.getString(it) }
        BrowserLikeConnection.configure(reactContext, strings(sites), strings(never))
        promise.resolve(null)
    }
}

class RemoteAccessPackage : ReactPackage {
    override fun createNativeModules(reactContext: ReactApplicationContext): List<NativeModule> =
        listOf(RemoteAccessModule(reactContext))

    override fun createViewManagers(reactContext: ReactApplicationContext): List<ViewManager<*, *>> = emptyList()
}
