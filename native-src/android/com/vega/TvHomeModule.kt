package com.vega

import android.app.UiModeManager
import android.content.ContentUris
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.res.Configuration
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import androidx.tvprovider.media.tv.TvContractCompat
import androidx.tvprovider.media.tv.WatchNextProgram
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableArray
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.modules.core.DeviceEventManagerModule
import java.util.concurrent.Executors

/**
 * Android TV home screen: the Play Next (Watch Next) row, through the TV
 * provider, and keeping the screen on only while a video plays.
 *
 * JS decides what the row holds (src/lib/tv/watchNext); this module only
 * lists, writes and removes the app's own programs. Every program carries an
 * internal id starting with [KEY_PREFIX], so programs of other apps or of the
 * system are never touched.
 */
class TvHomeModule(reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {
    companion object {
        private const val TAG = "VegaTvHome"
        const val KEY_PREFIX = "ds1."
        private const val LINK_PREFIX = "droidstream://watchnext?"
        private const val PREFS = "vega_watch_next"
        private const val PREF_DISMISSED = "dismissed"
        const val EVENT_DISMISSED = "VegaWatchNextDismissed"

        // TvContract values (public, fixed since API 26).
        private const val TYPE_MOVIE = 0
        private const val TYPE_TV_EPISODE = 3
        private const val ASPECT_RATIO_16_9 = 0
        private const val ASPECT_RATIO_2_3 = 4
        private const val WATCH_NEXT_TYPE_CONTINUE = 0
        private const val WATCH_NEXT_TYPE_NEXT = 1

        private const val COLUMN_ID = "_id"
        private const val COLUMN_INTERNAL_ID = "internal_provider_id"
        private const val COLUMN_BROWSABLE = "browsable"

        @Volatile
        private var instance: TvHomeModule? = null

        private val io = Executors.newSingleThreadExecutor()

        fun isTv(context: Context): Boolean {
            val uiMode = (context.getSystemService(Context.UI_MODE_SERVICE) as? UiModeManager)?.currentModeType
            return uiMode == Configuration.UI_MODE_TYPE_TELEVISION ||
                context.packageManager.hasSystemFeature(PackageManager.FEATURE_LEANBACK)
        }

        fun hasTvProvider(context: Context): Boolean = try {
            context.packageManager.resolveContentProvider(TvContractCompat.AUTHORITY, 0) != null
        } catch (_: Exception) {
            false
        }

        /** Own programs: internal id to row id and whether the launcher still shows it. */
        fun ownPrograms(context: Context): Map<String, Pair<Long, Boolean>> {
            val result = LinkedHashMap<String, Pair<Long, Boolean>>()
            context.contentResolver.query(
                TvContractCompat.WatchNextPrograms.CONTENT_URI,
                arrayOf(COLUMN_ID, COLUMN_INTERNAL_ID, COLUMN_BROWSABLE),
                null, null, null,
            )?.use { cursor ->
                val idIndex = cursor.getColumnIndex(COLUMN_ID)
                val keyIndex = cursor.getColumnIndex(COLUMN_INTERNAL_ID)
                val browsableIndex = cursor.getColumnIndex(COLUMN_BROWSABLE)
                while (cursor.moveToNext()) {
                    val key = if (keyIndex >= 0) cursor.getString(keyIndex) else null
                    if (key == null || !key.startsWith(KEY_PREFIX)) continue
                    val browsable = browsableIndex < 0 || cursor.isNull(browsableIndex) || cursor.getInt(browsableIndex) != 0
                    result[key] = Pair(cursor.getLong(idIndex), browsable)
                }
            }
            return result
        }

        /**
         * The user removed program [programId] from the TV home. Remembers it,
         * so it is not added back until the title is watched again, deletes
         * the row and tells JS when it runs.
         */
        fun onProgramRemovedByUser(context: Context, programId: Long) {
            try {
                val uri = TvContractCompat.buildWatchNextProgramUri(programId)
                var key: String? = null
                context.contentResolver.query(uri, arrayOf(COLUMN_INTERNAL_ID), null, null, null)?.use { cursor ->
                    if (cursor.moveToFirst()) key = cursor.getString(0)
                }
                val own = key ?: return
                if (!own.startsWith(KEY_PREFIX)) return
                val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                val entries = HashSet(prefs.getStringSet(PREF_DISMISSED, emptySet()) ?: emptySet())
                entries.removeAll { it.substringAfter('|') == own }
                entries.add("${System.currentTimeMillis()}|$own")
                prefs.edit().putStringSet(PREF_DISMISSED, entries).apply()
                context.contentResolver.delete(uri, null, null)
                instance?.emitDismissed()
            } catch (error: Exception) {
                Log.w(TAG, "Could not handle a removed Play Next program", error)
            }
        }
    }

    init {
        instance = this
    }

    private val mainHandler = Handler(Looper.getMainLooper())

    override fun getName() = "VegaTvHome"

    override fun invalidate() {
        if (instance === this) instance = null
        super.invalidate()
    }

    private fun emitDismissed() {
        val context = reactApplicationContext
        if (!context.hasActiveReactInstance()) return
        context.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java).emit(EVENT_DISMISSED, null)
    }

    @ReactMethod fun addListener(eventName: String) = Unit
    @ReactMethod fun removeListeners(count: Double) = Unit

    @ReactMethod(isBlockingSynchronousMethod = true)
    fun isWatchNextSupported(): Boolean = isTv(reactApplicationContext) && hasTvProvider(reactApplicationContext)

    @ReactMethod
    fun listWatchNext(promise: Promise) {
        io.execute {
            try {
                val list = Arguments.createArray()
                for ((key, row) in ownPrograms(reactApplicationContext)) {
                    list.pushMap(Arguments.createMap().apply {
                        putString("key", key)
                        putBoolean("browsable", row.second)
                    })
                }
                promise.resolve(list)
            } catch (error: Exception) {
                promise.reject("watch_next_list", error.message, error)
            }
        }
    }

    @ReactMethod
    fun applyWatchNext(upserts: ReadableArray, removes: ReadableArray, promise: Promise) {
        val wanted = (0 until upserts.size()).mapNotNull { upserts.getMap(it) }
        val removed = (0 until removes.size()).mapNotNull { removes.getString(it) }
        io.execute {
            val failed = Arguments.createArray()
            val resolver = reactApplicationContext.contentResolver
            val existing = try {
                ownPrograms(reactApplicationContext)
            } catch (error: Exception) {
                Log.w(TAG, "Could not read Play Next", error)
                promise.reject("watch_next_list", error.message, error)
                return@execute
            }
            for (key in removed) {
                if (!key.startsWith(KEY_PREFIX)) continue
                val row = existing[key] ?: continue
                try {
                    resolver.delete(TvContractCompat.buildWatchNextProgramUri(row.first), null, null)
                } catch (error: Exception) {
                    Log.w(TAG, "Could not remove a Play Next program", error)
                    failed.pushString(key)
                }
            }
            for (entry in wanted) {
                val key = entry.getString("key") ?: continue
                try {
                    val values = buildProgram(entry).toContentValues()
                    val row = existing[key]
                    if (row != null && row.second) {
                        resolver.update(TvContractCompat.buildWatchNextProgramUri(row.first), values, null, null)
                    } else {
                        // A row the user turned off cannot be shown again: replace it.
                        if (row != null) resolver.delete(TvContractCompat.buildWatchNextProgramUri(row.first), null, null)
                        val uri = resolver.insert(TvContractCompat.WatchNextPrograms.CONTENT_URI, values)
                        if (uri == null || ContentUris.parseId(uri) < 0) failed.pushString(key)
                    }
                } catch (error: Exception) {
                    Log.w(TAG, "Could not write a Play Next program", error)
                    failed.pushString(key)
                }
            }
            promise.resolve(Arguments.createMap().apply { putArray("failed", failed) })
        }
    }

    private fun buildProgram(entry: ReadableMap): WatchNextProgram {
        val key = entry.getString("key") ?: throw IllegalArgumentException("key")
        if (!key.startsWith(KEY_PREFIX)) throw IllegalArgumentException("key")
        val link = entry.getString("intentUri") ?: ""
        if (!link.startsWith(LINK_PREFIX)) throw IllegalArgumentException("intentUri")
        val episode = entry.getString("type") == "episode"
        val next = entry.getString("kind") == "next"
        val intent = Intent(Intent.ACTION_VIEW, Uri.parse(link)).setPackage(reactApplicationContext.packageName)
        val builder = WatchNextProgram.Builder()
            .setInternalProviderId(key)
            .setWatchNextType(if (next) WATCH_NEXT_TYPE_NEXT else WATCH_NEXT_TYPE_CONTINUE)
            .setType(if (episode) TYPE_TV_EPISODE else TYPE_MOVIE)
            .setTitle(entry.getString("title") ?: "")
            .setLastEngagementTimeUtcMillis(number(entry, "lastEngagementMs").toLong().coerceAtLeast(0L))
            .setIntent(intent)
        if (entry.hasKey("episodeTitle") && !entry.isNull("episodeTitle")) {
            builder.setEpisodeTitle(entry.getString("episodeTitle"))
        }
        val poster = if (entry.hasKey("posterUri") && !entry.isNull("posterUri")) entry.getString("posterUri") else null
        if (!poster.isNullOrEmpty()) {
            builder.setPosterArtUri(Uri.parse(poster))
            builder.setPosterArtAspectRatio(if (entry.getString("posterShape") == "poster") ASPECT_RATIO_2_3 else ASPECT_RATIO_16_9)
        }
        val duration = number(entry, "durationMs")
        val position = number(entry, "positionMs")
        if (!next && duration > 0) {
            builder.setDurationMillis(duration.coerceAtMost(Int.MAX_VALUE.toDouble()).toInt())
            builder.setLastPlaybackPositionMillis(position.coerceIn(0.0, duration).coerceAtMost(Int.MAX_VALUE.toDouble()).toInt())
        }
        return builder.build()
    }

    private fun number(entry: ReadableMap, name: String): Double =
        if (entry.hasKey(name) && !entry.isNull(name)) entry.getDouble(name).takeIf { it.isFinite() } ?: 0.0 else 0.0

    /** Programs the user removed from the TV home since the last call, with when. */
    @ReactMethod
    fun takeDismissedWatchNext(promise: Promise) {
        io.execute {
            try {
                val prefs = reactApplicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                val entries = prefs.getStringSet(PREF_DISMISSED, emptySet()) ?: emptySet()
                val list = Arguments.createArray()
                for (entry in entries) {
                    val at = entry.substringBefore('|').toLongOrNull() ?: continue
                    val key = entry.substringAfter('|', "")
                    if (!key.startsWith(KEY_PREFIX)) continue
                    list.pushMap(Arguments.createMap().apply {
                        putString("key", key)
                        putDouble("at", at.toDouble())
                    })
                }
                prefs.edit().remove(PREF_DISMISSED).apply()
                promise.resolve(list)
            } catch (error: Exception) {
                promise.reject("watch_next_dismissed", error.message, error)
            }
        }
    }

    /**
     * Keeps the screen on while [playing]. While paused it lets the screen
     * sleep, so the system screensaver can start: the window flag is cleared
     * and so is keepScreenOn on the views (the video view sets its own).
     */
    @ReactMethod
    fun setScreenOnWhilePlaying(playing: Boolean) {
        mainHandler.post { applyScreenOn(playing) }
        // The video view may set it again while it handles the pause.
        if (!playing) mainHandler.postDelayed({ applyScreenOn(false) }, 800)
    }

    private fun applyScreenOn(playing: Boolean) {
        val window = reactApplicationContext.currentActivity?.window ?: return
        if (playing) {
            window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        } else {
            window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
            clearKeepScreenOn(window.decorView, 0)
        }
    }

    private fun clearKeepScreenOn(view: View, depth: Int) {
        if (depth > 40) return
        if (view.keepScreenOn) view.keepScreenOn = false
        if (view is ViewGroup) {
            for (index in 0 until view.childCount) clearKeepScreenOn(view.getChildAt(index), depth + 1)
        }
    }
}
