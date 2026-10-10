import { EventEmitter, NativeModule, requireNativeModule } from 'expo-modules-core';

export type VoiceRecordingChunkEvent = {
  sessionId: string;
  base64: string;
  sampleRate: number;
  channels: number;
  bytesPerSample: number;
  chunkIndex: number;
};

export type VoiceRecordingErrorEvent = { sessionId: string; message: string };
export type VoiceRecordingResult = {
  sessionId: string;
  uri: string;
  mimeType: 'audio/wav';
  durationMs: number;
};
export type VoicePlaybackEvent = {
  playbackId: string;
  positionMs: number;
  durationMs: number;
};
export type VoicePlaybackErrorEvent = VoicePlaybackEvent & { message: string };
export type VoiceAudioSubscription = { remove(): void };

type VoiceMessageAudioEvents = {
  onRecordingChunk: (event: VoiceRecordingChunkEvent) => void;
  onRecordingError: (event: VoiceRecordingErrorEvent) => void;
  onPlaybackStarted: (event: VoicePlaybackEvent) => void;
  onPlaybackProgress: (event: VoicePlaybackEvent) => void;
  onPlaybackEnded: (event: VoicePlaybackEvent) => void;
  onPlaybackError: (event: VoicePlaybackErrorEvent) => void;
};

declare class VoiceMessageAudioNativeModule extends NativeModule {
  startRecording(options: { sessionId: string; sampleRate: number; chunkDurationMs: number }): Promise<void>;
  stopRecording(sessionId: string): Promise<VoiceRecordingResult>;
  cancelRecording(sessionId: string): Promise<void>;
  play(options: { playbackId: string; uri: string }): Promise<void>;
  pause(playbackId: string): Promise<void>;
  resume(playbackId: string): Promise<void>;
  stopPlayback(playbackId: string): Promise<void>;
  readMetadata(uri: string): Promise<{ durationMs: number }>;
  clearVoiceMessageAudioForFactoryReset(): Promise<void>;
}

const nativeModule = requireNativeModule<VoiceMessageAudioNativeModule>('VoiceMessageAudio');
const emitter = new EventEmitter<VoiceMessageAudioEvents>(nativeModule);

export const startVoiceRecording = nativeModule.startRecording.bind(nativeModule);
export const stopVoiceRecording = nativeModule.stopRecording.bind(nativeModule);
export const cancelVoiceRecording = nativeModule.cancelRecording.bind(nativeModule);
export const playVoiceAudio = nativeModule.play.bind(nativeModule);
export const pauseVoiceAudio = nativeModule.pause.bind(nativeModule);
export const resumeVoiceAudio = nativeModule.resume.bind(nativeModule);
export const stopVoiceAudioPlayback = nativeModule.stopPlayback.bind(nativeModule);
export const readVoiceAudioMetadata = nativeModule.readMetadata.bind(nativeModule);
export const clearVoiceMessageAudioForFactoryReset =
  nativeModule.clearVoiceMessageAudioForFactoryReset.bind(nativeModule);

export function addVoiceAudioListener<K extends keyof VoiceMessageAudioEvents>(
  eventName: K,
  listener: VoiceMessageAudioEvents[K]
): VoiceAudioSubscription {
  return emitter.addListener(eventName, listener);
}
