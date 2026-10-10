package expo.modules.ravencatfloatinglayer

import expo.modules.ravencatfloatinglayer.model.RavenCatTogetherListeningPresentation
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class RavenCatTogetherListeningPresentationStoreTest {
  private val current = RavenCatTogetherListeningPresentation(
    activityId = "activity-b",
    hostAiId = "host-a",
    chatSessionId = "session-a",
    activatedAtEpochMs = 1_000L,
    aiName = "Kimi",
    aiAvatar = null,
    userName = "用户",
    userAvatar = null,
  )

  @Test
  fun `stale activity clear cannot match current projection`() {
    assertFalse(RavenCatTogetherListeningPresentationStore.matchesActivity(current, "activity-a"))
    assertTrue(RavenCatTogetherListeningPresentationStore.matchesActivity(current, "activity-b"))
    assertTrue(RavenCatTogetherListeningPresentationStore.matchesActivity(current, null))
  }
}
