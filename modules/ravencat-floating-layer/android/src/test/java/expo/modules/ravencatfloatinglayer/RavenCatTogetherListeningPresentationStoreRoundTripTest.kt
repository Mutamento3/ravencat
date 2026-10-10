package expo.modules.ravencatfloatinglayer

import android.content.Context
import expo.modules.ravencatfloatinglayer.model.RavenCatTogetherListeningPresentation
import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment

/**
 * projection DTO 的持久化解析链路：bridge 下发的 aiAvatar/userAvatar 经
 * save → load 后必须完整还原（Service/process attach 时由 load 恢复展示）。
 */
@RunWith(RobolectricTestRunner::class)
class RavenCatTogetherListeningPresentationStoreRoundTripTest {
  @Suppress("DEPRECATION")
  private val context: Context = RuntimeEnvironment.getApplication()

  @Test
  fun `projection round trip preserves avatar uris`() {
    val projection = RavenCatTogetherListeningPresentation(
      activityId = "activity-1",
      hostAiId = "host-1",
      chatSessionId = "session-1",
      activatedAtEpochMs = 1_000L,
      aiName = "Kimi",
      aiAvatar = "file:///data/user/0/app/files/persistent-media/avatars/ai/host.png",
      userName = "用户",
      userAvatar = "file:///data/user/0/app/files/persistent-media/avatars/user/self.png",
    )

    RavenCatTogetherListeningPresentationStore.save(context, projection)

    assertEquals(projection, RavenCatTogetherListeningPresentationStore.load(context))
  }

  @Test
  fun `projection without avatars round trips as null avatars`() {
    val projection = RavenCatTogetherListeningPresentation(
      activityId = "activity-2",
      hostAiId = "host-1",
      chatSessionId = "session-2",
      activatedAtEpochMs = 2_000L,
      aiName = "Kimi",
      aiAvatar = null,
      userName = "用户",
      userAvatar = null,
    )

    RavenCatTogetherListeningPresentationStore.save(context, projection)

    assertEquals(projection, RavenCatTogetherListeningPresentationStore.load(context))
  }
}
