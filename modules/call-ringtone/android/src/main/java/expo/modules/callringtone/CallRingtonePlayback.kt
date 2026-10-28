package expo.modules.callringtone

import android.app.NotificationManager
import android.content.Context
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.media.MediaPlayer
import android.media.RingtoneManager
import android.media.ToneGenerator
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import android.os.VibrationAttributes
import android.util.Log

/** 原生铃声只有一个播放 owner；来电通知与拨出服务分别提供真实生命周期，不读写业务状态。 */
object CallRingtonePlayback {
  private val handler = Handler(Looper.getMainLooper())
  private var owner: String? = null
  private var preview = false
  private var player: MediaPlayer? = null
  private var tone: ToneGenerator? = null
  private var vibrator: Vibrator? = null
  private var audioManager: AudioManager? = null
  private var focus: AudioFocusRequest? = null
  private var expiry: Runnable? = null
  private var preparing: ((String?) -> Unit)? = null

  private fun onMain(action: () -> Unit) {
    if (Looper.myLooper() == Looper.getMainLooper()) action() else handler.post { action() }
  }

  fun start(context: Context, id: String, uri: String?, direction: String,
    isPreview: Boolean = false, durationMs: Long? = null, vibrationPattern: LongArray? = null,
    soundEnabled: Boolean = true, ready: (String?) -> Unit = {}) = onMain {
    val audio = context.getSystemService(AudioManager::class.java)
    // 试听不能抢占正在响铃的呼叫或系统已持有的通信音频（包括已接通通话）。
    if (isPreview && ((owner != null && !preview) || audio.mode != AudioManager.MODE_NORMAL)) {
      ready("通话期间无法试听铃声")
      return@onMain
    }
    if (owner == id) { ready(null); return@onMain }
    close()
    val notifications = context.getSystemService(NotificationManager::class.java)
    owner = id
    preview = isPreview
    preparing = ready
    // 自定义拨出等待音与默认 ToneGenerator 一样使用通话音量。
    // SIGNALLING 会映射到 DTMF，未接通时可能随媒体音量或响铃策略被静音。
    val attributes = AudioAttributes.Builder()
      .setUsage(if (isPreview) AudioAttributes.USAGE_MEDIA else if (direction == "incoming")
        AudioAttributes.USAGE_NOTIFICATION_RINGTONE else AudioAttributes.USAGE_VOICE_COMMUNICATION)
      .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build()
    try {
      // 只限定声音资源的最长存活时间；未接业务结算仍由 Calls 的唯一超时 owner 提交。
      durationMs?.let { duration ->
        expiry = Runnable { if (owner == id) close() }.also { handler.postDelayed(it, duration) }
      }
      // 静音来电仍持有自己的资源身份，避免试听在来电窗口内绕过静音设置。
      if (!isPreview && direction == "incoming" && (audio.ringerMode == AudioManager.RINGER_MODE_SILENT
          || notifications.currentInterruptionFilter != NotificationManager.INTERRUPTION_FILTER_ALL)) {
        completeReady(null)
        return@onMain
      }
      vibrationPattern?.let { pattern ->
        vibrator = context.getSystemService(VibratorManager::class.java).defaultVibrator.apply {
          vibrate(VibrationEffect.createWaveform(pattern, 0),
            VibrationAttributes.Builder().setUsage(VibrationAttributes.USAGE_RINGTONE).build())
        }
      }
      if (!soundEnabled || (!isPreview && direction == "incoming" && audio.ringerMode == AudioManager.RINGER_MODE_VIBRATE)) {
        completeReady(null)
        return@onMain
      }
      // 来电沿通知的短时提示语义播放；不从后台额外申请需要可见界面/FGS 的音频焦点。
      if (isPreview || direction == "outgoing") {
        val request = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT)
          .setAudioAttributes(attributes).setOnAudioFocusChangeListener({ change ->
            if (change < 0 && owner == id) close()
          }, handler).build()
        audioManager = audio
        focus = request
        check(audio.requestAudioFocus(request) == AudioManager.AUDIOFOCUS_REQUEST_GRANTED) { "未能获取铃声音频焦点" }
      }
      if (uri == null && direction == "outgoing") {
        tone = ToneGenerator(if (isPreview) AudioManager.STREAM_MUSIC else AudioManager.STREAM_VOICE_CALL, 70)
        check(tone!!.startTone(ToneGenerator.TONE_SUP_RINGTONE)) { "无法播放默认拨出等待音" }
        completeReady(null)
      } else {
        val source = uri?.let(Uri::parse) ?: RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE)
        val media = MediaPlayer()
        player = media
        media.setAudioAttributes(attributes)
        media.isLooping = true
        media.setOnPreparedListener {
          // 旧的异步准备完成不能让已接通/结束的电话重新响铃。
          if (player === media) {
            try { media.start(); completeReady(null) }
            catch (failure: Exception) { fail(failure.message ?: "铃声播放失败") }
          }
        }
        media.setOnErrorListener { _, what, extra ->
          if (player === media) fail("铃声播放失败（$what/$extra）")
          true
        }
        media.setDataSource(context, source)
        media.prepareAsync()
      }
    } catch (failure: Exception) {
      fail(failure.message ?: "铃声播放失败")
    }
  }

  fun stop(id: String) = onMain { if (owner == id) close() }
  fun stopPreview(id: String) = onMain { if (preview && owner == id) close() }

  private fun completeReady(error: String?) {
    val callback = preparing
    preparing = null
    callback?.invoke(error)
  }

  private fun fail(message: String) {
    Log.w("CallRingtone", message)
    completeReady(message)
    close()
  }

  private fun close() {
    owner = null
    expiry?.let(handler::removeCallbacks)
    expiry = null
    player?.release()
    player = null
    tone?.release()
    tone = null
    vibrator?.cancel()
    vibrator = null
    focus?.let { audioManager!!.abandonAudioFocusRequest(it) }
    focus = null
    audioManager = null
    completeReady("铃声播放已停止")
  }
}
