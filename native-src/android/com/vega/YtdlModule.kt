package com.vega

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.modules.core.DeviceEventManagerModule
import com.facebook.react.uimanager.ViewManager
import java.io.File
import java.util.concurrent.Executors

/**
 * yt-dlp for JavaScript: info lookups, downloads with progress events, the
 * in-app update, and the cookie file from the sign-in browser. Calls run on
 * background threads; Python releases its lock while it waits on the network.
 */
class YtdlModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    private val executor = Executors.newCachedThreadPool()

    override fun getName() = "YtdlModule"

    private fun background(promise: Promise, code: String, block: () -> Any?) {
        executor.execute {
            try {
                promise.resolve(block())
            } catch (error: Throwable) {
                promise.reject(code, error.message ?: error.javaClass.simpleName, error)
            }
        }
    }

    private fun cookiePath(): String? =
        YtdlRuntime.cookieFile(reactContext).takeIf { it.exists() }?.absolutePath

    @ReactMethod
    fun status(promise: Promise) = background(promise, "YTDL_STATUS") {
        YtdlRuntime.status(reactContext).toString()
    }

    @ReactMethod
    fun extract(url: String, promise: Promise) = background(promise, "YTDL_EXTRACT") {
        val module = YtdlRuntime.module(reactContext)
        YtdlRuntime.beginJob()
        try {
            module.callAttr("extract", url, cookiePath()).toString()
        } finally {
            YtdlRuntime.endJob()
        }
    }

    @ReactMethod
    fun download(jobId: String, url: String, argsJson: String, workDir: String, promise: Promise) =
        background(promise, "YTDL_DOWNLOAD") {
            val module = YtdlRuntime.module(reactContext)
            File(workDir).mkdirs()
            YtdlRuntime.beginJob()
            try {
                module.callAttr("download", jobId, url, argsJson, workDir, cookiePath(), Listener()).toString()
            } finally {
                YtdlRuntime.endJob()
            }
        }

    @ReactMethod
    fun cancel(jobId: String, promise: Promise) = background(promise, "YTDL_CANCEL") {
        YtdlRuntime.module(reactContext).callAttr("cancel", jobId)
        YtdlRuntime.cancelFfmpeg(jobId)
        null
    }

    @ReactMethod
    fun latestVersion(promise: Promise) = background(promise, "YTDL_LATEST") { YtdlRuntime.latestVersion() }

    @ReactMethod
    fun update(promise: Promise) = background(promise, "YTDL_UPDATE") {
        YtdlRuntime.update(reactContext).toString()
    }

    @ReactMethod
    fun resetToBundled(promise: Promise) = background(promise, "YTDL_RESET") {
        YtdlRuntime.resetToBundled(reactContext).toString()
    }

    @ReactMethod
    fun saveCookies(siteUrl: String, promise: Promise) = background(promise, "YTDL_COOKIES") {
        YtdlRuntime.saveCookies(reactContext, siteUrl)
    }

    @ReactMethod
    fun clearCookies(siteUrl: String?, promise: Promise) = background(promise, "YTDL_COOKIES") {
        YtdlRuntime.clearCookies(reactContext, siteUrl)
        null
    }

    @ReactMethod
    fun cookieSites(promise: Promise) = background(promise, "YTDL_COOKIES") {
        YtdlRuntime.cookieSites(reactContext).toString()
    }

    @ReactMethod fun addListener(eventName: String) = Unit
    @ReactMethod fun removeListeners(count: Double) = Unit

    /** Progress and post-processing events from Python. */
    inner class Listener {
        fun onEvent(jobId: String, json: String) {
            if (!reactContext.hasActiveReactInstance()) return
            reactContext
                .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
                .emit(EVENT, Arguments.createMap().apply {
                    putString("jobId", jobId)
                    putString("event", json)
                })
        }
    }

    companion object {
        const val EVENT = "YtdlEvent"
    }
}

class YtdlPackage : ReactPackage {
    override fun createNativeModules(reactContext: ReactApplicationContext): List<NativeModule> =
        listOf(YtdlModule(reactContext))

    override fun createViewManagers(reactContext: ReactApplicationContext): List<ViewManager<*, *>> =
        emptyList()
}
