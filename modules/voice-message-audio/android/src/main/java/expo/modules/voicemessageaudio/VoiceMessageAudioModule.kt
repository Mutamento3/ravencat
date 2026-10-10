package expo.modules.voicemessageaudio

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaMetadataRetriever
import android.media.MediaPlayer
import android.media.MediaRecorder
import android.net.Uri
import android.util.Base64
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import kotlin.math.max

private class VoiceMessageAudioException(message: String) : CodedException(message)

class VoiceMessageAudioModule : Module() {
  @Volatile private var recording = false
  private var recordingSessionId: String? = null
  private var recorder: AudioRecord? = null
  private var recordingThread: Thread? = null
  private var pcmFile: File? = null
  private var recordingSampleRate = 16_000
  private var recordedBytes = 0L

  private var player: MediaPlayer? = null
  private var playbackId: String? = null
  private var playbackProgressThread: Thread? = null

  override fun definition() = ModuleDefinition {
    Name("VoiceMessageAudio")
    Events(
      "onRecordingChunk", "onRecordingError", "onPlaybackStarted",
      "onPlaybackProgress", "onPlaybackEnded", "onPlaybackError"
    )

    AsyncFunction("startRecording") { options: Map<String, Any?> ->
      val context = appContext.reactContext ?: throw Exceptions.ReactContextLost()
      val sessionId = options["sessionId"] as? String
        ?: throw VoiceMessageAudioException("Recording session id is required")
      val sampleRate = (options["sampleRate"] as? Number)?.toInt() ?: 16_000
      val chunkDurationMs = (options["chunkDurationMs"] as? Number)?.toInt() ?: 200
      startRecording(context, sessionId, sampleRate, chunkDurationMs)
      null
    }.runOnQueue(Queues.DEFAULT)

    AsyncFunction("stopRecording") { sessionId: String -> stopRecording(sessionId, false) }
      .runOnQueue(Queues.DEFAULT)

    AsyncFunction("cancelRecording") { sessionId: String ->
      stopRecording(sessionId, true)
      null
    }.runOnQueue(Queues.DEFAULT)

    AsyncFunction("play") { options: Map<String, Any?> ->
      val context = appContext.reactContext ?: throw Exceptions.ReactContextLost()
      val id = options["playbackId"] as? String
        ?: throw VoiceMessageAudioException("Playback id is required")
      val uri = options["uri"] as? String
        ?: throw VoiceMessageAudioException("Audio uri is required")
      play(context, id, uri)
      null
    }.runOnQueue(Queues.DEFAULT)

    AsyncFunction("pause") { id: String ->
      requirePlayback(id).pause()
      null
    }.runOnQueue(Queues.DEFAULT)

    AsyncFunction("resume") { id: String ->
      val activePlayer = requirePlayback(id)
      activePlayer.start()
      emitPlayback("onPlaybackStarted", id, activePlayer)
      null
    }.runOnQueue(Queues.DEFAULT)

    AsyncFunction("stopPlayback") { id: String ->
      if (playbackId == id) releasePlayer()
      null
    }.runOnQueue(Queues.DEFAULT)

    AsyncFunction("readMetadata") { uri: String ->
      val context = appContext.reactContext ?: throw Exceptions.ReactContextLost()
      val retriever = MediaMetadataRetriever()
      try {
        retriever.setDataSource(context, Uri.parse(uri))
        val duration = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)?.toLongOrNull()
          ?: throw VoiceMessageAudioException("Audio duration is unavailable")
        mapOf("durationMs" to duration)
      } finally {
        retriever.release()
      }
    }.runOnQueue(Queues.DEFAULT)

    AsyncFunction("clearVoiceMessageAudioForFactoryReset") {
      val context = appContext.reactContext ?: throw Exceptions.ReactContextLost()
      // 录音/播放都由本 module 持有；先终止 producer/consumer，再删除专属 cache，
      // 避免 reset 与仍在写入的 PCM 文件竞态，也不触碰其他 cache 或外部 URI。
      recordingSessionId?.let { stopRecording(it, true) }
      releasePlayer()
      File(context.cacheDir, "voice-message").deleteRecursively()
      null
    }.runOnQueue(Queues.DEFAULT)

