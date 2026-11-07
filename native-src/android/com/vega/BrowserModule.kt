package com.vega

import android.app.Activity
import android.app.KeyguardManager
import android.content.Context
import android.content.Intent
import android.os.Handler
import android.os.Looper
import android.view.View
import android.view.ViewGroup
import android.webkit.CookieManager
import android.webkit.URLUtil
import android.webkit.WebResourceRequest
import android.webkit.WebStorage
import android.webkit.WebView
import androidx.webkit.WebSettingsCompat
import androidx.webkit.WebViewFeature
import com.facebook.react.ReactPackage
import com.facebook.react.bridge.ActivityEventListener
import com.facebook.react.bridge.LifecycleEventListener
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableArray
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.bridge.UiThreadUtil
import com.facebook.react.bridge.WritableMap
import com.facebook.react.modules.core.DeviceEventManagerModule
import com.facebook.react.uimanager.UIManagerHelper
import com.facebook.react.uimanager.ViewManager
import java.io.File
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger

/** One browser tab's WebView: what its page blocked and which media it loaded. */
class BrowserTab(val key: String, private val module: BrowserModule) {
    @Volatile var pageUrl = ""
    @Volatile private var pageFlags = ""
    private val blocked = AtomicInteger()
    private val media = ConcurrentHashMap.newKeySet<String>()
    private val countQueued = AtomicBoolean(false)

    val blockedCount: Int get() = blocked.get()

    private fun startPage(url: String) {
        pageUrl = url
        pageFlags = BrowserModule.filters?.pageFlags(url) ?: ""
        blocked.set(0)
        media.clear()
        emitCount()
    }

    fun onPageStarted(url: String) {
        if (url.isNotEmpty() && url != pageUrl) startPage(url)
    }

    /** True when the request is blocked. Runs on a WebView background thread. */
    fun onRequest(request: WebResourceRequest): Boolean {
        val url = request.url?.toString() ?: return false
        if (!url.startsWith("http://", true) && !url.startsWith("https://", true)) return false
        if (request.isForMainFrame) {
            startPage(url)
            return false
        }
        val headers = request.requestHeaders.orEmpty()
        val accept = headers["Accept"] ?: headers["accept"] ?: ""
        if (MEDIA.containsMatchIn(url.substringBefore('#'))) reportMedia(url, accept)
        val filters = BrowserModule.filters ?: return false
        if (!BrowserModule.blockingEnabled || pageFlags.contains('d') || BrowserModule.allowed(pageUrl)) return false
        val type = BrowserFilters.inferType(url, accept, false)
        if (!filters.shouldBlock(url, pageUrl, type)) return false
        blocked.incrementAndGet()
        if (countQueued.compareAndSet(false, true)) {
            module.mainHandler.postDelayed({
                countQueued.set(false)
                emitCount()
            }, 500)
        }
        return true
    }

    private fun reportMedia(url: String, accept: String) {
        if (media.size > 300 || !media.add(url)) return
        module.emit(Arguments.createMap().apply {
            putString("type", "media")
            putString("tab", key)
            putString("url", url)
            putString("pageUrl", pageUrl)
            putString("accept", accept)
        })
    }

    private fun emitCount() {
        module.emit(Arguments.createMap().apply {
            putString("type", "blocked")
            putString("tab", key)
            putString("pageUrl", pageUrl)
            putInt("count", blocked.get())
        })
    }

    companion object {
        private val MEDIA = Regex(
            "(\\.(m3u8|mpd|mp4|m4v|webm|mkv|mov|mp3|m4a|aac|ogg|oga|opus|flac|wav|torrent)(\\?|$))|([?&](mime|type)=(video|audio)%2F)|([?&]format=m3u8)",
            RegexOption.IGNORE_CASE,
        )
    }
}

/**
 * Hooks for the browser screen that react-native-webview does not have:
 * the request hook (ad blocking, media detection), downloads into the app's
 * own downloader, clearing one site's storage for private tabs, device
 * autofill and passkeys, and the screen lock before showing saved
 * passwords. The browser reaches it through src/lib/browser/engines/webview.ts.
 */
