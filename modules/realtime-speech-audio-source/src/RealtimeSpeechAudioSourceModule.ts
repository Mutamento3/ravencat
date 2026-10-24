import {
  EventEmitter,
  NativeModule,
  requireNativeModule,
} from 'expo';

export type RealtimeSpeechAudioChunkEvent = {
  base64: string;
  sampleRate: number;
  channels: number;
  bytesPerSample: number;
  chunkIndex: number;
};

export type RealtimeSpeechDetectedEvent = {
  maxAmplitude: number;
  detectedAt: number;
};

export type RealtimeSpeechAudioErrorEvent = {
  message: string;
};

export type RealtimeSpeechAudioSourceSubscription = {
  remove(): void;
};

export type RealtimeSpeechAudioSourceStartResult = {
  echoCancellationEnabled: boolean;
  archiveId?: string | null;
};

type RealtimeSpeechAudioSourceEvents = {
  onAudioChunk: (event: RealtimeSpeechAudioChunkEvent) => void;
  onSpeechDetected: (event: RealtimeSpeechDetectedEvent) => void;
  onError: (event: RealtimeSpeechAudioErrorEvent) => void;
};

declare class RealtimeSpeechAudioSourceNativeModule extends NativeModule {
  start(options: {
    sampleRate: number;
    chunkDurationMs: number;
    archiveSegments?: boolean;
  }): Promise<RealtimeSpeechAudioSourceStartResult>;
  stop(): Promise<void>;
  isRecording(): Promise<boolean>;
  exportSegment(archiveId: string, startMs: number, endMs: number): Promise<{ uri: string; durationMs: number }>;
}

const NativeRealtimeSpeechAudioSource =
  requireNativeModule<RealtimeSpeechAudioSourceNativeModule>('RealtimeSpeechAudioSource');

const emitter = new EventEmitter<RealtimeSpeechAudioSourceEvents>(NativeRealtimeSpeechAudioSource);

export function startRealtimeSpeechAudioSource(options: {
  sampleRate: number;
  chunkDurationMs: number;
  archiveSegments?: boolean;
}): Promise<RealtimeSpeechAudioSourceStartResult> {
  return NativeRealtimeSpeechAudioSource.start(options);
}

export function stopRealtimeSpeechAudioSource(): Promise<void> {
  return NativeRealtimeSpeechAudioSource.stop();
}

export function exportRealtimeSpeechSegment(archiveId: string, startMs: number, endMs: number): Promise<{ uri: string; durationMs: number }> {
  return NativeRealtimeSpeechAudioSource.exportSegment(archiveId, startMs, endMs);
}

export function isRealtimeSpeechAudioSourceRecording(): Promise<boolean> {
  return NativeRealtimeSpeechAudioSource.isRecording();
}

export function addRealtimeSpeechAudioChunkListener(
  listener: (event: RealtimeSpeechAudioChunkEvent) => void
): RealtimeSpeechAudioSourceSubscription {
  return emitter.addListener('onAudioChunk', listener);
}

export function addRealtimeSpeechDetectedListener(
  listener: (event: RealtimeSpeechDetectedEvent) => void
): RealtimeSpeechAudioSourceSubscription {
  return emitter.addListener('onSpeechDetected', listener);
}

export function addRealtimeSpeechAudioErrorListener(
  listener: (event: RealtimeSpeechAudioErrorEvent) => void
): RealtimeSpeechAudioSourceSubscription {
  return emitter.addListener('onError', listener);
}

export default NativeRealtimeSpeechAudioSource;