    OnDestroy {
      recordingSessionId?.let { runCatching { stopRecording(it, true) } }
      releasePlayer()
    }
  }

  private fun startRecording(context: Context, sessionId: String, sampleRate: Int, chunkDurationMs: Int) {
    if (context.checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
      throw VoiceMessageAudioException("Microphone permission is required")
    }
    if (recording) throw VoiceMessageAudioException("A voice recording is already active")

    val minBuffer = AudioRecord.getMinBufferSize(
      sampleRate, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT
    )
    if (minBuffer <= 0) throw VoiceMessageAudioException("Unable to initialize AudioRecord")
    val chunkSize = max(sampleRate * 2 * chunkDurationMs / 1000, minBuffer / 2)
    val newRecorder = AudioRecord(
      MediaRecorder.AudioSource.MIC,
      sampleRate,
      AudioFormat.CHANNEL_IN_MONO,
      AudioFormat.ENCODING_PCM_16BIT,
      max(minBuffer * 2, chunkSize * 2)
    )
    if (newRecorder.state != AudioRecord.STATE_INITIALIZED) {
      newRecorder.release()
      throw VoiceMessageAudioException("Android AudioRecord is not initialized")
    }

    val directory = File(context.cacheDir, "voice-message").apply { mkdirs() }
    val target = File(directory, "$sessionId.pcm")
    target.delete()
    val output = FileOutputStream(target)
    try {
      newRecorder.startRecording()
    } catch (error: Exception) {
      output.close()
      target.delete()
      newRecorder.release()
      throw VoiceMessageAudioException(error.message ?: "Unable to start voice recording")
    }

    recording = true
    recordingSessionId = sessionId
    recorder = newRecorder
    pcmFile = target
    recordingSampleRate = sampleRate
    recordedBytes = 0
    recordingThread = Thread {
      val buffer = ByteArray(chunkSize)
      var chunkIndex = 0
      try {
        while (recording && recordingSessionId == sessionId) {
          val read = newRecorder.read(buffer, 0, buffer.size)
          if (read <= 0) throw VoiceMessageAudioException("Android AudioRecord read failed: $read")
          output.write(buffer, 0, read)
          recordedBytes += read
          sendEvent("onRecordingChunk", mapOf(
            "sessionId" to sessionId,
            "base64" to Base64.encodeToString(buffer, 0, read, Base64.NO_WRAP),
            "sampleRate" to sampleRate,
            "channels" to 1,
            "bytesPerSample" to 2,
            "chunkIndex" to chunkIndex++
          ))
        }
      } catch (error: Exception) {
        if (recordingSessionId == sessionId) {
          sendEvent("onRecordingError", mapOf(
            "sessionId" to sessionId,
            "message" to (error.message ?: "Voice recording failed")
          ))
        }
      } finally {
        output.close()
      }
    }.apply { name = "VoiceMessageRecorder"; isDaemon = true; start() }
  }

  private fun stopRecording(sessionId: String, cancel: Boolean): Map<String, Any?>? {
    if (recordingSessionId != sessionId) throw VoiceMessageAudioException("Recording session is not active")
    // 先翻转标志并 join 录音线程，确保线程不会再向本 session 追加 PCM/chunk；
    // 之后才允许回收 recorder。这段是 native stop barrier 的前半段。
    recording = false
    val activeRecorder = recorder
    recorder = null
    runCatching { activeRecorder?.stop() }
    recordingThread?.join(1_000)
    recordingThread = null
    activeRecorder?.release()

    // source 可能为 null（例如 startRecording 之后极早失败）；无论如何都要把
    // session state 收口到合法终态，否则后续 session 会被永久阻塞。
    val source = pcmFile
    pcmFile = null
    recordingSessionId = null

    if (source == null) {
      if (cancel) return null
      throw VoiceMessageAudioException("Recording file is unavailable")
    }
    if (cancel) {
      source.delete()
      return null
    }

    val wavFile = File(source.parentFile, "$sessionId.wav")
    try {
      writeWav(source, wavFile, recordingSampleRate, recordedBytes)
    } catch (error: Exception) {
      // WAV materialization 失败：source PCM 与可能写坏的 partial WAV 都不允许残留。
      wavFile.delete()
      source.delete()
      throw VoiceMessageAudioException(error.message ?: "Unable to finalize voice recording")
    }
    source.delete()
    val durationMs = recordedBytes * 1_000L / (recordingSampleRate * 2L)
    return mapOf(
      "sessionId" to sessionId,
      "uri" to Uri.fromFile(wavFile).toString(),
      "mimeType" to "audio/wav",
      "durationMs" to durationMs
    )
  }

  private fun writeWav(source: File, target: File, sampleRate: Int, dataSize: Long) {
    try {
      FileOutputStream(target).use { output ->
        val byteRate = sampleRate * 2
        output.write("RIFF".toByteArray())
        writeIntLE(output, 36 + dataSize.toInt())
        output.write("WAVEfmt ".toByteArray())
        writeIntLE(output, 16)
        writeShortLE(output, 1)
        writeShortLE(output, 1)
        writeIntLE(output, sampleRate)
        writeIntLE(output, byteRate)
        writeShortLE(output, 2)
        writeShortLE(output, 16)
        output.write("data".toByteArray())
        writeIntLE(output, dataSize.toInt())
        FileInputStream(source).use { it.copyTo(output) }
      }
    } catch (error: Exception) {
      // 只有本方法创建的 target 才允许删除，避免误删调用方已接管的文件。
      target.delete()
      throw error
    }
  }

  private fun writeIntLE(output: FileOutputStream, value: Int) {
    output.write(byteArrayOf(value.toByte(), (value shr 8).toByte(), (value shr 16).toByte(), (value shr 24).toByte()))
  }

  private fun writeShortLE(output: FileOutputStream, value: Int) {
    output.write(byteArrayOf(value.toByte(), (value shr 8).toByte()))
  }

  private fun play(context: Context, id: String, uri: String) {
    releasePlayer()
    val newPlayer = MediaPlayer()
    player = newPlayer
    playbackId = id
    newPlayer.setAudioAttributes(AudioAttributes.Builder()
      .setUsage(AudioAttributes.USAGE_MEDIA)
      .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
      .build())
    newPlayer.setOnCompletionListener {
      emitPlayback("onPlaybackEnded", id, newPlayer)
      releasePlayer()
    }
    newPlayer.setOnErrorListener { _, what, extra ->
      val duration = runCatching { newPlayer.duration }.getOrDefault(0)
      val position = runCatching { newPlayer.currentPosition }.getOrDefault(0)
      sendEvent("onPlaybackError", mapOf(
        "playbackId" to id, "positionMs" to position, "durationMs" to duration,
        "message" to "Android MediaPlayer error: what=$what extra=$extra"
      ))
      releasePlayer()
      true
    }
    try {
      newPlayer.setDataSource(context, Uri.parse(uri))
      newPlayer.prepare()
      newPlayer.start()
    } catch (error: Exception) {
      releasePlayer()
      throw VoiceMessageAudioException(error.message ?: "Unable to start voice playback")
    }
    emitPlayback("onPlaybackStarted", id, newPlayer)
    playbackProgressThread = Thread {
      try {
        while (playbackId == id) {
          Thread.sleep(200)
          if (playbackId == id && newPlayer.isPlaying) {
            emitPlayback("onPlaybackProgress", id, newPlayer)
          }
        }
      } catch (_: InterruptedException) {
        // stop/release 通过中断结束进度线程。
      }
    }.apply { name = "VoiceMessagePlaybackProgress"; isDaemon = true; start() }
  }

  private fun requirePlayback(id: String): MediaPlayer {
    if (playbackId != id) throw VoiceMessageAudioException("Playback session is not active")
    return player ?: throw VoiceMessageAudioException("Playback session is unavailable")
  }

  private fun emitPlayback(event: String, id: String, activePlayer: MediaPlayer) {
    sendEvent(event, mapOf(
      "playbackId" to id,
      "positionMs" to runCatching { activePlayer.currentPosition }.getOrDefault(0),
      "durationMs" to runCatching { activePlayer.duration }.getOrDefault(0)
    ))
  }

  private fun releasePlayer() {
    val activePlayer = player
    player = null
    playbackId = null
    playbackProgressThread?.interrupt()
    playbackProgressThread = null
    runCatching { activePlayer?.stop() }
    activePlayer?.release()
  }
}
