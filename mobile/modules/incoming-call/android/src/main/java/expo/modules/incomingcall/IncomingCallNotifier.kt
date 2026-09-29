package expo.modules.incomingcall

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.media.AudioAttributes
import android.net.Uri
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.app.Person

/**
 * Native incoming-call notification: Android CallStyle (system Answer /
 * Decline buttons), a full-screen intent that opens [IncomingCallActivity]
 * over the lock screen, and a ringtone at RING volume that stops by itself
 * when the caller's ring window expires.
 */
object IncomingCallNotifier {
  // Bump to change sound/vibration: Android freezes channel settings.
  private const val CHANNEL_RING = "incoming_call_ring_v1"
  private const val CHANNEL_QUIET = "incoming_call_quiet_v1"
  private const val TAG = "meetbook_incoming_call"

  const val EXTRA_ACTION = "meetbook_call_action"
  const val EXTRA_CALL_ID = "meetbook_call_id"
  const val ACTION_ANSWER = "answer"
  const val ACTION_DECLINE = "expo.modules.incomingcall.DECLINE"

  private fun notificationId(callId: String) = callId.hashCode()

  private fun ensureChannels(context: Context) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val nm = context.getSystemService(NotificationManager::class.java) ?: return
    if (nm.getNotificationChannel(CHANNEL_RING) == null) {
      val ring = NotificationChannel(CHANNEL_RING, "Gelen aramalar", NotificationManager.IMPORTANCE_HIGH).apply {
        description = "MeetBook sesli ve görüntülü aramaları"
        lockscreenVisibility = Notification.VISIBILITY_PUBLIC
        enableVibration(true)
        vibrationPattern = longArrayOf(0, 800, 400, 800)
        setSound(
          ringtoneUri(context),
          AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE)
            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
            .build(),
        )
      }
      nm.createNotificationChannel(ring)
    }
    if (nm.getNotificationChannel(CHANNEL_QUIET) == null) {
      val quiet = NotificationChannel(
        CHANNEL_QUIET,
        "Gelen aramalar (uygulama açık)",
        NotificationManager.IMPORTANCE_HIGH,
      ).apply {
        lockscreenVisibility = Notification.VISIBILITY_PUBLIC
        enableVibration(false)
        setSound(null, null)
      }
      nm.createNotificationChannel(quiet)
    }
  }

  private fun ringtoneUri(context: Context): Uri {
    val res = context.resources.getIdentifier("meetbook_ringtone", "raw", context.packageName)
    return if (res != 0) {
      Uri.parse("android.resource://${context.packageName}/$res")
    } else {
      android.provider.Settings.System.DEFAULT_RINGTONE_URI
    }
  }

  /** Opens the lock-screen call screen; [answer] = Cevapla was tapped. */
  private fun callScreenIntent(context: Context, call: CallInfo, answer: Boolean): PendingIntent {
    val intent = Intent(context, IncomingCallActivity::class.java).apply {
      addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
      putExtra(EXTRA_CALL_ID, call.callId)
      if (answer) putExtra(EXTRA_ACTION, ACTION_ANSWER)
    }
    // Distinct request codes, or Android merges the Answer/open intents.
    val code = notificationId(call.callId) + if (answer) 1 else 2
    return PendingIntent.getActivity(
      context, code, intent,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )
  }

  private fun declineIntent(context: Context, call: CallInfo): PendingIntent {
    val intent = Intent(context, DeclineReceiver::class.java).apply {
      action = ACTION_DECLINE
      putExtra(EXTRA_CALL_ID, call.callId)
    }
    return PendingIntent.getBroadcast(
      context, notificationId(call.callId) + 3, intent,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )
  }

  fun show(context: Context, call: CallInfo, quiet: Boolean) {
    val remaining = call.expiresAt - System.currentTimeMillis()
    if (remaining <= 0) return
    ensureChannels(context)
    IncomingCallStore.setActive(context, call)
    android.util.Log.i("IncomingCall", "show call=${call.callId} quiet=$quiet")

    val caller = Person.Builder()
      .setName(call.callerName.ifBlank { "MeetBook" })
      .setImportant(true)
      .build()
    val open = callScreenIntent(context, call, answer = false)
    val label = if (call.kind == "video") "Görüntülü arama" else "Sesli arama"

    val notification = NotificationCompat.Builder(context, if (quiet) CHANNEL_QUIET else CHANNEL_RING)
      .setSmallIcon(context.applicationInfo.icon)
      .setContentTitle(call.callerName.ifBlank { "MeetBook" })
      .setContentText("$label · MeetBook")
      .setCategory(NotificationCompat.CATEGORY_CALL)
      .setPriority(NotificationCompat.PRIORITY_MAX)
      .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
      .setOngoing(true)
      .setAutoCancel(false)
      .setContentIntent(open)
      .setFullScreenIntent(open, true)
      // Stop ringing exactly when the caller's ring window ends — no waiting
      // for the cancel push to arrive.
      .setTimeoutAfter(remaining)
      .setStyle(
        NotificationCompat.CallStyle.forIncomingCall(
          caller,
          declineIntent(context, call),
          callScreenIntent(context, call, answer = true),
        ),
      )
      .build()
    if (!quiet) notification.flags = notification.flags or Notification.FLAG_INSISTENT
    try {
      NotificationManagerCompat.from(context).notify(TAG, notificationId(call.callId), notification)
    } catch (_: SecurityException) {
      // POST_NOTIFICATIONS revoked — nothing we can show.
    }
  }

  /** Silence the ringing notification but keep the call info for JS
   * (the user answered and the app is taking over). */
  fun stopRinging(context: Context, callId: String) {
    NotificationManagerCompat.from(context).cancel(TAG, notificationId(callId))
  }

  /** Call over (declined, cancelled, answered in-app, ended): silence it,
   * forget it and close the lock-screen call screen. */
  fun cancel(context: Context, callId: String?) {
    val id = callId ?: IncomingCallStore.getActive(context)?.callId ?: return
    NotificationManagerCompat.from(context).cancel(TAG, notificationId(id))
    IncomingCallStore.clearActive(context, id)
    IncomingCallActivity.finishFor(id)
  }
}
