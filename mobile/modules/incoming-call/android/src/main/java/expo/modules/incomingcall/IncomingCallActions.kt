package expo.modules.incomingcall

import android.content.Context
import android.util.Log
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

/** Decline shared by the notification button and the call screen. */
object IncomingCallActions {
  fun decline(context: Context, callId: String, onDone: () -> Unit = {}) {
    val call = IncomingCallStore.getActive(context)
    // Silence + close the call UI first — the user expects it to stop now.
    IncomingCallNotifier.cancel(context, callId)
    // If the app opens before the offer is withdrawn, reject it there too.
    IncomingCallStore.setPending(context, callId, "decline")
    // A running app (socket alive) must drop its own ringing state as well.
    IncomingCallModule.emitCallAction(callId, "decline")

    val apiBase = IncomingCallStore.apiBase(context)
    val token = IncomingCallStore.accessToken(context)
    if (call == null || apiBase == null || token == null) {
      onDone()
      return
    }
    Thread {
      try {
        val conn = URL("${apiBase.trimEnd('/')}/chat/calls/decline").openConnection() as HttpURLConnection
        conn.requestMethod = "POST"
        conn.connectTimeout = 5_000
        conn.readTimeout = 5_000
        conn.doOutput = true
        conn.setRequestProperty("Content-Type", "application/json")
        conn.setRequestProperty("Authorization", "Bearer $token")
        val body = JSONObject()
          .put("chat_id", call.chatId)
          .put("call_id", call.callId)
          .put("kind", call.kind)
          .toString()
        conn.outputStream.use { it.write(body.toByteArray()) }
        val code = conn.responseCode
        if (code !in 200..299) Log.w("IncomingCall", "decline failed: HTTP $code")
        conn.disconnect()
      } catch (e: Exception) {
        Log.w("IncomingCall", "decline failed", e)
      } finally {
        onDone()
      }
    }.start()
  }
}
