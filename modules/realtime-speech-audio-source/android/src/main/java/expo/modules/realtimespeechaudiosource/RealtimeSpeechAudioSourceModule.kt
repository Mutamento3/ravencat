package expo.modules.realtimespeechaudiosource

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaRecorder
import android.media.audiofx.AcousticEchoCanceler
import android.util.Base64
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import kotlin.math.abs
import kotlin.math.max

private class MicrophonePermissionRequiredException :
  CodedException("Microphone permission is required for realtime speech audio")

private class AudioRecordStartException(message: String) : CodedException(message)

class RealtimeSpeechAudioSourceModule : Module() {
  @Volatile
  private var recording = false
  private var audioRecord: AudioRecord? = null
  private var acousticEchoCanceler: AcousticEchoCanceler? = null
  private var echoCancellationEnabled = false
  private var recordThread: Thread? = null
  private var chunkIndex = 0
  private var lastSpeechDetectedAt = 0L
  private var consecutiveSpeechChunks = 0

  override fun definition() = ModuleDefinition {
    Name("RealtimeSpeechAudioSource")
    Events("onAudioChunk", "onSpeechDetected", "onError")

    AsyncFunction("start") { options: Map<String, Any?> ->
      val context = appContext.reactContext ?: throw Exceptions.ReactContextLost()
      if (!hasMicrophonePermission(context)) {
        throw MicrophonePermissionRequiredException()
      }
      if (recording) {
        return@AsyncFunction mapOf("echoCancellationEnabled" to echoCancellationEnabled)
      }

      val sampleRate = (options["sampleRate"] as? Number)?.toInt() ?: 16000
      val chunkDurationMs = (options["chunkDurationMs"] as? Number)?.toInt() ?: 40
      startRecording(sampleRate, chunkDurationMs)
      mapOf("echoCancellationEnabled" to echoCancellationEnabled)
    }.runOnQueue(Queues.DEFAULT)

    AsyncFunction("stop") {
      stopRecording()
      null
    }.runOnQueue(Queues.DEFAULT)

    AsyncFunction("isRecording") {
      recording
    }

    OnDestroy {
      stopRecording()
    }
  }

  // 通信模式由 Calls 的整通电话会话持有，录音暂停不恢复全局模式。
  private fun startRecording(sampleRate: Int, chunkDurationMs: Int) {
    val channelConfig = AudioFormat.CHANNEL_IN_MONO
    val audioFormat = AudioFormat.ENCODING_PCM_16BIT
    val minBufferSize = AudioRecord.getMinBufferSize(sampleRate, channelConfig, audioFormat)
    if (minBufferSize <= 0) {
      throw AudioRecordStartException("Unable to initialize Android AudioRecord buffer")
    }

    val bytesPerSample = 2
    val chunkSize = max(
      sampleRate * bytesPerSample * chunkDurationMs / 1000,
      minBufferSize / 2,
    )
    val bufferSize = max(minBufferSize * 2, chunkSize * 2)
    val recorder = try {
      AudioRecord(
        MediaRecorder.AudioSource.VOICE_COMMUNICATION,
        sampleRate,
        channelConfig,
        audioFormat,
        bufferSize,
      )
    } catch (error: Exception) {
      throw AudioRecordStartException(error.message ?: "Unable to create Android AudioRecord")
    }
    if (recorder.state != AudioRecord.STATE_INITIALIZED) {
      recorder.release()
      throw AudioRecordStartException("Android AudioRecord is not initialized")
    }

    val echoCanceler = createAcousticEchoCanceler(recorder.audioSessionId)
    try {
      recorder.startRecording()
    } catch (error: Exception) {
      echoCanceler?.release()
      recorder.release()
      throw AudioRecordStartException(error.message ?: "Unable to start Android AudioRecord")
    }

    audioRecord = recorder
    acousticEchoCanceler = echoCanceler
    echoCancellationEnabled = echoCanceler?.enabled == true
    recording = true
    chunkIndex = 0
    lastSpeechDetectedAt = 0L
    consecutiveSpeechChunks = 0

    recordThread = Thread {
      val buffer = ByteArray(chunkSize)
      while (recording) {
        val read = recorder.read(buffer, 0, buffer.size)
        if (read > 0) {
          emitAudioChunk(buffer, read, sampleRate, bytesPerSample)
        } else if (read < 0) {
          sendEvent("onError", mapOf("message" to "Android AudioRecord read failed: $read"))
          break
        }
      }
    }.apply {
      name = "RealtimeSpeechAudioRecord"
      isDaemon = true
      start()
    }
  }

  private fun emitAudioChunk(
    buffer: ByteArray,
    read: Int,
    sampleRate: Int,
    bytesPerSample: Int,
  ) {
    val payload = buffer.copyOf(read)
    detectSpeech(payload)
    sendEvent(
      "onAudioChunk",
      mapOf(
        "base64" to Base64.encodeToString(payload, Base64.NO_WRAP),
        "sampleRate" to sampleRate,
        "channels" to 1,
        "bytesPerSample" to bytesPerSample,
        "chunkIndex" to chunkIndex++,
      ),
    )
  }

  private fun detectSpeech(payload: ByteArray) {
    var maxAmplitude = 0
    var index = 0
    while (index + 1 < payload.size) {
      val low = payload[index].toInt() and 0xff
      val high = payload[index + 1].toInt()
      val sample = (high shl 8) or low
      maxAmplitude = max(maxAmplitude, abs(sample))
      index += 2
    }

    val now = System.currentTimeMillis()
    consecutiveSpeechChunks = if (maxAmplitude >= SPEECH_AMPLITUDE_THRESHOLD) {
      consecutiveSpeechChunks + 1
    } else {
      0
    }
    if (
      consecutiveSpeechChunks >= SPEECH_CONFIRMATION_CHUNKS &&
      now - lastSpeechDetectedAt >= SPEECH_DETECTED_COOLDOWN_MS
    ) {
      lastSpeechDetectedAt = now
      consecutiveSpeechChunks = 0
      sendEvent(
        "onSpeechDetected",
        mapOf(
          "maxAmplitude" to maxAmplitude,
          "detectedAt" to now,
        ),
      )
    }
  }

  private fun stopRecording() {
    recording = false
    val recorder = audioRecord
    audioRecord = null
    val echoCanceler = acousticEchoCanceler
    acousticEchoCanceler = null
    echoCancellationEnabled = false

    try {
      recorder?.stop()
    } catch (_: Exception) {
      // 平台可能已经停止 AudioRecord，但下面仍需释放资源。
    } finally {
      echoCanceler?.release()
      recorder?.release()
    }

    recordThread?.join(500)
    recordThread = null
  }

  private fun createAcousticEchoCanceler(audioSessionId: Int): AcousticEchoCanceler? {
    if (!AcousticEchoCanceler.isAvailable()) {
      return null
    }

    val echoCanceler = AcousticEchoCanceler.create(audioSessionId) ?: return null
    return try {
      echoCanceler.enabled = true
      echoCanceler
    } catch (_: Exception) {
      echoCanceler.release()
      null
    }
  }

  private fun hasMicrophonePermission(context: Context): Boolean {
    return context.checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED
  }

  companion object {
    private const val SPEECH_AMPLITUDE_THRESHOLD = 900
    private const val SPEECH_CONFIRMATION_CHUNKS = 2
    private const val SPEECH_DETECTED_COOLDOWN_MS = 800L
  }
}
