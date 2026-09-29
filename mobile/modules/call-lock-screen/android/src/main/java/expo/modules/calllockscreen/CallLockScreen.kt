package expo.modules.calllockscreen

import android.app.Activity
import android.content.Context
import android.os.Build
import android.view.WindowManager

/**
 * Lets MainActivity show over the keyguard and wake the screen ONLY while a
 * call is ringing or live. A permanent manifest flag would let anyone open
 * the app on a locked phone by pressing the power button.
 *
 * "Armed" is a deadline in SharedPreferences so a cold start (full-screen
 * call notification launching the app) can read it in onCreate, before any
 * JS has run.
 */
object CallLockScreen {
  private const val PREFS = "meetbook_call_lock_screen"
  private const val KEY_UNTIL = "armed_until"

  private fun prefs(context: Context) =
    context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

  fun arm(context: Context, durationMs: Long) {
    prefs(context).edit().putLong(KEY_UNTIL, System.currentTimeMillis() + durationMs).apply()
  }

  fun disarm(context: Context) {
    prefs(context).edit().remove(KEY_UNTIL).apply()
  }

  fun isArmed(context: Context): Boolean =
    System.currentTimeMillis() < prefs(context).getLong(KEY_UNTIL, 0L)

  fun applyTo(activity: Activity, on: Boolean) {
    activity.runOnUiThread {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
        activity.setShowWhenLocked(on)
        activity.setTurnScreenOn(on)
      } else {
        @Suppress("DEPRECATION")
        val flags = WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or
          WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON
        if (on) activity.window.addFlags(flags) else activity.window.clearFlags(flags)
      }
    }
  }
}
