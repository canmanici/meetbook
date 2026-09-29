package expo.modules.incomingcall

import android.content.Context
import org.json.JSONObject

/**
 * State shared between the native call notification, the Decline receiver,
 * the activity lifecycle hook and JS. SharedPreferences, because every one of
 * them may run in a freshly started process (killed app woken by a push).
 */
object IncomingCallStore {
  private const val PREFS = "meetbook_incoming_call"
  private const val KEY_ACTIVE = "active_call"
  private const val KEY_PENDING = "pending_action"
  private const val KEY_API_BASE = "api_base"
  private const val KEY_TOKEN = "access_token"
  private const val PENDING_TTL_MS = 60_000L

  private fun prefs(context: Context) =
    context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

  // ── The call currently ringing in the notification ────────────────────
  fun setActive(context: Context, call: CallInfo) {
    prefs(context).edit().putString(KEY_ACTIVE, call.toJson().toString()).apply()
  }

  fun getActive(context: Context): CallInfo? {
    val raw = prefs(context).getString(KEY_ACTIVE, null) ?: return null
    val call = runCatching { CallInfo.fromJson(JSONObject(raw)) }.getOrNull() ?: return null
    // Past its expiry the caller has given up — never resurrect it.
    return if (System.currentTimeMillis() < call.expiresAt) call else null
  }

  fun clearActive(context: Context, callId: String? = null) {
    val current = getActive(context)
    if (callId == null || current == null || current.callId == callId) {
      prefs(context).edit().remove(KEY_ACTIVE).apply()
    }
  }

  // ── Answer/Decline tapped before JS had the call ──────────────────────
  fun setPending(context: Context, callId: String, action: String) {
    val json = JSONObject()
      .put("call_id", callId)
      .put("action", action)
      .put("at", System.currentTimeMillis())
    prefs(context).edit().putString(KEY_PENDING, json.toString()).apply()
  }

  fun takePending(context: Context): Pair<String, String>? {
    val p = prefs(context)
    val raw = p.getString(KEY_PENDING, null) ?: return null
    p.edit().remove(KEY_PENDING).apply()
    val json = runCatching { JSONObject(raw) }.getOrNull() ?: return null
    if (System.currentTimeMillis() - json.optLong("at") > PENDING_TTL_MS) return null
    return json.optString("call_id") to json.optString("action")
  }

  // ── Auth for the native Decline request ───────────────────────────────
  fun setAuth(context: Context, apiBase: String, accessToken: String) {
    prefs(context).edit().putString(KEY_API_BASE, apiBase).putString(KEY_TOKEN, accessToken).apply()
  }

  fun apiBase(context: Context): String? = prefs(context).getString(KEY_API_BASE, null)

  fun accessToken(context: Context): String? = prefs(context).getString(KEY_TOKEN, null)

  fun clearAuth(context: Context) {
    prefs(context).edit().remove(KEY_API_BASE).remove(KEY_TOKEN).apply()
  }
}

data class CallInfo(
  val callId: String,
  val chatId: String,
  val kind: String,
  val callerName: String,
  val expiresAt: Long,
  val avatarUrl: String = "",
) {
  fun toJson(): JSONObject = JSONObject()
    .put("call_id", callId)
    .put("chat_id", chatId)
    .put("kind", kind)
    .put("caller_name", callerName)
    .put("expires_at", expiresAt)
    .put("avatar_url", avatarUrl)

  fun toMap(): Map<String, Any> = mapOf(
    "callId" to callId,
    "chatId" to chatId,
    "kind" to kind,
    "callerName" to callerName,
    "expiresAt" to expiresAt.toDouble(),
    "callerAvatarUrl" to avatarUrl,
  )

  companion object {
    fun fromJson(json: JSONObject) = CallInfo(
      callId = json.getString("call_id"),
      chatId = json.getString("chat_id"),
      kind = json.optString("kind", "audio"),
      callerName = json.optString("caller_name", ""),
      expiresAt = json.optLong("expires_at", 0L),
      avatarUrl = json.optString("avatar_url", ""),
    )
  }
}
