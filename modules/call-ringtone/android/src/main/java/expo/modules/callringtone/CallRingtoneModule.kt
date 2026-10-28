package expo.modules.callringtone

import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import android.media.MediaPlayer
import android.net.Uri
import expo.modules.kotlin.functions.Queues
import com.facebook.react.bridge.ReactContext
import com.facebook.react.common.LifecycleState

class CallRingtoneModule : Module() {
  private var previewOwner: String? = null

  override fun definition() = ModuleDefinition {
    Name("CallRingtone")
    AsyncFunction("inspect") { uri: String ->
      val media = MediaPlayer()
      try {
        media.setDataSource(checkNotNull(appContext.reactContext), Uri.parse(uri))
        media.prepare()
        require(media.duration > 0 && media.videoWidth == 0 && media.videoHeight == 0) { "请选择可播放的音频文件" }
        mapOf("durationMs" to media.duration)
      } finally { media.release() }
    }
    AsyncFunction("preview") { owner: String, uri: String?, direction: String, promise: Promise ->
      require(direction == "incoming" || direction == "outgoing")
      check((appContext.reactContext as ReactContext).lifecycleState == LifecycleState.RESUMED) { "试听铃声需要可见界面" }
      previewOwner = owner
      CallRingtonePlayback.start(checkNotNull(appContext.reactContext), owner, uri, direction,
        isPreview = true, durationMs = 10_000) { error ->
        if (error == null) promise.resolve(null) else promise.reject("ERR_CALL_RINGTONE", error, null)
      }
    }.runOnQueue(Queues.MAIN)
    AsyncFunction("stopPreview") { owner: String -> CallRingtonePlayback.stopPreview(owner) }.runOnQueue(Queues.MAIN)
    OnActivityEntersBackground { previewOwner?.let(CallRingtonePlayback::stopPreview) }
    OnDestroy { previewOwner?.let(CallRingtonePlayback::stopPreview) }
  }
}
