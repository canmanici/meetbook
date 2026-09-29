package expo.modules.incomingcall

import android.graphics.BitmapFactory
import android.graphics.ImageDecoder
import android.graphics.drawable.AnimatedImageDrawable
import android.graphics.drawable.BitmapDrawable
import android.graphics.drawable.Drawable
import android.content.res.Resources
import android.os.Build
import android.os.Handler
import android.os.Looper
import java.io.ByteArrayOutputStream
import java.net.HttpURLConnection
import java.net.URL
import java.nio.ByteBuffer

/**
 * Caller photo for the lock-screen call screen — static or animated GIF /
 * WebP. Avatars are user uploads, so decoding is defensive even though the
 * backend already validates them: size-capped download, header checked
 * before decoding, and always decoded down to [TARGET_PX] so a hostile image
 * can't exhaust memory while the phone is ringing.
 */
object AvatarLoader {
  private const val MAX_BYTES = 5 * 1024 * 1024
  private const val MAX_SOURCE_PIXELS = 16_000_000L
  private const val TARGET_PX = 512
  private const val TIMEOUT_MS = 4_000

  fun load(resources: Resources, url: String, onLoaded: (Drawable) -> Unit) {
    if (!url.startsWith("https://") && !url.startsWith("http://")) return
    Thread {
      val drawable = runCatching { decode(resources, download(url) ?: return@Thread) }.getOrNull()
      if (drawable != null) Handler(Looper.getMainLooper()).post { onLoaded(drawable) }
    }.start()
  }

  private fun download(url: String): ByteArray? {
    val conn = URL(url).openConnection() as HttpURLConnection
    conn.connectTimeout = TIMEOUT_MS
    conn.readTimeout = TIMEOUT_MS
    conn.instanceFollowRedirects = true
    return try {
      if (conn.responseCode !in 200..299) return null
      conn.inputStream.use { input ->
        val out = ByteArrayOutputStream()
        val buf = ByteArray(16 * 1024)
        while (true) {
          val n = input.read(buf)
          if (n < 0) break
          out.write(buf, 0, n)
          if (out.size() > MAX_BYTES) return null
        }
        out.toByteArray()
      }
    } finally {
      conn.disconnect()
    }
  }

  private fun decode(resources: Resources, bytes: ByteArray): Drawable? {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
      val source = ImageDecoder.createSource(ByteBuffer.wrap(bytes))
      val drawable = ImageDecoder.decodeDrawable(source) { decoder, info, _ ->
        val w = info.size.width
        val h = info.size.height
        if (w <= 0 || h <= 0 || w.toLong() * h > MAX_SOURCE_PIXELS) {
          throw IllegalArgumentException("avatar too large: ${w}x$h")
        }
        val scale = minOf(1f, TARGET_PX.toFloat() / maxOf(w, h))
        decoder.setTargetSize(maxOf(1, (w * scale).toInt()), maxOf(1, (h * scale).toInt()))
      }
      if (drawable is AnimatedImageDrawable) drawable.repeatCount = AnimatedImageDrawable.REPEAT_INFINITE
      return drawable
    }
    // API < 28: static only (first frame).
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
    val w = bounds.outWidth
    val h = bounds.outHeight
    if (w <= 0 || h <= 0 || w.toLong() * h > MAX_SOURCE_PIXELS) return null
    var sample = 1
    while (maxOf(w, h) / (sample * 2) >= TARGET_PX) sample *= 2
    val bitmap = BitmapFactory.decodeByteArray(bytes, 0, bytes.size, BitmapFactory.Options().apply { inSampleSize = sample })
      ?: return null
    return BitmapDrawable(resources, bitmap)
  }
}
