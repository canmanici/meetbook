package expo.modules.calllockscreen

import android.app.Activity
import android.content.Context
import android.os.Bundle
import expo.modules.core.interfaces.Package
import expo.modules.core.interfaces.ReactActivityLifecycleListener

/** Applies the armed state as soon as MainActivity is created/resumed. */
class CallLockScreenPackage : Package {
  override fun createReactActivityLifecycleListeners(
    activityContext: Context?
  ): List<ReactActivityLifecycleListener> = listOf(Listener)

  private object Listener : ReactActivityLifecycleListener {
    override fun onCreate(activity: Activity, savedInstanceState: Bundle?) {
      if (CallLockScreen.isArmed(activity)) CallLockScreen.applyTo(activity, true)
    }

    override fun onResume(activity: Activity) {
      CallLockScreen.applyTo(activity, CallLockScreen.isArmed(activity))
    }
  }
}
