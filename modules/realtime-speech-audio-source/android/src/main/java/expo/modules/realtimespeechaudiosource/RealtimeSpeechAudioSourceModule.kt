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
import com.konovalov.vad.webrtc.VadWebRTC
import com.konovalov.vad.webrtc.config.FrameSize
import com.konovalov.vad.webrtc.config.Mode
import com.konovalov.vad.webrtc.config.SampleRate
import kotlin.math.max
import java.io.File
import android.net.Uri

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
  private var segmentArchive: SpeechSegmentArchive? = null

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
      if (options["archiveSegments"] == true) {
        val root = File(context.cacheDir, "call-speech-source")
        // 没有活动录音时，只清除此模块上次异常退出留下的原始采集暂存。
        root.listFiles()?.forEach { it.delete() }
        segmentArchive = SpeechSegmentArchive(root, sampleRate)
      }
      try { startRecording(sampleRate, chunkDurationMs) }
      catch (error: Exception) { segmentArchive?.close(); segmentArchive = null; throw error }
      mapOf("echoCancellationEnabled" to echoCancellationEnabled, "archiveId" to segmentArchive?.id)
    }.runOnQueue(Queues.DEFAULT)

    AsyncFunction("exportSegment") { archiveId: String, startMs: Double, endMs: Double ->
      val context = appContext.reactContext ?: throw Exceptions.ReactContextLost()
      val archive = segmentArchive
      require(archive != null && archive.id == archiveId) { "录音会话已经结束" }
      val (file, durationMs) = archive.export(startMs, endMs, File(context.cacheDir, "speech"))
      mapOf("uri" to Uri.fromFile(file).toString(), "durationMs" to durationMs)
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
    // VAD 与录音共用一次会话；保留原始 PCM 给 ASR 和录音归档，不在这里裁掉声音。
    val vad = try {
      VadWebRTC(
        sampleRate = SampleRate.entries.first { it.value == sampleRate },
        frameSize = FrameSize.entries.first { it.value == sampleRate / 50 },
        mode = Mode.AGGRESSIVE,
      )
    } catch (error: Exception) {
      echoCanceler?.release()
      recorder.release()
      throw AudioRecordStartException(error.message ?: "Unable to initialize speech detection")
    }
    try {
      recorder.startRecording()
    } catch (error: Exception) {
      vad.close()
      echoCanceler?.release()
      recorder.release()
      throw AudioRecordStartException(error.message ?: "Unable to start Android AudioRecord")
    }

    audioRecord = recorder
    acousticEchoCanceler = echoCanceler
    echoCancellationEnabled = echoCanceler?.enabled == true
    recording = true
    chunkIndex = 0

    recordThread = Thread {
      vad.use {
        val speechDetector = SpeechActivityDetector(sampleRate / 50) { vad.isSpeech(it) }
        val buffer = ByteArray(chunkSize)
        while (recording) {
          val read = recorder.read(buffer, 0, buffer.size)
          if (read > 0) {
            try { segmentArchive?.append(buffer, read) }
            catch (error: Exception) {
              sendEvent("onError", mapOf("message" to "通话录音写入失败：${error.message}"))
              break
            }
            val payload = buffer.copyOf(read)
            val speechDetected = try { speechDetector.accept(payload) }
            catch (error: Exception) {
              sendEvent("onError", mapOf("message" to "通话人声检测失败：${error.message}"))
              break
            }
            if (speechDetected) {
              sendEvent("onSpeechDetected", mapOf("detectedAt" to System.currentTimeMillis()))
            }
            emitAudioChunk(payload, sampleRate, bytesPerSample)
          } else if (read < 0) {
            sendEvent("onError", mapOf("message" to "Android AudioRecord read failed: $read"))
            break
          }
        }
      }
    }.apply {
      name = "RealtimeSpeechAudioRecord"
      isDaemon = true
      start()
    }
  }

  private fun emitAudioChunk(
    payload: ByteArray,
    sampleRate: Int,
    bytesPerSample: Int,
  ) {
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
    segmentArchive?.close()
    segmentArchive = null
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

}