class BrowserModule(private val context: ReactApplicationContext) :
    ReactContextBaseJavaModule(context), ActivityEventListener, LifecycleEventListener {
    val mainHandler = Handler(Looper.getMainLooper())
    private val executor = Executors.newSingleThreadExecutor()
    private val tabs = ConcurrentHashMap<String, BrowserTab>()
    private var authPromise: Promise? = null

    init {
        context.addActivityEventListener(this)
        context.addLifecycleEventListener(this)
    }

    override fun onActivityResult(activity: Activity, requestCode: Int, resultCode: Int, data: Intent?) {
        if (requestCode != AUTH_REQUEST) return
        authPromise?.resolve(if (resultCode == Activity.RESULT_OK) "ok" else "cancelled")
        authPromise = null
    }

    override fun onNewIntent(intent: Intent) = Unit

    override fun onHostResume() = Unit

    // Sign-ins survive the app being killed in the background.
    override fun onHostPause() {
        try {
            CookieManager.getInstance().flush()
        } catch (_: Exception) {
            // No WebView provider on this device.
        }
    }

    override fun onHostDestroy() = onHostPause()

    override fun getName() = "BrowserModule"

    fun emit(payload: WritableMap) {
        if (!context.hasActiveReactInstance()) return
        context.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java).emit(EVENT, payload)
    }

    private fun findWebView(view: View?, depth: Int = 0): WebView? {
        if (view == null || depth > 3) return null
        if (view is WebView) return view
        if (view is ViewGroup) {
            for (index in 0 until view.childCount) findWebView(view.getChildAt(index), depth + 1)?.let { return it }
        }
        return null
    }

    private fun resolveWebView(tag: Int): WebView? = try {
        findWebView(UIManagerHelper.getUIManagerForReactTag(context, tag)?.resolveView(tag))
    } catch (_: Exception) {
        null
    }

    /** Hooks the WebView with React tag [tag] for tab [key]. Resolves false when the view is not there. */
    @ReactMethod
    fun attach(tag: Int, key: String, options: ReadableMap, promise: Promise) {
        val autofill = !options.hasKey("autofill") || options.getBoolean("autofill")
        val passkeys = !options.hasKey("passkeys") || options.getBoolean("passkeys")
        fun attempt(left: Int) {
            val webView = resolveWebView(tag)
            if (webView == null) {
                if (left > 0) mainHandler.postDelayed({ attempt(left - 1) }, 50) else promise.resolve(false)
                return
            }
            try {
                val tab = tabs.getOrPut(key) { BrowserTab(key, this) }
                when (val current = webView.webViewClient) {
                    is BrowserWebClient -> current.tab = tab
                    else -> webView.webViewClient = BrowserWebClient(current, tab)
                }
                // Password managers (Google, Bitwarden, 1Password) fill the page's fields through Autofill.
                webView.importantForAutofill =
                    if (autofill) View.IMPORTANT_FOR_AUTOFILL_YES else View.IMPORTANT_FOR_AUTOFILL_NO_EXCLUDE_DESCENDANTS
                // Passkeys go through Credential Manager as a browser. Providers decide whether they
                // serve this app: Google Password Manager only serves browsers on its own list.
                if (WebViewFeature.isFeatureSupported(WebViewFeature.WEB_AUTHENTICATION)) {
                    WebSettingsCompat.setWebAuthenticationSupport(
                        webView.settings,
                        if (passkeys) WebSettingsCompat.WEB_AUTHENTICATION_SUPPORT_FOR_BROWSER
                        else WebSettingsCompat.WEB_AUTHENTICATION_SUPPORT_NONE,
                    )
                }
                webView.setDownloadListener { url, userAgent, contentDisposition, mimeType, contentLength ->
                    emit(Arguments.createMap().apply {
                        putString("type", "download")
                        putString("tab", key)
                        putString("url", url)
                        putString("pageUrl", tab.pageUrl)
                        putString("userAgent", userAgent)
                        putString("contentDisposition", contentDisposition)
                        putString("mimeType", mimeType)
                        putDouble("contentLength", contentLength.toDouble())
                        putString("fileName", URLUtil.guessFileName(url, contentDisposition, mimeType))
                    })
                }
                promise.resolve(true)
            } catch (error: Exception) {
                promise.reject("BROWSER_ATTACH", error.message, error)
            }
        }
        UiThreadUtil.runOnUiThread { attempt(20) }
    }

    @ReactMethod
    fun detach(key: String) {
        tabs.remove(key)
    }

    /** Loads compiled network rules from a file. Resolves the number of rules. */
    @ReactMethod
    fun loadFilters(path: String, promise: Promise) {
        executor.execute {
            try {
                val loaded = BrowserFilters.load(File(path))
                filters = loaded
                filtersPath = path
                promise.resolve(loaded.size)
            } catch (error: Exception) {
                promise.reject("BROWSER_FILTERS", error.message, error)
            }
        }
    }

    /** The file the loaded rules came from and when, so JS can skip loading them again. */
    @ReactMethod
    fun loadedFilters(promise: Promise) {
        promise.resolve(Arguments.createMap().apply {
            putString("path", filtersPath)
            putInt("size", filters?.size ?: 0)
        })
    }

    @ReactMethod
    fun clearFilters() {
        filters = null
        filtersPath = null
    }

    @ReactMethod
    fun setBlocking(enabled: Boolean, allowlist: ReadableArray) {
        blockingEnabled = enabled
        val sites = HashSet<String>()
        for (index in 0 until allowlist.size()) allowlist.getString(index)?.lowercase()?.let { sites.add(it) }
        allowedSites = sites
    }

    /** Whether a request would be blocked (used for pop-ups). */
    @ReactMethod
    fun check(url: String, pageUrl: String, type: Int, promise: Promise) {
        val loaded = filters
        promise.resolve(loaded != null && blockingEnabled && !allowed(pageUrl) && loaded.shouldBlock(url, pageUrl, type))
    }

    @ReactMethod
    fun blockedCount(key: String, promise: Promise) {
        promise.resolve(tabs[key]?.blockedCount ?: 0)
    }

    /** Deletes local storage, IndexedDB and caches of these origins (private tabs). */
    @ReactMethod
    fun clearOrigins(origins: ReadableArray, promise: Promise) {
        UiThreadUtil.runOnUiThread {
            try {
                val storage = WebStorage.getInstance()
                for (index in 0 until origins.size()) origins.getString(index)?.let { storage.deleteOrigin(it) }
                promise.resolve(true)
            } catch (error: Exception) {
                promise.reject("BROWSER_CLEAR", error.message, error)
            }
        }
    }

    @ReactMethod
    fun passkeyStatus(promise: Promise) {
        promise.resolve(if (WebViewFeature.isFeatureSupported(WebViewFeature.WEB_AUTHENTICATION)) "supported" else "unsupported")
    }

    @ReactMethod
    fun flushCookies() = onHostPause()

    /** The phone's screen lock (PIN, pattern, password or fingerprint). */
    @ReactMethod
    fun authenticate(title: String, description: String, promise: Promise) {
        UiThreadUtil.runOnUiThread {
            try {
                val keyguard = context.getSystemService(Context.KEYGUARD_SERVICE) as KeyguardManager
                @Suppress("DEPRECATION")
                val intent = if (keyguard.isDeviceSecure) keyguard.createConfirmDeviceCredentialIntent(title, description) else null
                val activity = context.currentActivity
                when {
                    intent == null -> promise.resolve("no-lock")
                    activity == null -> promise.resolve("cancelled")
                    else -> {
                        authPromise?.resolve("cancelled")
                        authPromise = promise
                        activity.startActivityForResult(intent, AUTH_REQUEST)
                    }
                }
            } catch (error: Exception) {
                promise.reject("BROWSER_AUTH", error.message, error)
            }
        }
    }

    @ReactMethod fun addListener(eventName: String) = Unit
    @ReactMethod fun removeListeners(count: Double) = Unit

    companion object {
        const val EVENT = "BrowserEvent"
        private const val AUTH_REQUEST = 47213
        @Volatile var filters: BrowserFilters? = null
        @Volatile private var filtersPath: String? = null
        @Volatile var blockingEnabled = true
        @Volatile private var allowedSites: Set<String> = emptySet()

        fun allowed(pageUrl: String): Boolean {
            val sites = allowedSites
            if (sites.isEmpty()) return false
            val host = BrowserFilters.hostOf(pageUrl)
            return sites.any { BrowserFilters.domainMatches(host, it) }
        }
    }
}

class BrowserPackage : ReactPackage {
    override fun createNativeModules(reactContext: ReactApplicationContext): List<NativeModule> =
        listOf(BrowserModule(reactContext))

    override fun createViewManagers(reactContext: ReactApplicationContext): List<ViewManager<*, *>> = emptyList()
}
