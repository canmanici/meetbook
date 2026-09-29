package expo.modules.incomingcall

import android.app.NotificationManager
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record
import java.lang.ref.WeakReference

class ShowOptions : Record {
  @Field val callId: String = ""
  @Field val chatId: String = ""
  @Field val kind: String = "audio"
  @Field val callerName: String = ""
  @Field val callerAvatarUrl: String = ""
  @Field val expiresAt: Double = 0.0
  @Field val quiet: Boolean = false
}

class IncomingCallModule : Module() {
  private val context get() = appContext.reactContext

  override fun definition() = ModuleDefinition {
    Name("IncomingCall")

    /** A native Decline happened while JS is running (app backgrounded with
     * its socket alive): the call store must drop its ringing state too. */
    Events("onCallAction")

    OnCreate { instance = WeakReference(this@IncomingCallModule) }
    OnDestroy { if (instance?.get() === this@IncomingCallModule) instance = null }

    /** Ringing CallStyle notification + lock-screen call screen (works from
     * a headless start). */
    Function("show") { options: ShowOptions ->
      val ctx = context ?: return@Function false
      val call = CallInfo(
        callId = options.callId,
        chatId = options.chatId,
        kind = options.kind,
        callerName = options.callerName,
        expiresAt = options.expiresAt.toLong(),
        avatarUrl = options.callerAvatarUrl,
      )
      IncomingCallNotifier.show(ctx, call, options.quiet)
      true
    }

    Function("cancel") { callId: String? ->
      val ctx = context ?: return@Function false
      IncomingCallNotifier.cancel(ctx, callId)
      true
    }

    /** The call currently ringing in the notification, or null. */
    Function("getActive") {
      val ctx = context ?: return@Function null
      IncomingCallStore.getActive(ctx)?.toMap()
    }

    /** Answer/Decline tapped natively before JS had the call. */
    Function("takePendingAction") {
      val ctx = context ?: return@Function null
      IncomingCallStore.takePending(ctx)?.let { (callId, action) ->
        mapOf("callId" to callId, "action" to action)
      }
    }

    /** API base + a fresh access token for the native Decline request. */
    Function("setAuth") { apiBase: String, accessToken: String ->
      val ctx = context ?: return@Function false
      IncomingCallStore.setAuth(ctx, apiBase, accessToken)
      true
    }

    Function("clearAuth") {
      val ctx = context ?: return@Function false
      IncomingCallStore.clearAuth(ctx)
      true
    }

    /** Android 14+: may the call screen open full-screen on a locked phone? */
    Function("canUseFullScreenIntent") {
      val ctx = context ?: return@Function true
      if (Build.VERSION.SDK_INT < 34) return@Function true
      ctx.getSystemService(NotificationManager::class.java)?.canUseFullScreenIntent() ?: true
    }

    Function("openFullScreenIntentSettings") {
      val ctx = context ?: return@Function false
      val intent = if (Build.VERSION.SDK_INT >= 34) {
        Intent(Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT, Uri.parse("package:${ctx.packageName}"))
      } else {
        Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:${ctx.packageName}"))
      }
      intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      runCatching { ctx.startActivity(intent) }.isSuccess
    }

    /** Xiaomi/HyperOS gate lock-screen launches behind their own
     * "Show on lock screen" permission (not visible to Android APIs). */
    Function("isXiaomi") {
      Build.MANUFACTURER.equals("Xiaomi", ignoreCase = true) ||
        Build.BRAND.equals("Redmi", ignoreCase = true) ||
        Build.BRAND.equals("POCO", ignoreCase = true)
    }

    Function("openXiaomiPermissions") {
      val ctx = context ?: return@Function false
      val miui = Intent("miui.intent.action.APP_PERM_EDITOR").apply {
        setClassName("com.miui.securitycenter", "com.miui.permcenter.permissions.PermissionsEditorActivity")
        putExtra("extra_pkgname", ctx.packageName)
        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      }
      val fallback = Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:${ctx.packageName}"))
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      runCatching { ctx.startActivity(miui) }.isSuccess ||
        runCatching { ctx.startActivity(fallback) }.isSuccess
    }
  }

  companion object {
    @Volatile private var instance: WeakReference<IncomingCallModule>? = null

    fun emitCallAction(callId: String, action: String) {
      runCatching {
        instance?.get()?.sendEvent("onCallAction", mapOf("callId" to callId, "action" to action))
      }
    }
  }
}
