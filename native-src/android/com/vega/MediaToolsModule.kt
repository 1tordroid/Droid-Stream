package com.vega

import com.arthenica.ffmpegkit.FFmpegKit
import com.arthenica.ffmpegkit.ReturnCode
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableArray
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.io.IOException
import java.util.concurrent.Executors

/**
 * File work for DASH downloads and live recordings: joins downloaded segments
 * into one track, and remuxes tracks or a local HLS playlist into a single
 * file with FFmpeg, without re-encoding.
 */
class MediaToolsModule(reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {
    companion object {
        private val executor = Executors.newSingleThreadExecutor()
    }

    override fun getName(): String = "MediaToolsModule"

    /** Appends [parts] in order into [outputPath]. Resolves with the size in bytes. */
    @ReactMethod
    fun concatFiles(parts: ReadableArray, outputPath: String, deleteParts: Boolean, promise: Promise) {
        executor.execute {
            val output = File(outputPath)
            val partial = File("$outputPath.join")
            try {
                partial.delete()
                FileOutputStream(partial).channel.use { target ->
                    for (index in 0 until parts.size()) {
                        val path = parts.getString(index) ?: throw IOException("Missing part")
                        val file = File(path)
                        if (!file.isFile) throw IOException("A downloaded part is missing")
                        FileInputStream(file).channel.use { source ->
                            var position = 0L
                            val size = source.size()
                            while (position < size) {
                                val moved = source.transferTo(position, size - position, target)
                                if (moved <= 0L) throw IOException("Could not join the downloaded parts")
                                position += moved
                            }
                        }
                    }
                    target.force(false)
                }
                output.delete()
                if (!partial.renameTo(output)) throw IOException("Could not save $outputPath")
                if (deleteParts) {
                    for (index in 0 until parts.size()) parts.getString(index)?.let { File(it).delete() }
                }
                promise.resolve(output.length().toDouble())
            } catch (error: Exception) {
                partial.delete()
                promise.reject("CONCAT_FAILED", error.message ?: error.toString(), error)
            }
        }
    }

    /**
     * Joins a video track and an optional audio track into [format] ("mp4" or
     * "matroska"). Without audio, any audio inside the video is kept.
     */
    @ReactMethod
    fun muxTracks(videoPath: String?, audioPath: String?, outputPath: String, format: String, promise: Promise) {
        executor.execute {
            val output = File(outputPath)
            try {
                output.delete()
                val args = mutableListOf("-hide_banner", "-loglevel", "error", "-y")
                val inputs = listOfNotNull(videoPath, audioPath)
                require(inputs.isNotEmpty()) { "Nothing to save" }
                inputs.forEach { path ->
                    require(File(path).isFile) { "A downloaded track is missing" }
                    args.addAll(listOf("-i", path))
                }
                when {
                    videoPath != null && audioPath != null -> args.addAll(listOf("-map", "0:v:0", "-map", "1:a:0"))
                    videoPath != null -> args.addAll(listOf("-map", "0:v:0", "-map", "0:a?"))
                    else -> args.addAll(listOf("-map", "0:a:0"))
                }
                val muxer = if (format == "matroska") "matroska" else "mp4"
                args.addAll(listOf("-c", "copy"))
                if (muxer == "mp4") args.addAll(listOf("-movflags", "+faststart"))
                args.addAll(listOf("-f", muxer, outputPath))
                val session = FFmpegKit.executeWithArguments(args.toTypedArray())
                if (!ReturnCode.isSuccess(session.returnCode) || !output.isFile || output.length() == 0L) {
                    throw IOException("Could not join video and audio: ${session.allLogsAsString?.takeLast(400)?.trim().orEmpty()}")
                }
                promise.resolve(Arguments.createMap().apply { putDouble("size", output.length().toDouble()) })
            } catch (error: Exception) {
                output.delete()
                promise.reject("MUX_FAILED", error.message ?: error.toString(), error)
            }
        }
    }

    /**
     * Like HttpDownloadModule.finalizeHls, with the output format chosen:
     * "mp4" or "mpegts". The local playlist may name AES-128 key files, which
     * FFmpeg reads through its crypto protocol.
     */
    @ReactMethod
    fun finalizeHlsAs(videoPlaylistPath: String, audioPlaylistPath: String?, outputPath: String, format: String, promise: Promise) {
        executor.execute {
            val output = File(outputPath)
            try {
                output.delete()
                val args = mutableListOf("-hide_banner", "-loglevel", "error", "-y")
                fun input(path: String) {
                    require(File(path).isFile) { "Recorded playlist is missing" }
                    HlsSegmentSanitizer.unwrapPlaylist(File(path))
                    args.addAll(listOf("-protocol_whitelist", "file,crypto,data", "-allowed_extensions", "ALL", "-i", path))
                }
                input(videoPlaylistPath)
                if (audioPlaylistPath != null) input(audioPlaylistPath)
                args.addAll(listOf("-map", "0:v:0?", "-map", if (audioPlaylistPath != null) "1:a:0" else "0:a:0?", "-c", "copy"))
                if (format == "mpegts") {
                    args.addAll(listOf("-f", "mpegts", outputPath))
                } else {
                    args.addAll(listOf("-movflags", "+faststart", "-f", "mp4", outputPath))
                }
                val session = FFmpegKit.executeWithArguments(args.toTypedArray())
                if (!ReturnCode.isSuccess(session.returnCode) || !output.isFile || output.length() == 0L) {
                    throw IOException("Could not save the recording: ${session.allLogsAsString?.takeLast(400)?.trim().orEmpty()}")
                }
                promise.resolve(Arguments.createMap().apply { putDouble("size", output.length().toDouble()) })
            } catch (error: Exception) {
                output.delete()
                promise.reject("HLS_FINALIZE_FAILED", error.message ?: error.toString(), error)
            }
        }
    }
}
