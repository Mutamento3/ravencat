package expo.modules.callringtone

import android.app.NotificationManager
import android.content.Context
import android.media.AudioAttributes
import android.media.AudioManager
import android.media.MediaPlayer
import android.net.Uri
import android.os.Looper
import android.os.VibratorManager
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import org.robolectric.annotation.LooperMode
import org.robolectric.shadows.ShadowMediaPlayer
import org.robolectric.shadows.util.DataSource
import org.robolectric.util.ReflectionHelpers
import org.robolectric.util.ReflectionHelpers.ClassParameter
import java.time.Duration
import java.io.IOException

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [33])
@LooperMode(LooperMode.Mode.PAUSED)
class CallRingtonePlaybackTest {
  private val context: Context get() = RuntimeEnvironment.getApplication()
  private val uri = "file:///private/ringtone.mp3"
  private val created = mutableListOf<MediaPlayer>()

  @Before fun setup() {
    context.getSystemService(AudioManager::class.java).ringerMode = AudioManager.RINGER_MODE_NORMAL
    val notifications = context.getSystemService(NotificationManager::class.java)
    shadowOf(notifications).setNotificationPolicyAccessGranted(true)
    notifications.setInterruptionFilter(NotificationManager.INTERRUPTION_FILTER_ALL)
    ShadowMediaPlayer.setCreateListener { media, _ -> created.add(media) }
    ShadowMediaPlayer.addMediaInfo(DataSource.toDataSource(context, Uri.parse(uri)), ShadowMediaPlayer.MediaInfo(60_000, 0))
  }

  @After fun cleanup() {
    listOf("incoming", "outgoing", "preview").forEach(CallRingtonePlayback::stop)
    ShadowMediaPlayer.setCreateListener(null)
  }

  @Test fun `incoming loops until its notification is dismissed`() {
    CallRingtonePlayback.start(context, "incoming", uri, "incoming", durationMs = 30_000)
    shadowOf(Looper.getMainLooper()).idle()
    val media = created.single()
    assertTrue(media.isPlaying)
    assertTrue(media.isLooping)
    CallRingtonePlayback.stop("incoming")
    assertEquals(ShadowMediaPlayer.State.END, shadowOf(media).state)
  }

  @Test fun `custom outgoing audio follows call volume while media volume is zero`() {
    val audio = context.getSystemService(AudioManager::class.java)
    audio.mode = AudioManager.MODE_NORMAL
    audio.setStreamVolume(AudioManager.STREAM_MUSIC, 0, 0)
    audio.setStreamVolume(AudioManager.STREAM_VOICE_CALL, 3, 0)
    CallRingtonePlayback.start(context, "outgoing", uri, "outgoing")
    shadowOf(Looper.getMainLooper()).idle()
    val media = created.single()
    val stream = volumeStream(media)
    assertEquals(AudioManager.STREAM_VOICE_CALL, stream)
    assertEquals(3, audio.getStreamVolume(stream))
    assertTrue(media.isPlaying)
  }

  @Test fun `incoming and preview preserve their own volume controls`() {
    CallRingtonePlayback.start(context, "incoming", uri, "incoming")
    shadowOf(Looper.getMainLooper()).idle()
    assertEquals(AudioManager.STREAM_RING, volumeStream(created.single()))
    CallRingtonePlayback.stop("incoming")
    CallRingtonePlayback.start(context, "preview", uri, "outgoing", isPreview = true)
    shadowOf(Looper.getMainLooper()).idle()
    assertEquals(AudioManager.STREAM_MUSIC, volumeStream(created.last()))
  }

  // 校验播放器真正使用的流；音量面板选择的 volumeControlStream 可能与实际播放流不同。
  private fun volumeStream(media: MediaPlayer): Int = ReflectionHelpers.callStaticMethod(
    AudioAttributes::class.java, "toLegacyStreamType",
    ClassParameter.from(AudioAttributes::class.java, shadowOf(media).audioAttributes),
  )

