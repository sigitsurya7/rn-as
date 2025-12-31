package expo.modules.foregroundservice

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import com.koalacreative.koalabot.R

class ForegroundBotService : Service() {
  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    val title = intent?.getStringExtra(EXTRA_TITLE) ?: "Koala sedang bekerja"
    val body = intent?.getStringExtra(EXTRA_BODY) ?: "Bot berjalan di latar belakang."

    createChannel()

    val notification = NotificationCompat.Builder(this, CHANNEL_ID)
      .setContentTitle(title)
      .setContentText(body)
      .setSmallIcon(R.mipmap.ic_launcher)
      .setOngoing(true)
      .setCategory(NotificationCompat.CATEGORY_SERVICE)
      .build()

    startForeground(NOTIFICATION_ID, notification)
    return START_STICKY
  }

  override fun onDestroy() {
    stopForeground(STOP_FOREGROUND_REMOVE)
    super.onDestroy()
  }

  private fun createChannel() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    val channel = NotificationChannel(
      CHANNEL_ID,
      "Koala Bot",
      NotificationManager.IMPORTANCE_HIGH
    )
    channel.description = "Notifikasi bot berjalan"
    channel.setShowBadge(false)
    manager.createNotificationChannel(channel)
  }

  companion object {
    private const val CHANNEL_ID = "koala_bot"
    private const val NOTIFICATION_ID = 9101
    private const val EXTRA_TITLE = "title"
    private const val EXTRA_BODY = "body"

    fun start(context: Context, title: String, body: String) {
      val intent = Intent(context, ForegroundBotService::class.java)
        .putExtra(EXTRA_TITLE, title)
        .putExtra(EXTRA_BODY, body)
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        context.startForegroundService(intent)
      } else {
        context.startService(intent)
      }
    }

    fun stop(context: Context) {
      val intent = Intent(context, ForegroundBotService::class.java)
      context.stopService(intent)
    }
  }
}
