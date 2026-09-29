package expo.modules.calllockscreen

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class CallLockScreenModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("CallLockScreen")

    /** Allow showing over the lock screen for the next [durationMs]. */
    Function("arm") { durationMs: Double ->
      val context = appContext.reactContext ?: return@Function false
      CallLockScreen.arm(context, durationMs.toLong())
      appContext.currentActivity?.let { CallLockScreen.applyTo(it, true) }
      true
    }

    /** Call over: back to normal lock-screen behaviour immediately. */
    Function("disarm") {
      val context = appContext.reactContext ?: return@Function false
      CallLockScreen.disarm(context)
      appContext.currentActivity?.let { CallLockScreen.applyTo(it, false) }
      true
    }
  }
}