  @Test fun `late preparation cannot restart a stopped call`() {
    ShadowMediaPlayer.addMediaInfo(DataSource.toDataSource(context, Uri.parse(uri)), ShadowMediaPlayer.MediaInfo(60_000, 500))
    CallRingtonePlayback.start(context, "incoming", uri, "incoming")
    val media = created.single()
    val prepared = shadowOf(media).onPreparedListener
    CallRingtonePlayback.stop("incoming")
    prepared.onPrepared(media)
    shadowOf(Looper.getMainLooper()).idleFor(Duration.ofSeconds(1))
    assertEquals(ShadowMediaPlayer.State.END, shadowOf(media).state)
  }

  @Test fun `old call cleanup and preview cannot interrupt a newer call`() {
    CallRingtonePlayback.start(context, "incoming", uri, "incoming")
    CallRingtonePlayback.start(context, "outgoing", uri, "outgoing")
    shadowOf(Looper.getMainLooper()).idle()
    val media = created.last()
    CallRingtonePlayback.stop("incoming")
    var error: String? = null
    CallRingtonePlayback.start(context, "preview", uri, "incoming", isPreview = true) { error = it }
    assertNotNull(error)
    assertTrue(media.isPlaying)
    assertEquals(2, created.size)
  }

  @Test fun `incoming sound and vibration expire without waiting for JavaScript`() {
    CallRingtonePlayback.start(context, "incoming", uri, "incoming", durationMs = 30_000,
      vibrationPattern = longArrayOf(0, 200, 200, 200))
    shadowOf(Looper.getMainLooper()).idle()
    val vibrator = context.getSystemService(VibratorManager::class.java).defaultVibrator
    assertTrue(shadowOf(vibrator).isVibrating)
    shadowOf(Looper.getMainLooper()).idleFor(Duration.ofSeconds(30))
    assertEquals(ShadowMediaPlayer.State.END, shadowOf(created.single()).state)
    assertFalse(shadowOf(vibrator).isVibrating)
  }

  @Test fun `silent and do not disturb suppress incoming playback`() {
    val audio = context.getSystemService(AudioManager::class.java)
    audio.ringerMode = AudioManager.RINGER_MODE_SILENT
    CallRingtonePlayback.start(context, "incoming", uri, "incoming")
    var previewError: String? = null
    CallRingtonePlayback.start(context, "preview", uri, "incoming", isPreview = true) { previewError = it }
    assertNotNull(previewError)
    CallRingtonePlayback.stop("incoming")
    audio.ringerMode = AudioManager.RINGER_MODE_NORMAL
    context.getSystemService(NotificationManager::class.java).setInterruptionFilter(NotificationManager.INTERRUPTION_FILTER_NONE)
    CallRingtonePlayback.start(context, "incoming", uri, "incoming")
    assertTrue(created.isEmpty())
  }

  @Test fun `vibrate mode preserves vibration without playing audio`() {
    context.getSystemService(AudioManager::class.java).ringerMode = AudioManager.RINGER_MODE_VIBRATE
    CallRingtonePlayback.start(context, "incoming", uri, "incoming", vibrationPattern = longArrayOf(0, 200, 200, 200))
    val vibrator = context.getSystemService(VibratorManager::class.java).defaultVibrator
    assertTrue(created.isEmpty())
    assertTrue(shadowOf(vibrator).isVibrating)
    CallRingtonePlayback.stop("incoming")
    assertFalse(shadowOf(vibrator).isVibrating)
  }

  @Test fun `preview cannot take audio focus from an active communication session`() {
    context.getSystemService(AudioManager::class.java).mode = AudioManager.MODE_IN_COMMUNICATION
    var error: String? = null
    CallRingtonePlayback.start(context, "preview", uri, "outgoing", isPreview = true) { error = it }
    assertNotNull(error)
    assertTrue(created.isEmpty())
  }

  @Test fun `invalid custom audio reports failure without playing a different sound`() {
    ShadowMediaPlayer.addException(DataSource.toDataSource(context, Uri.parse(uri)), IOException("invalid audio"))
    var error: String? = null
    CallRingtonePlayback.start(context, "preview", uri, "incoming", isPreview = true) { error = it }
    assertEquals("invalid audio", error)
    assertEquals(1, created.size)
    assertEquals(ShadowMediaPlayer.State.END, shadowOf(created.single()).state)
  }
}
