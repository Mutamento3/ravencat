package expo.modules.ravencatfloatinglayer.model

/** 原生悬浮视图只能上报这一组有限用户意图。 */
internal sealed interface RavenCatOverlayIntent {
  data object Expand : RavenCatOverlayIntent
  data object Collapse : RavenCatOverlayIntent
  data object Cancel : RavenCatOverlayIntent
  data object RemoveScreenshot : RavenCatOverlayIntent
  data object OpenApp : RavenCatOverlayIntent
  data object RequestInputFocus : RavenCatOverlayIntent
  data object ReleaseInputFocus : RavenCatOverlayIntent

  data class DraftChanged(val text: String) : RavenCatOverlayIntent

  data class Send(
    val text: String,
    val correlationId: String,
  ) : RavenCatOverlayIntent

  data class Shot(val correlationId: String) : RavenCatOverlayIntent
}
