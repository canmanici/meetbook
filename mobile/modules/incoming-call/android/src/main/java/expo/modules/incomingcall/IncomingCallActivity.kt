package expo.modules.incomingcall

import android.animation.Animator
import android.animation.Keyframe
import android.animation.ObjectAnimator
import android.animation.PropertyValuesHolder
import android.animation.ValueAnimator
import android.app.Activity
import android.app.KeyguardManager
import android.content.Intent
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.Outline
import android.graphics.drawable.Animatable
import android.graphics.drawable.GradientDrawable
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.Gravity
import android.view.View
import android.view.ViewOutlineProvider
import android.view.WindowManager
import android.view.animation.DecelerateInterpolator
import android.view.animation.OvershootInterpolator
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import java.lang.ref.WeakReference

/**
 * Lock-screen incoming-call screen. A dedicated activity with
 * showWhenLocked/turnScreenOn declared in the MANIFEST, so Android knows it
 * may cover the keyguard before it launches. Setting those flags at runtime
 * on MainActivity raced with HyperOS: the keyguard occluded for ~20 ms, then
 * un-occluded and hid the app while its ringtone kept playing.
 *
 * It shows only the caller and Reddet / Cevapla — nothing else of the app is
 * reachable from here — and closes itself when the call ends or expires.
 */
