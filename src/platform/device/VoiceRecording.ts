import { PermissionsAndroid } from 'react-native';
import {
  addVoiceAudioListener,
  cancelVoiceRecording,
  clearVoiceMessageAudioForFactoryReset,
  startVoiceRecording,
  stopVoiceRecording,
} from '../../../modules/voice-message-audio';
import { createRandomUUID } from './randomUUID';

export type VoiceRecordingFailureCode =
  | 'VOICE_MICROPHONE_PERMISSION_DENIED'
  | 'VOICE_RECORDING_START_FAILED'
  | 'VOICE_RECORDING_FAILED';

export class VoiceRecordingError extends Error {
  constructor(public readonly code: VoiceRecordingFailureCode, message: string) {
    super(message);
    this.name = 'VoiceRecordingError';
  }
}

export interface VoiceRecordingResult {
  uri: string;
  mimeType: string;
  durationMs: number;
}

export interface VoiceRecordingSession {
  readonly sessionId: string;
  stop(): Promise<VoiceRecordingResult>;
  cancel(): Promise<void>;
}

export interface VoiceRecordingPort {
  start(params: {
    onAudioChunk: (chunk: ArrayBuffer) => void;
    onError: (error: VoiceRecordingError) => void;
  }): Promise<VoiceRecordingSession>;
}

/**
 * 麦克风权限的唯一判定入口。
 *
 * 调用方有两处，共用本函数，不各自实现权限逻辑：
 * - 进入语音输入模式前的 preflight（用户点击麦克风图标时）；
 * - `voiceRecordingPort.start()` 真正开始录音前。
 *
 * 已授权时 Android 会立即返回 `GRANTED`，不重复弹窗；未授权时由系统权限弹窗
 * 给出明确反馈。这样“进入语音模式说可以、真正录音却被拒”不会出现两套判断。
 * 权限被拒后用户可能在系统设置里改回来，因此这里每次都重新询问，不缓存结果。
 */
export async function requestMicrophonePermission(): Promise<boolean> {
  const permission = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO);
  return permission === PermissionsAndroid.RESULTS.GRANTED;
}

class NativeVoiceRecordingPort implements VoiceRecordingPort {
  async start(params: {
    onAudioChunk: (chunk: ArrayBuffer) => void;
    onError: (error: VoiceRecordingError) => void;
  }): Promise<VoiceRecordingSession> {
    if (!(await requestMicrophonePermission())) {
      throw new VoiceRecordingError('VOICE_MICROPHONE_PERMISSION_DENIED', '需要麦克风权限才能录制语音消息');
    }

    const sessionId = createRandomUUID();
    const subscriptions = [
      addVoiceAudioListener('onRecordingChunk', (event) => {
        if (event.sessionId === sessionId) params.onAudioChunk(decodeBase64(event.base64));
      }),
      addVoiceAudioListener('onRecordingError', (event) => {
        if (event.sessionId === sessionId) {
          params.onError(new VoiceRecordingError('VOICE_RECORDING_FAILED', event.message));
        }
      }),
    ];
    try {
      await startVoiceRecording({ sessionId, sampleRate: 16_000, chunkDurationMs: 200 });
    } catch (error) {
      subscriptions.forEach((subscription) => subscription.remove());
      throw new VoiceRecordingError(
        'VOICE_RECORDING_START_FAILED',
        error instanceof Error ? error.message : '无法开始录音'
      );
    }

    let active = true;
    // detach 只移除事件订阅；stop() 必须先等 native stop barrier 完成再 detach，
    // 否则录音线程在 barrier 内产生的最后一个 chunk 会被丢弃（腾讯实时 ASR 吞字）。
    const detach = () => subscriptions.forEach((subscription) => subscription.remove());
    const close = () => {
      if (!active) return false;
      active = false;
      detach();
      return true;
    };
    return {
      sessionId,
      stop: async () => {
        if (!active) throw new VoiceRecordingError('VOICE_RECORDING_FAILED', '录音已经结束');
        try {
          // native stop 在 resolve 前已完成“停止 chunk producer + join 录音线程”，
          // 因此 resolve 之后不会再有属于本 session 的 chunk；此时才允许 unsubscribe。
          const result = await stopVoiceRecording(sessionId);
          return { uri: result.uri, mimeType: result.mimeType, durationMs: result.durationMs };
        } catch (error) {
          throw new VoiceRecordingError(
            'VOICE_RECORDING_FAILED',
            error instanceof Error ? error.message : '结束录音失败'
          );
        } finally {
          // 无论 stop 成功或失败都收回订阅，避免监听器泄漏；失败路径下不会再有合法 chunk。
          close();
        }
      },
      cancel: async () => {
        // cancel 不保证最后一个 chunk 被消费，因此可以立即 detach。
        if (close()) await cancelVoiceRecording(sessionId);
      },
    };
  }
}

export const voiceRecordingPort: VoiceRecordingPort = new NativeVoiceRecordingPort();

export function clearVoiceRecordingDataForFactoryReset(): Promise<void> {
  return clearVoiceMessageAudioForFactoryReset();
}

function decodeBase64(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes.buffer;
}
