package expo.modules.incomingcall

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/**
 * "Reddet" on the call notification. Pure native on purpose: a killed app
 * has no JS runtime (Notifee's headless events crashed under the new
 * architecture and the tap was silently lost).
 */
class DeclineReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    val callId = intent.getStringExtra(IncomingCallNotifier.EXTRA_CALL_ID) ?: return
    // Keep the process alive until the decline request has gone out.
    val pending = goAsync()
    IncomingCallActions.decline(context, callId) { pending.finish() }
  }
}