class IncomingCallActivity : Activity() {
  private val handler = Handler(Looper.getMainLooper())
  private var callId: String? = null
  private val animators = mutableListOf<Animator>()

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
      setShowWhenLocked(true)
      setTurnScreenOn(true)
    } else {
      @Suppress("DEPRECATION")
      window.addFlags(
        WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or
          WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON,
      )
    }
    window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
    current = WeakReference(this)
    render(intent)
  }

  override fun onNewIntent(intent: Intent) {
    super.onNewIntent(intent)
    setIntent(intent)
    render(intent)
  }

  override fun onDestroy() {
    handler.removeCallbacksAndMessages(null)
    animators.forEach { it.cancel() }
    animators.clear()
    if (current?.get() === this) current = null
    super.onDestroy()
  }

  private fun render(intent: Intent) {
    val call = IncomingCallStore.getActive(this)
    val requested = intent.getStringExtra(IncomingCallNotifier.EXTRA_CALL_ID)
    if (call == null || (requested != null && requested != call.callId)) {
      finish() // call already over
      return
    }
    callId = call.callId
    if (intent.getStringExtra(IncomingCallNotifier.EXTRA_ACTION) == IncomingCallNotifier.ACTION_ANSWER) {
      answer(call)
      return
    }
    setContentView(buildView(call))
    handler.removeCallbacksAndMessages(null)
    handler.postDelayed({ finish() }, (call.expiresAt - System.currentTimeMillis()).coerceAtLeast(0L))
  }

  private fun decline(call: CallInfo) {
    IncomingCallActions.decline(this, call.callId)
    finish()
  }

  private fun answer(call: CallInfo) {
    // Remember the answer for JS, stop the ringtone (call info stays), then
    // open MeetBook once the phone is unlocked — the app itself never shows
    // over the keyguard.
    IncomingCallStore.setPending(this, call.callId, "answer")
    IncomingCallNotifier.stopRinging(this, call.callId)
    val open = {
      val main = (packageManager.getLaunchIntentForPackage(packageName) ?: Intent()).apply {
        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
        putExtra(IncomingCallNotifier.EXTRA_ACTION, IncomingCallNotifier.ACTION_ANSWER)
        putExtra(IncomingCallNotifier.EXTRA_CALL_ID, call.callId)
      }
      startActivity(main)
      finish()
    }
    val km = getSystemService(KeyguardManager::class.java)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && km?.isKeyguardLocked == true) {
      km.requestDismissKeyguard(
        this,
        object : KeyguardManager.KeyguardDismissCallback() {
          override fun onDismissSucceeded() = open()
          override fun onDismissError() = open()
          override fun onDismissCancelled() {
            // Bouncer dismissed without unlocking: stay on the call screen.
          }
        },
      )
    } else {
      open()
    }
  }

  private fun buildView(call: CallInfo): View {
    animators.forEach { it.cancel() }
    animators.clear()
    val d = resources.displayMetrics.density
    fun dp(v: Int) = (v * d).toInt()
    val name = call.callerName.ifBlank { "MeetBook" }
    val avatarSize = dp(120)

    val root = LinearLayout(this).apply {
      orientation = LinearLayout.VERTICAL
      gravity = Gravity.CENTER_HORIZONTAL
      background = GradientDrawable(
        GradientDrawable.Orientation.TOP_BOTTOM,
        intArrayOf(Color.parseColor("#0A4A40"), Color.parseColor("#11806B")),
      )
      setPadding(dp(24), dp(88), dp(24), dp(72))
    }
    root.addView(TextView(this).apply {
      text = "MeetBook"
      setTextColor(Color.argb(190, 255, 255, 255))
      textSize = 15f
      letterSpacing = 0.08f
      gravity = Gravity.CENTER
    })

    // Photo (or initial) with two pulsing rings behind it.
    val ringBox = FrameLayout(this).apply {
      clipChildren = false
      clipToPadding = false
    }
    val rings = List(2) {
      View(this).apply {
        background = GradientDrawable().apply {
          shape = GradientDrawable.OVAL
          setColor(Color.argb(70, 255, 255, 255))
        }
        alpha = 0f
      }.also { ringBox.addView(it, FrameLayout.LayoutParams(avatarSize, avatarSize, Gravity.CENTER)) }
    }
    val avatar = FrameLayout(this).apply {
      background = GradientDrawable().apply {
        shape = GradientDrawable.OVAL
        setColor(Color.argb(60, 255, 255, 255))
      }
      outlineProvider = object : ViewOutlineProvider() {
        override fun getOutline(view: View, outline: Outline) = outline.setOval(0, 0, view.width, view.height)
      }
      clipToOutline = true
    }
    avatar.addView(TextView(this).apply {
      text = name.take(1).uppercase()
      setTextColor(Color.WHITE)
      textSize = 48f
      typeface = Typeface.DEFAULT_BOLD
      gravity = Gravity.CENTER
    }, FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT))
    val photo = ImageView(this).apply {
      scaleType = ImageView.ScaleType.CENTER_CROP
      alpha = 0f
    }
    avatar.addView(photo, FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT))
    ringBox.addView(avatar, FrameLayout.LayoutParams(avatarSize, avatarSize, Gravity.CENTER))
    root.addView(ringBox, LinearLayout.LayoutParams(dp(220), dp(220)).apply { topMargin = dp(24) })

    val nameView = TextView(this).apply {
      text = name
      setTextColor(Color.WHITE)
      textSize = 30f
      typeface = Typeface.DEFAULT_BOLD
      gravity = Gravity.CENTER
    }
    root.addView(nameView, LinearLayout.LayoutParams(
      LinearLayout.LayoutParams.MATCH_PARENT,
      LinearLayout.LayoutParams.WRAP_CONTENT,
    ).apply { topMargin = dp(4) })
    val subtitle = TextView(this).apply {
      text = if (call.kind == "video") "Görüntülü arama…" else "Sesli arama…"
      setTextColor(Color.argb(215, 255, 255, 255))
      textSize = 17f
      gravity = Gravity.CENTER
    }
    root.addView(subtitle, LinearLayout.LayoutParams(
      LinearLayout.LayoutParams.MATCH_PARENT,
      LinearLayout.LayoutParams.WRAP_CONTENT,
    ).apply { topMargin = dp(8) })
    root.addView(View(this), LinearLayout.LayoutParams(0, 0, 1f)) // push buttons down

    val row = LinearLayout(this).apply {
      orientation = LinearLayout.HORIZONTAL
      gravity = Gravity.CENTER
    }
    val declineBtn = actionButton("✕", "Reddet", "#E5484D", dp(76)) { decline(call) }
    val answerBtn = actionButton("✆", "Cevapla", "#30A46C", dp(76)) { answer(call) }
    row.addView(declineBtn, weighted())
    row.addView(answerBtn, weighted())
    root.addView(row, LinearLayout.LayoutParams(
      LinearLayout.LayoutParams.MATCH_PARENT,
      LinearLayout.LayoutParams.WRAP_CONTENT,
    ))

    // ── Animations ───────────────────────────────────────────────────────
    rings.forEachIndexed { i, ring ->
      play(ObjectAnimator.ofPropertyValuesHolder(
        ring,
        PropertyValuesHolder.ofFloat(View.SCALE_X, 1f, 1.75f),
        PropertyValuesHolder.ofFloat(View.SCALE_Y, 1f, 1.75f),
        PropertyValuesHolder.ofFloat(View.ALPHA, 0.6f, 0f),
      ).apply {
        duration = 1_800
        startDelay = 400L + i * 900L
        repeatCount = ValueAnimator.INFINITE
        interpolator = DecelerateInterpolator()
      })
    }
    avatar.scaleX = 0.6f; avatar.scaleY = 0.6f; avatar.alpha = 0f
    play(ObjectAnimator.ofPropertyValuesHolder(
      avatar,
      PropertyValuesHolder.ofFloat(View.SCALE_X, 0.6f, 1f),
      PropertyValuesHolder.ofFloat(View.SCALE_Y, 0.6f, 1f),
      PropertyValuesHolder.ofFloat(View.ALPHA, 0f, 1f),
    ).apply { duration = 480; interpolator = OvershootInterpolator(1.6f) })
    listOf(nameView to 140L, subtitle to 220L).forEach { (view, delay) ->
      view.alpha = 0f; view.translationY = dp(20).toFloat()
      play(ObjectAnimator.ofPropertyValuesHolder(
        view,
        PropertyValuesHolder.ofFloat(View.ALPHA, 0f, 1f),
        PropertyValuesHolder.ofFloat(View.TRANSLATION_Y, dp(20).toFloat(), 0f),
      ).apply { duration = 380; startDelay = delay; interpolator = DecelerateInterpolator() })
    }
    listOf(declineBtn to 300L, answerBtn to 380L).forEach { (view, delay) ->
      view.alpha = 0f; view.translationY = dp(110).toFloat()
      play(ObjectAnimator.ofPropertyValuesHolder(
        view,
        PropertyValuesHolder.ofFloat(View.ALPHA, 0f, 1f),
        PropertyValuesHolder.ofFloat(View.TRANSLATION_Y, dp(110).toFloat(), 0f),
      ).apply { duration = 520; startDelay = delay; interpolator = OvershootInterpolator(1.2f) })
    }
    // Cevapla wiggles for ~0.6 s every 2 s — a nudge, not a seizure.
    val wiggleTarget = (answerBtn as LinearLayout).getChildAt(0)
    val kf = listOf(0f to 0f, 0.06f to -14f, 0.12f to 14f, 0.18f to -10f, 0.24f to 10f, 0.30f to 0f, 1f to 0f)
    play(ObjectAnimator.ofPropertyValuesHolder(
      wiggleTarget,
      PropertyValuesHolder.ofKeyframe(View.ROTATION, *kf.map { Keyframe.ofFloat(it.first, it.second) }.toTypedArray()),
    ).apply { duration = 2_000; startDelay = 1_000; repeatCount = ValueAnimator.INFINITE })

    // Caller photo (GIFs animate); the initial stays until it arrives.
    if (call.avatarUrl.isNotBlank()) {
      AvatarLoader.load(resources, call.avatarUrl) { drawable ->
        if (isFinishing || isDestroyed || callId != call.callId) return@load
        photo.setImageDrawable(drawable)
        (drawable as? Animatable)?.start()
        photo.animate().alpha(1f).setDuration(250).start()
      }
    }
    return root
  }

  private fun play(animator: Animator) {
    animators += animator
    animator.start()
  }

  private fun weighted() = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)

  private fun actionButton(symbol: String, label: String, color: String, size: Int, onTap: () -> Unit): View {
    val column = LinearLayout(this).apply {
      orientation = LinearLayout.VERTICAL
      gravity = Gravity.CENTER_HORIZONTAL
    }
    column.addView(TextView(this).apply {
      text = symbol
      setTextColor(Color.WHITE)
      textSize = 30f
      gravity = Gravity.CENTER
      background = GradientDrawable().apply {
        shape = GradientDrawable.OVAL
        setColor(Color.parseColor(color))
      }
      elevation = 8 * resources.displayMetrics.density
      layoutParams = LinearLayout.LayoutParams(size, size)
      isClickable = true
      contentDescription = label
      setOnClickListener { view ->
        // Quick press feedback, then act.
        view.animate().scaleX(0.88f).scaleY(0.88f).setDuration(70).withEndAction {
          view.animate().scaleX(1f).scaleY(1f).setDuration(90).start()
          onTap()
        }.start()
      }
    })
    column.addView(TextView(this).apply {
      text = label
      setTextColor(Color.WHITE)
      textSize = 15f
      gravity = Gravity.CENTER
      setPadding(0, (10 * resources.displayMetrics.density).toInt(), 0, 0)
    })
    return column
  }

  companion object {
    @Volatile private var current: WeakReference<IncomingCallActivity>? = null

    /** Close the call screen (call cancelled, declined elsewhere, expired). */
    fun finishFor(callId: String?) {
      val activity = current?.get() ?: return
      if (callId == null || activity.callId == null || activity.callId == callId) {
        activity.runOnUiThread { activity.finish() }
      }
    }
  }
}
