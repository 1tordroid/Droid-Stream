package com.vega

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log
import androidx.tvprovider.media.tv.TvContractCompat

/**
 * Broadcasts from the TV home screen about Play Next.
 *
 * - The user removed one of the app's programs: it is remembered and
 *   deleted, and stays away until the title is watched again.
 * - A preview program was added to Play Next: the app publishes no preview
 *   channels, so such a program is not one of its own and is left as is.
 */
class WatchNextReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        when (intent.action) {
            TvContractCompat.ACTION_WATCH_NEXT_PROGRAM_BROWSABLE_DISABLED -> {
                val programId = intent.getLongExtra(TvContractCompat.EXTRA_WATCH_NEXT_PROGRAM_ID, -1L)
                if (programId < 0) return
                val pending = goAsync()
                val app = context.applicationContext
                Thread {
                    try {
                        TvHomeModule.onProgramRemovedByUser(app, programId)
                    } finally {
                        pending.finish()
                    }
                }.start()
            }
            TvContractCompat.ACTION_PREVIEW_PROGRAM_ADDED_TO_WATCH_NEXT -> {
                val programId = intent.getLongExtra(TvContractCompat.EXTRA_WATCH_NEXT_PROGRAM_ID, -1L)
                Log.i("VegaTvHome", "Preview program added to Play Next: $programId")
            }
        }
    }
}
