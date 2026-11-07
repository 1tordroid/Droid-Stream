package com.vega

import android.app.Activity
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import java.security.MessageDigest

/**
 * Command access: broadcasts from Termux, ADB or Tasker, for example
 *   am broadcast -a com.tordroid.droidstream.ADD_DOWNLOAD -p <package> --es token <token> --es url <link>
 * Refused unless command access is on in Settings and the token matches.
 * The result code is -1 when the command worked and 1 when it did not; the
 * result data says what happened.
 */
class RemoteCommandReceiver : BroadcastReceiver() {
    companion object {
        const val PREFIX = "com.tordroid.droidstream."
        private val ACTIONS = setOf("ADD_DOWNLOAD", "PAUSE", "RESUME", "LIST")
        private val EXTRAS = listOf("url", "id", "name")
        private const val MAX_EXTRA = 8192
        private const val TIMEOUT_SECONDS = 8L

        // Wrong tokens: five in a minute lock commands for a minute, then twice as long each time.
        private val failures = ArrayDeque<Long>()
        private var lockedUntil = 0L
        private var lockouts = 0

        @Synchronized
        private fun locked(now: Long) = now < lockedUntil

        @Synchronized
        private fun recordFailure(now: Long) {
            while (failures.isNotEmpty() && now - failures.first() > 60_000L) failures.removeFirst()
            failures.addLast(now)
            if (failures.size >= 5) {
                lockedUntil = now + minOf(60_000L shl lockouts.coerceAtMost(4), 15 * 60_000L)
                lockouts += 1
                failures.clear()
            }
        }

        /** Same time for any wrong token: both sides are hashed before the comparison. */
        private fun sameToken(given: String, expected: String): Boolean {
            if (expected.isEmpty()) return false
            val digest = { text: String -> MessageDigest.getInstance("SHA-256").digest(text.toByteArray(Charsets.UTF_8)) }
            return MessageDigest.isEqual(digest(given), digest(expected))
        }
    }

    override fun onReceive(context: Context, intent: Intent) {
        val action = intent.action ?: return
        if (!action.startsWith(PREFIX) || action.removePrefix(PREFIX) !in ACTIONS) return
        val ordered = isOrderedBroadcast
        fun finish(ok: Boolean, text: String) {
            if (!ordered) return
            resultCode = if (ok) Activity.RESULT_OK else Activity.RESULT_FIRST_USER
            resultData = text
        }
        if (!RemoteAccess.commandsEnabled(context)) {
            return finish(false, "Command access is off. Turn it on in Settings > Advanced downloads.")
        }
        val now = System.currentTimeMillis()
        if (locked(now)) return finish(false, "Too many wrong tokens. Try again later.")
        val token = intent.getStringExtra("token") ?: ""
        if (!sameToken(token, RemoteAccess.commandToken(context))) {
            recordFailure(now)
            return finish(false, "Wrong or missing token.")
        }
        val extras = EXTRAS.mapNotNull { key ->
            intent.getStringExtra(key)?.takeIf { it.length <= MAX_EXTRA }?.let { key to it }
        }.toMap()
        if (RemoteAccess.module() == null) {
            if (action.endsWith("ADD_DOWNLOAD")) {
                return if (RemoteAccess.savePending(context, action, extras)) {
                    finish(true, "Saved. It is added when Droid Stream opens.")
                } else {
                    finish(false, "Too many saved commands. Open Droid Stream first.")
                }
            }
            return finish(false, "Droid Stream is not open. Open it and try again.")
        }
        val pending = goAsync()
        Thread {
            val (ok, text) = RemoteAccess.dispatchCommand(action, extras, TIMEOUT_SECONDS)
            if (ordered) {
                pending.resultCode = if (ok) Activity.RESULT_OK else Activity.RESULT_FIRST_USER
                pending.resultData = text
            }
            pending.finish()
        }.start()
    }
}
