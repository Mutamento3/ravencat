package expo.modules.callaudioplayback

import android.media.AudioAttributes
import android.media.MediaPlayer
import android.net.Uri
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

private class CallAudioPlaybackException(message: String) : CodedException(message)

class CallAudioPlaybackModule : Module() {
  private var mediaPlayer: MediaPlayer? = null
  private var currentPlaybackId: String? = null
  private var currentUri: String? = null
  override fun definition() = ModuleDefinition {
    Name("CallAudioPlayback")
    Events("onPlaybackEnded", "onPlaybackError")

    AsyncFunction("play") { options: Map<String, Any?> ->
      val context = appContext.reactContext ?: throw Exceptions.ReactContextLost()
      val uri = options["uri"] as? String ?: throw CallAudioPlaybackException("Audio uri is required")
      val playbackId = options["playbackId"] as? String ?: throw CallAudioPlaybackException("Playback id is required")

      stopCurrentPlayer()

      val player = MediaPlayer()
      mediaPlayer = player
      currentPlaybackId = playbackId
      currentUri = uri

      player.setAudioAttributes(
        AudioAttributes.Builder()
          .setUsage(AudioAttributes.USAGE_VOICE_COMMUNICATION)
          .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
          .build()
      )
      player.setOnCompletionListener {
        val endedPlaybackId = currentPlaybackId
        val endedUri = currentUri
        stopCurrentPlayer()
        if (endedPlaybackId != null && endedUri != null) {
          sendEvent("onPlaybackEnded", mapOf("playbackId" to endedPlaybackId, "uri" to endedUri))
        }
      }
      player.setOnErrorListener { _, what, extra ->
        val failedPlaybackId = currentPlaybackId
        val failedUri = currentUri
        val message = "Android MediaPlayer error: what=$what extra=$extra"
        stopCurrentPlayer()
        if (failedPlaybackId != null && failedUri != null) {
          sendEvent(
            "onPlaybackError",
            mapOf("playbackId" to failedPlaybackId, "uri" to failedUri, "message" to message)
          )
        }
        true
      }

      try {
        player.setDataSource(context, Uri.parse(uri))
        player.prepare()
        player.start()
      } catch (error: Exception) {
        stopCurrentPlayer()
        throw CallAudioPlaybackException(error.message ?: "Failed to start Android audio playback")
      }

      null
    }.runOnQueue(Queues.DEFAULT)

    AsyncFunction("stop") {
      stopCurrentPlayer()
      null
    }.runOnQueue(Queues.DEFAULT)

    OnDestroy {
      stopCurrentPlayer()
    }
  }

  private fun stopCurrentPlayer() {
    val player = mediaPlayer
    mediaPlayer = null
    currentPlaybackId = null
    currentUri = null

    try {
      player?.stop()
    } catch (_: Exception) {
      // MediaPlayer can already be idle/completed; release is still required.
    } finally {
      player?.release()
    }
  }
}
