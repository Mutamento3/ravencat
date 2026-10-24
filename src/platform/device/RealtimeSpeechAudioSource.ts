import {
  addRealtimeSpeechAudioChunkListener,
  addRealtimeSpeechAudioErrorListener,
  addRealtimeSpeechDetectedListener,
  startRealtimeSpeechAudioSource,
  stopRealtimeSpeechAudioSource,
  exportRealtimeSpeechSegment,
  type RealtimeSpeechAudioSourceStartResult,
  type RealtimeSpeechAudioSourceSubscription,
} from '../../../modules/realtime-speech-audio-source';

export interface RealtimeSpeechAudioSourceSession {
  echoCancellationEnabled: boolean;
  stop(): Promise<void>;
  exportSegment(startMs: number, endMs: number): Promise<{ uri: string; durationMs: number }>;
}

export interface RealtimeSpeechAudioSourceStartParams {
  onAudioChunk: (chunk: ArrayBuffer) => void;
  onSpeechDetected?: () => void;
  onError: (error: Error) => void;
  archiveSegments?: boolean;
}

export interface RealtimeSpeechAudioSource {
  start(params: RealtimeSpeechAudioSourceStartParams): Promise<RealtimeSpeechAudioSourceSession>;
}

class NativeRealtimeSpeechAudioSource implements RealtimeSpeechAudioSource {
  async start(params: RealtimeSpeechAudioSourceStartParams): Promise<RealtimeSpeechAudioSourceSession> {
    const subscriptions: RealtimeSpeechAudioSourceSubscription[] = [
      addRealtimeSpeechAudioChunkListener((event) => {
        params.onAudioChunk(base64ToArrayBuffer(event.base64));
      }),
      addRealtimeSpeechDetectedListener(() => {
        params.onSpeechDetected?.();
      }),
      addRealtimeSpeechAudioErrorListener((event) => {
        params.onError(new Error(event.message || '实时语音采集失败'));
      }),
    ];

    let startResult: RealtimeSpeechAudioSourceStartResult;
    try {
      startResult = await startRealtimeSpeechAudioSource({
        sampleRate: 16000,
        chunkDurationMs: 200,
        archiveSegments: params.archiveSegments,
      });
    } catch (error) {
      subscriptions.forEach((subscription) => subscription.remove());
      throw error;
    }

    let stopping: Promise<void> | undefined;
    const exports = new Set<Promise<unknown>>();
    return {
      echoCancellationEnabled: startResult.echoCancellationEnabled,
      // 原生 stop 完成前仍接收末尾 PCM；重复停止共享同一次原生释放。
      exportSegment: (startMs, endMs) => {
        if (!startResult.archiveId || stopping) return Promise.reject(new Error('录音分段保存未开启或采集已停止'));
        const operation = exportRealtimeSpeechSegment(startResult.archiveId, startMs, endMs);
        exports.add(operation);
        void operation.then(() => exports.delete(operation), () => exports.delete(operation));
        return operation;
      },
      stop: () => stopping ??= Promise.allSettled([...exports]).then(() => stopRealtimeSpeechAudioSource()).finally(() => {
        subscriptions.forEach((subscription) => subscription.remove());
      }),
    };
  }
}

export const realtimeSpeechAudioSource: RealtimeSpeechAudioSource = new NativeRealtimeSpeechAudioSource();

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const maybeBuffer = (globalThis as any).Buffer;
  if (maybeBuffer?.from) {
    const buffer = maybeBuffer.from(base64, 'base64');
    return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
  }

  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes.buffer;
}
