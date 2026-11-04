package com.vega

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat

/**
 * Keeps the process up while a download is moving bytes. Pause, resume, and
 * cancel arrive as broadcasts and are applied to the in-memory jobs. After a
 * reboot the saved byte ranges are still on disk; opening the app continues them.
 */
class DownloadForegroundService : Service() {
    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val notification = DownloadNotifier.notification(this, intent?.getStringExtra(EXTRA_TEXT))
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
        } else {
            startForeground(NOTIFICATION_ID, notification)
        }
        return START_STICKY
    }

    override fun onBind(intent: Intent?) = null

    companion object {
        const val NOTIFICATION_ID = 71
        const val EXTRA_TEXT = "text"
        const val ACTION = "droidstream.DOWNLOAD"

        fun start(context: Context, text: String) {
            val intent = Intent(context, DownloadForegroundService::class.java).putExtra(EXTRA_TEXT, text)
            ContextCompat.startForegroundService(context, intent)
        }

        fun stop(context: Context) {
            context.stopService(Intent(context, DownloadForegroundService::class.java))
        }
    }
}

internal object DownloadNotifier {
    private var lastText = "Downloading"
    private var lastAt = 0L

    fun update(context: Context, text: String) {
        val now = System.currentTimeMillis()
        if (text == lastText && now - lastAt < 1000L) return
        lastText = text
        lastAt = now
        DownloadForegroundService.start(context, text)
        val manager = context.getSystemService(NotificationManager::class.java)
        manager.notify(DownloadForegroundService.NOTIFICATION_ID, notification(context, text))
    }

    fun notification(context: Context, text: String?): Notification {
        ensureChannel(context)
        val body = text?.ifBlank { null } ?: lastText
        return NotificationCompat.Builder(context, CHANNEL)
            .setSmallIcon(android.R.drawable.stat_sys_download)
            .setContentTitle("Droid Stream downloads")
            .setContentText(body)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .addAction(0, "Pause", action(context, "pause"))
            .addAction(0, "Resume", action(context, "resume"))
            .addAction(0, "Cancel", action(context, "cancel"))
            .build()
    }

    private fun action(context: Context, name: String): PendingIntent {
        val intent = Intent(context, DownloadActionReceiver::class.java)
            .setAction(DownloadForegroundService.ACTION)
            .putExtra("downloadAction", name)
        val flags = PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        return PendingIntent.getBroadcast(context, name.hashCode(), intent, flags)
    }

    private fun ensureChannel(context: Context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val manager = context.getSystemService(NotificationManager::class.java)
        if (manager.getNotificationChannel(CHANNEL) != null) return
        manager.createNotificationChannel(
            NotificationChannel(CHANNEL, "Downloads", NotificationManager.IMPORTANCE_LOW),
        )
    }

    private const val CHANNEL = "droidstream-downloads"
}

class DownloadActionReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != DownloadForegroundService.ACTION) return
        HttpDownloadModule.controlAll(intent.getStringExtra("downloadAction") ?: return)
    }
}

class DownloadBootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Intent.ACTION_BOOT_COMPLETED) return
        val prefs = context.getSharedPreferences("vega_http_downloads", Context.MODE_PRIVATE)
        val pending = prefs.all.keys.any { key ->
            key.endsWith(":remaining") && !prefs.getString(key, "").isNullOrEmpty()
        }
        if (pending) {
            DownloadForegroundService.start(context, "Open Droid Stream to resume downloads")
        }
    }
}
