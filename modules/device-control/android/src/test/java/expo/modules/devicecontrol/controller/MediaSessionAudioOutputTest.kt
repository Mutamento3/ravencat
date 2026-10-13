package expo.modules.devicecontrol.controller

import android.media.session.MediaController
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class MediaSessionAudioOutputTest {
  @Test
  fun `本地媒体输出保留系统名称并在新快照中反映切换`() {
    var selectedNames = listOf("手机扬声器")
    val first = createMediaSessionAudioOutputSnapshot(MediaController.PlaybackInfo.PLAYBACK_TYPE_LOCAL) {
      selectedNames
    }!!
    selectedNames = listOf("有线耳机")
    val second = createMediaSessionAudioOutputSnapshot(MediaController.PlaybackInfo.PLAYBACK_TYPE_LOCAL) {
      selectedNames
    }!!
    assertEquals(listOf("手机扬声器"), first.deviceNames)
    assertEquals(listOf("有线耳机"), second.deviceNames)
    assertEquals(mapOf("playbackType" to "local", "deviceNames" to selectedNames), second.toMap())
  }

  @Test
  fun `远程播放不读取手机路由也不猜设备`() {
    val output = createMediaSessionAudioOutputSnapshot(MediaController.PlaybackInfo.PLAYBACK_TYPE_REMOTE) {
      error("远程播放不能读取手机路由")
    }!!
    assertEquals("remote", output.playbackType)
    assertEquals(emptyList<String>(), output.deviceNames)
  }

  @Test
  fun `缺少播放类型时不伪造输出事实`() {
    assertNull(createMediaSessionAudioOutputSnapshot(null) { error("未知类型不能读取路由") })
  }
}
