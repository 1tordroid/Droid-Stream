package com.vega

import android.media.MediaMetadataRetriever
import com.arthenica.ffmpegkit.FFmpegKit
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.modules.core.DeviceEventManagerModule
import org.json.JSONArray
import java.io.File
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors

/**
 * Small media helpers for social downloads: makes a video from photos and a
 * song with FFmpegKit (the arguments are built in JavaScript), and reads the
 * length of a downloaded song.
 */
class SocialMediaModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    private val executor = Executors.newCachedThreadPool()
    private val sessions = ConcurrentHashMap<String, Long>()

    override fun getName() = "SocialMediaModule"

    /** Runs FFmpeg with the given arguments. Resolves with {code, log}. */
    @ReactMethod
    fun runFfmpeg(jobId: String, argsJson: String, promise: Promise) {
        executor.execute {
            try {
                val list = JSONArray(argsJson)
                val args = Array(list.length()) { list.getString(it) }
                val done = CountDownLatch(1)
                val session = FFmpegKit.executeWithArgumentsAsync(
                    args,
                    { done.countDown() },
                    null,
                    { statistics -> emitProgress(jobId, statistics.time.toDouble()) },
                )
                sessions[jobId] = session.sessionId
                try {
                    done.await()
                } finally {
                    sessions.remove(jobId)
                }
                val log = (session.getAllLogsAsString(5000) ?: "").takeLast(2000)
                promise.resolve(Arguments.createMap().apply {
                    putInt("code", session.returnCode?.value ?: 1)
                    putBoolean("cancelled", session.returnCode?.isValueCancel == true)
                    putString("log", log)
                })
            } catch (error: Throwable) {
                promise.reject("SOCIAL_FFMPEG", error.message ?: error.javaClass.simpleName, error)
            }
        }
    }

    @ReactMethod
    fun cancel(jobId: String) {
        sessions[jobId]?.let { FFmpegKit.cancel(it) }
    }

    /** Length of a local audio or video file in seconds, or 0 when unknown. */
    @ReactMethod
    fun mediaDuration(path: String, promise: Promise) {
        executor.execute {
            val retriever = MediaMetadataRetriever()
            try {
                if (!File(path).isFile) throw IllegalArgumentException("File is missing")
                retriever.setDataSource(path)
                val ms = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)?.toLongOrNull() ?: 0L
                promise.resolve(ms / 1000.0)
            } catch (_: Throwable) {
                promise.resolve(0.0)
            } finally {
                try {
                    retriever.release()
                } catch (_: Throwable) {
                }
            }
        }
    }

    private fun emitProgress(jobId: String, timeMs: Double) {
        if (!reactContext.hasActiveReactInstance()) return
        reactContext
            .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
            .emit(EVENT, Arguments.createMap().apply {
                putString("jobId", jobId)
                putDouble("timeMs", timeMs)
            })
    }

    @ReactMethod fun addListener(eventName: String) = Unit
    @ReactMethod fun removeListeners(count: Double) = Unit

    companion object {
        const val EVENT = "SocialMediaProgress"
    }
}
