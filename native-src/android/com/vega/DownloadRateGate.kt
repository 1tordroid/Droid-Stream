package com.vega

import kotlin.math.max
import kotlin.math.min

/**
 * Shared token window so several connections together stay under the limit.
 * A limit of 0 means unlimited. The stricter of the global and per-download
 * limits is used when both are set.
 */
internal object DownloadRateGate {
    @Volatile var globalBytesPerSecond: Int = 0
    private val lock = Object()
    private var nextAtMs = 0L

    fun await(bytes: Int, downloadBytesPerSecond: Int) {
        val limit = when {
            globalBytesPerSecond <= 0 && downloadBytesPerSecond <= 0 -> return
            globalBytesPerSecond <= 0 -> downloadBytesPerSecond
            downloadBytesPerSecond <= 0 -> globalBytesPerSecond
            else -> min(globalBytesPerSecond, downloadBytesPerSecond)
        }
        if (limit <= 0 || bytes <= 0) return
        val slice = max(1L, bytes * 1000L / limit)
        val wait = synchronized(lock) {
            val now = System.currentTimeMillis()
            val start = max(now, nextAtMs)
            nextAtMs = start + slice
            start - now
        }
        if (wait > 0) Thread.sleep(wait.coerceAtMost(2_000L))
    }
}
