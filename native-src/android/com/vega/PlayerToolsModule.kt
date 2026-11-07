package com.vega

import android.net.Uri
import com.arthenica.ffmpegkit.FFmpegKit
import com.arthenica.ffmpegkit.FFmpegKitConfig
import com.arthenica.ffmpegkit.FFmpegSession
import com.arthenica.ffmpegkit.FFprobeSession
import com.arthenica.ffmpegkit.ReturnCode
import com.facebook.react.ReactPackage
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.uimanager.ViewManager
import org.json.JSONObject
import java.io.File
import java.io.IOException
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.concurrent.Executors
import kotlin.math.log10
import kotlin.math.sqrt

/**
 * Helpers for the built-in player that read the media outside Media3:
 * chapters (FFprobe), embedded text subtitles (the Matroska Cue index or a
 * local extract), and speech levels of a short audio slice for subtitle
 * auto sync (FFmpeg decodes it to 8 kHz mono). Each runs on its own thread.
 */
class PlayerToolsModule(private val reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {
    companion object {
        private const val TAG = "PlayerTools"
        private val chapterExecutor = Executors.newSingleThreadExecutor { work -> Thread(work, "player-chapters").apply { isDaemon = true } }
        private val subtitleExecutor = Executors.newSingleThreadExecutor { work -> Thread(work, "player-subtitles").apply { isDaemon = true } }
        private val speechExecutor = Executors.newSingleThreadExecutor { work -> Thread(work, "player-speech").apply { isDaemon = true } }
        private const val SAMPLE_RATE = 8000
        private const val FRAME_SAMPLES = SAMPLE_RATE / 100
        private const val MAX_SLICE_SECONDS = 600.0
        /** HTTP reads give up after this long without data (FFmpeg takes microseconds). */
        private const val NETWORK_TIMEOUT_US = "15000000"
        @Volatile private var speechSessionId = -1L
    }

    override fun getName(): String = "PlayerToolsModule"

    private fun headersOf(map: ReadableMap?): Map<String, String> {
        val result = LinkedHashMap<String, String>()
        val iterator = map?.keySetIterator() ?: return result
        while (iterator.hasNextKey()) {
            val key = iterator.nextKey()
            map.getString(key)?.let { if (key.isNotBlank() && !key.contains('\n') && !it.contains('\n')) result[key] = it }
        }
        return result
    }

    private fun isLocal(source: String) =
        source.startsWith("/") || source.startsWith("file://") || source.startsWith("content://")

    /** FFmpeg input options and the input for [source]: a path, a SAF handle or an HTTP address with its headers. */
    private fun inputArgs(source: String, headers: Map<String, String>): List<String> {
        if (source.startsWith("content://")) {
            val saf = FFmpegKitConfig.getSafParameterForRead(reactContext, Uri.parse(source))
                ?: throw IOException("This file cannot be opened")
            return listOf("-i", saf)
        }
        if (source.startsWith("file://")) return listOf("-i", Uri.parse(source).path ?: source.removePrefix("file://"))
        if (source.startsWith("/")) return listOf("-i", source)
        if (!source.startsWith("http://") && !source.startsWith("https://")) throw IOException("Unsupported address")
        val args = mutableListOf("-rw_timeout", NETWORK_TIMEOUT_US)
        val agent = headers.entries.firstOrNull { it.key.equals("User-Agent", ignoreCase = true) }?.value
        if (agent != null) args.addAll(listOf("-user_agent", agent))
        val others = headers.filterKeys { !it.equals("User-Agent", ignoreCase = true) }
        if (others.isNotEmpty()) args.addAll(listOf("-headers", others.entries.joinToString("") { "${it.key}: ${it.value}\r\n" }))
        args.addAll(listOf("-i", source))
        return args
    }

    /**
     * Chapters in the file as {start, end, title} with times in seconds.
     * Media3 does not expose container chapters, so FFprobe reads them: for
     * Matroska from the Chapters element, for MP4 from Nero chpl boxes or a
     * QuickTime chapter track. Only the header is read.
     */
    @ReactMethod
    fun readChapters(source: String, headers: ReadableMap?, promise: Promise) {
        chapterExecutor.execute {
            try {
                val args = mutableListOf(
                    "-v", "error", "-hide_banner",
                    "-probesize", "5000000", "-analyzeduration", "1000000",
                    "-print_format", "json", "-show_chapters"
                )
                args.addAll(inputArgs(source, headersOf(headers)))
                val session = FFprobeSession.create(args.toTypedArray())
                FFmpegKitConfig.ffprobeExecute(session)
                val output = session.output.orEmpty()
                val start = output.indexOf('{')
                val end = output.lastIndexOf('}')
                val result = Arguments.createArray()
                if (start >= 0 && end > start) {
                    val chapters = JSONObject(output.substring(start, end + 1)).optJSONArray("chapters")
                    if (chapters != null) {
                        for (index in 0 until chapters.length()) {
                            val chapter = chapters.optJSONObject(index) ?: continue
                            val chapterStart = chapter.optString("start_time").toDoubleOrNull() ?: continue
                            val chapterEnd = chapter.optString("end_time").toDoubleOrNull() ?: -1.0
                            val title = chapter.optJSONObject("tags")?.let { tags ->
                                tags.optString("title").ifBlank { tags.optString("TITLE") }
                            }.orEmpty()
                            result.pushMap(Arguments.createMap().apply {
                                putDouble("start", chapterStart)
                                putDouble("end", chapterEnd)
                                putString("title", title)
                            })
                        }
                    }
                }
                VegaLog.i(TAG, "Chapters read: ${result.size()}")
                promise.resolve(result)
            } catch (error: Exception) {
                promise.reject("CHAPTERS_FAILED", error.message ?: error.toString(), error)
            }
        }
    }

    /**
     * Lines of the [ordinal]-th subtitle track inside the file, times in ms.
     * A remote Matroska file is read through its Cue index only; without one
     * this fails rather than download the whole video.
     */
    @ReactMethod
    fun readEmbeddedSubtitle(source: String, headers: ReadableMap?, ordinal: Int, promise: Promise) {
        subtitleExecutor.execute {
            try {
                val lines = EmbeddedSubtitleVtt.loadLines(reactContext, source, isLocal(source), headersOf(headers), ordinal)
                val result = Arguments.createArray()
                lines.forEachIndexed { index, line ->
                    val next = lines.getOrNull(index + 1)?.startUs ?: Long.MAX_VALUE
                    val endUs = (line.endUs ?: minOf(next, line.startUs + 4_000_000L)).coerceAtLeast(line.startUs + 1_000L)
                    result.pushMap(Arguments.createMap().apply {
                        putDouble("start", line.startUs / 1000.0)
                        putDouble("end", endUs / 1000.0)
                        putString("text", line.text)
                    })
                }
                promise.resolve(result)
            } catch (error: Exception) {
                promise.reject("SUBTITLE_READ_FAILED", error.message ?: error.toString(), error)
            }
        }
    }

    /**
     * Speech-band level of each 10 ms frame (dB, rounded) for [durationSeconds]
     * of the first audio track from [startSeconds]. A new call stops the one
     * before. Over HTTP only that part of the video is fetched.
     */
    @ReactMethod
    fun readSpeechLevels(source: String, headers: ReadableMap?, startSeconds: Double, durationSeconds: Double, promise: Promise) {
        cancelSpeechLevels()
        speechExecutor.execute {
            val output = File(reactContext.cacheDir, "speech-levels.pcm")
            try {
                output.delete()
                val duration = durationSeconds.coerceIn(10.0, MAX_SLICE_SECONDS)
                val args = mutableListOf("-hide_banner", "-loglevel", "error", "-y", "-ss", "%.3f".format(java.util.Locale.US, startSeconds.coerceAtLeast(0.0)))
                args.addAll(inputArgs(source, headersOf(headers)))
                args.addAll(listOf(
                    "-t", "%.3f".format(java.util.Locale.US, duration),
                    "-map", "0:a:0", "-vn", "-sn", "-dn",
                    "-af", "highpass=f=250,lowpass=f=3200",
                    "-ac", "1", "-ar", SAMPLE_RATE.toString(),
                    "-f", "s16le", "-acodec", "pcm_s16le", output.absolutePath
                ))
                val session = FFmpegSession.create(args.toTypedArray())
                speechSessionId = session.sessionId
                FFmpegKitConfig.ffmpegExecute(session)
                if (speechSessionId != session.sessionId) throw IOException("Stopped")
                speechSessionId = -1L
                if (ReturnCode.isCancel(session.returnCode)) throw IOException("Stopped")
                if (!ReturnCode.isSuccess(session.returnCode) || !output.isFile || output.length() < FRAME_SAMPLES * 2L * 100) {
                    throw IOException("Could not read the audio: ${session.allLogsAsString?.takeLast(300)?.trim().orEmpty()}")
                }
                val bytes = output.readBytes()
                val samples = ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN).asShortBuffer()
                val frames = samples.remaining() / FRAME_SAMPLES
                val result = Arguments.createArray()
                for (frame in 0 until frames) {
                    var sum = 0.0
                    for (i in 0 until FRAME_SAMPLES) {
                        val value = samples.get(frame * FRAME_SAMPLES + i) / 32768.0
                        sum += value * value
                    }
                    val rms = sqrt(sum / FRAME_SAMPLES)
                    result.pushInt((20 * log10(rms + 1e-6)).toInt())
                }
                VegaLog.i(TAG, "Speech levels: $frames frames")
                promise.resolve(result)
            } catch (error: Exception) {
                promise.reject("SPEECH_LEVELS_FAILED", error.message ?: error.toString(), error)
            } finally {
                output.delete()
            }
        }
    }

    @ReactMethod
    fun cancelSpeechLevels() {
        val id = speechSessionId
        speechSessionId = -1L
        if (id >= 0) FFmpegKit.cancel(id)
    }
}

class PlayerToolsPackage : ReactPackage {
    override fun createNativeModules(context: ReactApplicationContext): List<NativeModule> = listOf(PlayerToolsModule(context))
    override fun createViewManagers(context: ReactApplicationContext): List<ViewManager<*, *>> = emptyList()
}
