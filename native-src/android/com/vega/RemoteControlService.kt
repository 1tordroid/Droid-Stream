package com.vega

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import androidx.core.app.NotificationCompat

/**
 * Keeps the app running while remote control is on, with a notification that
 * says so and turns it off. The server itself is in [RemoteAccess].
 */
class RemoteControlService : Service() {
    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_STOP) {
            RemoteAccess.stop(this, fromNotification = true)
            stopSelf()
            return START_NOT_STICKY
        }
        val notification = notification(this)
        // Called even when stopping at once: a service started with
        // startForegroundService must call startForeground before it stops.
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE)
            } else {
                startForeground(NOTIFICATION_ID, notification)
            }
        } catch (error: Exception) {
            // Without the notification the server must not run.
            VegaLog.w("RemoteControlService", "Could not start in the foreground: ${error.message}")
            RemoteAccess.stop(this, fromNotification = false, error = "Could not show the notification remote control needs. Open Droid Stream and try again.")
            stopSelf()
            return START_NOT_STICKY
        }
        if (!RemoteAccess.isWanted()) {
            stopForeground(STOP_FOREGROUND_REMOVE)
            stopSelf()
            return START_NOT_STICKY
        }
        // The server is started by the app; after the process is restarted it is off until the app starts it.
        return START_NOT_STICKY
    }

    override fun onBind(intent: Intent?) = null

    companion object {
        private const val NOTIFICATION_ID = 74
        private const val CHANNEL = "droidstream-remote-control"
        private const val ACTION_STOP = "droidstream.REMOTE_CONTROL_STOP"

        /** Updates the address in the notification. */
        fun refresh(context: Context) {
            if (!RemoteAccess.isWanted()) return
            val manager = context.getSystemService(NotificationManager::class.java)
            runCatching { manager.notify(NOTIFICATION_ID, notification(context)) }
        }

        private fun notification(context: Context): Notification {
            ensureChannel(context)
            val stop = PendingIntent.getService(
                context,
                1,
                Intent(context, RemoteControlService::class.java).setAction(ACTION_STOP),
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
            )
            val open = context.packageManager.getLaunchIntentForPackage(context.packageName)?.let {
                PendingIntent.getActivity(context, 2, it, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
            }
            return NotificationCompat.Builder(context, CHANNEL)
                .setSmallIcon(android.R.drawable.stat_sys_download)
                .setContentTitle("Remote control on")
                .setContentText(RemoteAccess.notificationText())
                .setOngoing(true)
                .setOnlyAlertOnce(true)
                .setContentIntent(open)
                .addAction(0, "Turn off", stop)
                .build()
        }

        private fun ensureChannel(context: Context) {
            val manager = context.getSystemService(NotificationManager::class.java)
            if (manager.getNotificationChannel(CHANNEL) != null) return
            manager.createNotificationChannel(NotificationChannel(CHANNEL, "Remote control", NotificationManager.IMPORTANCE_LOW))
        }
    }
}
