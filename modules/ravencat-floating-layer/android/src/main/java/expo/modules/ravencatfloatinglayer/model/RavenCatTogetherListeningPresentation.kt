package expo.modules.ravencatfloatinglayer.model

/**
 * Together Listening 的只读外部 presentation projection。
 *
 * 这里不表达 Activity phase、歌曲或播放器状态；native 只把 Host 已提交的
 * 稳定 identity 与展示资料交给浮层渲染。
 */
internal data class RavenCatTogetherListeningPresentation(
  val activityId: String,
  val hostAiId: String,
  val chatSessionId: String,
  val activatedAtEpochMs: Long,
  val aiName: String,
  val aiAvatar: String?,
  val userName: String,
  val userAvatar: String?,
)
