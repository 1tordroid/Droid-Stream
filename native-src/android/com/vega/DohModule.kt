package com.vega

import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableArray
import com.facebook.react.ReactPackage
import com.facebook.react.uimanager.ViewManager
import com.facebook.react.modules.network.OkHttpClientProvider
import com.facebook.react.modules.core.DeviceEventManagerModule

class DohModule(reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {

    init {
        // Smart unblock tells JS which hosts it routed, for the toast and the saved list.
        SmartUnblock.emitter = { event, host, route, learned ->
            try {
                val payload = com.facebook.react.bridge.Arguments.createMap().apply {
                    putString("host", host)
                    route?.let { putString("route", it.key) }
                    putBoolean("learned", learned)
                }
                reactApplicationContext
                    .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
                    .emit(if (event == "forget") "SmartUnblockForget" else "SmartUnblockRouted", payload)
            } catch (_: Exception) {
                // JS is not running; the route is still used for this session.
            }
        }
    }

    override fun getName(): String = "DohModule"

    /** Mode, host lists, block patterns and remembered routes for Smart unblock, as JSON. */
    @ReactMethod
    fun configureUnblock(json: String, promise: Promise) {
        try {
            SmartUnblock.configure(json)
            promise.resolve(SmartUnblock.mode)
        } catch (e: Exception) {
            promise.reject("UNBLOCK_CONFIG", e.message, e)
        }
    }

    @ReactMethod
    fun forgetUnblockHost(host: String, promise: Promise) {
        SmartUnblock.forget(host)
        promise.resolve(true)
    }

    @ReactMethod
    fun getUnblockStatus(promise: Promise) {
        val factory = getFactory()
        promise.resolve(com.facebook.react.bridge.Arguments.createMap().apply {
            putString("mode", SmartUnblock.mode)
            putBoolean("byeDpiRunning", factory?.byeDpiProxyPort != null)
            putBoolean("warpRunning", factory?.warpProxyPort != null)
        })
    }

    // Required by NativeEventEmitter on the JS side.
    @ReactMethod
    fun addListener(eventName: String) {}

    @ReactMethod
    fun removeListeners(count: Int) {}

    private fun getFactory(): DohOkHttpFactory? {
        return DohOkHttpFactory.instance
    }

    private fun flushConnections() {
        try {
            OkHttpClientProvider.getOkHttpClient().connectionPool.evictAll()
        } catch (e: Exception) {
            // ignore
        }
    }

    @ReactMethod
    fun setEnabled(enabled: Boolean, promise: Promise) {
        try {
            val factory = getFactory()
            if (factory != null) {
                factory.enabled = enabled
                flushConnections()
                promise.resolve(enabled)
            } else {
                promise.reject("DOH_ERROR", "DohOkHttpFactory not registered")
            }
        } catch (e: Exception) {
            promise.reject("DOH_ERROR", e.message, e)
        }
    }

    @ReactMethod
    fun setProvider(providerName: String, promise: Promise) {
        try {
            val factory = getFactory()
            if (factory == null) {
                promise.reject("DOH_ERROR", "DohOkHttpFactory not registered")
                return
            }

            factory.customUrl = null
            val provider = DohProvider.values().find {
                it.name.equals(providerName, ignoreCase = true)
            }
            if (provider != null) {
                factory.currentProvider = provider
                flushConnections()
                promise.resolve(provider.displayName)
            } else {
                promise.reject("DOH_ERROR", "Unknown provider: $providerName")
            }
        } catch (e: Exception) {
            promise.reject("DOH_ERROR", e.message, e)
        }
    }

    @ReactMethod
    fun setCustomUrl(url: String, promise: Promise) {
        try {
            val factory = getFactory()
            if (factory == null) {
                promise.reject("DOH_ERROR", "DohOkHttpFactory not registered")
                return
            }

            factory.customUrl = url
            flushConnections()
            promise.resolve(url)
        } catch (e: Exception) {
            promise.reject("DOH_ERROR", e.message, e)
        }
    }

    @ReactMethod
    fun getProviders(promise: Promise) {
        try {
            val providers = DohProvider.values().map { it.name.lowercase() }
            promise.resolve(com.facebook.react.bridge.Arguments.fromList(providers))
        } catch (e: Exception) {
            promise.reject("DOH_ERROR", e.message, e)
        }
    }
}

class DohPackage : ReactPackage {
    override fun createNativeModules(reactContext: ReactApplicationContext): List<NativeModule> {
        return listOf(DohModule(reactContext))
    }

    override fun createViewManagers(reactContext: ReactApplicationContext): List<ViewManager<*, *>> {
        return emptyList()
    }
}
