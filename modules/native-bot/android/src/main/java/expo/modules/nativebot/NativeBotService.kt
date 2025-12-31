package expo.modules.nativebot

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import com.koalacreative.koalabot.R

class NativeBotService : Service() {
  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    when (intent?.action) {
      ACTION_START -> {
        val payload = intent.getStringExtra(EXTRA_PAYLOAD) ?: "{}"
        startForegroundNotification()
        BotEngine.start(applicationContext, payload)
      }
      ACTION_STOP -> {
        BotEngine.stop()
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
      }
      ACTION_UPDATE -> {
        val payload = intent.getStringExtra(EXTRA_PAYLOAD) ?: "{}"
        BotEngine.updateConfig(payload)
      }
    }
    return START_STICKY
  }

  private fun startForegroundNotification() {
    createChannel()
    val notification = NotificationCompat.Builder(this, CHANNEL_ID)
      .setContentTitle("Koala sedang bekerja")
      .setContentText("Bot berjalan di latar belakang.")
      .setSmallIcon(R.mipmap.ic_launcher)
      .setOngoing(true)
      .setCategory(NotificationCompat.CATEGORY_SERVICE)
      .build()
    startForeground(NOTIFICATION_ID, notification)
  }

  private fun createChannel() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    val channel = NotificationChannel(
      CHANNEL_ID,
      "Bot Service Channel",
      NotificationManager.IMPORTANCE_HIGH
    )
    channel.description = "Notifikasi bot berjalan"
    channel.setShowBadge(false)
    manager.createNotificationChannel(channel)
  }

  companion object {
    private const val CHANNEL_ID = "BotServiceChannel"
    private const val NOTIFICATION_ID = 9102
    private const val EXTRA_PAYLOAD = "payload"

    const val ACTION_START = "nativebot.START"
    const val ACTION_STOP = "nativebot.STOP"
    const val ACTION_UPDATE = "nativebot.UPDATE"

    fun start(context: Context, payload: String) {
      val intent = Intent(context, NativeBotService::class.java)
        .setAction(ACTION_START)
        .putExtra(EXTRA_PAYLOAD, payload)
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        context.startForegroundService(intent)
      } else {
        context.startService(intent)
      }
    }

    fun stop(context: Context) {
      val intent = Intent(context, NativeBotService::class.java).setAction(ACTION_STOP)
      context.startService(intent)
    }

    fun update(context: Context, payload: String) {
      val intent = Intent(context, NativeBotService::class.java)
        .setAction(ACTION_UPDATE)
        .putExtra(EXTRA_PAYLOAD, payload)
      context.startService(intent)
    }
  }
}
