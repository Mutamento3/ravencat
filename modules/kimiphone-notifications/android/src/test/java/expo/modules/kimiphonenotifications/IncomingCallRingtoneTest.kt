package expo.modules.kimiphonenotifications

import android.Manifest
import android.app.NotificationManager
import android.media.AudioManager
import android.media.MediaPlayer
import android.net.Uri
import android.os.Looper
import expo.modules.callringtone.CallRingtonePlayback
import org.junit.After
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import org.robolectric.annotation.LooperMode
import org.robolectric.shadows.ShadowMediaPlayer
import org.robolectric.shadows.util.DataSource

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [33])
@LooperMode(LooperMode.Mode.PAUSED)
class IncomingCallRingtoneTest {
  private val callId = "ringing-call"

  @After fun cleanup() {
    CallRingtonePlayback.stop(callId)
    ShadowMediaPlayer.setCreateListener(null)
  }

  @Test fun `notification dismissal releases its looping custom ringtone`() {
    val context = RuntimeEnvironment.getApplication()
    shadowOf(context).grantPermissions(Manifest.permission.POST_NOTIFICATIONS, Manifest.permission.VIBRATE)
    context.getSystemService(AudioManager::class.java).ringerMode = AudioManager.RINGER_MODE_NORMAL
    val manager = context.getSystemService(NotificationManager::class.java)
    shadowOf(manager).setNotificationPolicyAccessGranted(true)
    manager.setInterruptionFilter(NotificationManager.INTERRUPTION_FILTER_ALL)
    val uri = "file:///private/incoming.mp3"
    val created = mutableListOf<MediaPlayer>()
    ShadowMediaPlayer.setCreateListener { media, _ -> created.add(media) }
    ShadowMediaPlayer.addMediaInfo(DataSource.toDataSource(context, Uri.parse(uri)), ShadowMediaPlayer.MediaInfo(60_000, 0))
    val result = NotificationPublisher.postIncomingCall(context, mapOf(
      "displayId" to NotificationPublisher.callDisplayId(callId), "callId" to callId,
      "aiId" to "ai", "aiName" to "测试 AI", "sessionId" to "session", "body" to "视频来电",
      "ringtoneUri" to uri, "ringDurationMs" to 30_000,
    ), null)
    assertEquals(true, result["posted"])
    shadowOf(Looper.getMainLooper()).idle()
    val media = created.single()
    assertTrue(media.isPlaying)
    assertTrue(media.isLooping)
    assertEquals(1, manager.activeNotifications.size)
    NotificationPublisher.dismissIncomingCall(context, callId)
    assertEquals(0, manager.activeNotifications.size)
    assertEquals(ShadowMediaPlayer.State.END, shadowOf(media).state)
  }
}
