import { EventEmitter, NativeModule, requireNativeModule } from 'expo-modules-core';

export type CallAudioPlaybackEndedEvent = {
  playbackId: string;
  uri: string;
};

export type CallAudioPlaybackErrorEvent = {
  playbackId: string;
  uri: string;
  message: string;
};

export type CallAudioPlaybackSubscription = {
  remove: () => void;
};

type CallAudioPlaybackEvents = {
  onPlaybackEnded: (event: CallAudioPlaybackEndedEvent) => void;
  onPlaybackError: (event: CallAudioPlaybackErrorEvent) => void;
};

declare class CallAudioPlaybackNativeModule extends NativeModule {
  play(options: { uri: string; playbackId: string }): Promise<void>;
  stop(): Promise<void>;
}

const NativeCallAudioPlayback =
  requireNativeModule<CallAudioPlaybackNativeModule>('CallAudioPlayback');

const emitter = new EventEmitter<CallAudioPlaybackEvents>(NativeCallAudioPlayback);

export function playCallAudio(options: {
  uri: string;
  playbackId: string;
}): Promise<void> {
  return NativeCallAudioPlayback.play(options);
}

export function stopCallAudio(): Promise<void> {
  return NativeCallAudioPlayback.stop();
}

export function addCallAudioPlaybackEndedListener(
  listener: (event: CallAudioPlaybackEndedEvent) => void
): CallAudioPlaybackSubscription {
  return emitter.addListener('onPlaybackEnded', listener);
}

export function addCallAudioPlaybackErrorListener(
  listener: (event: CallAudioPlaybackErrorEvent) => void
): CallAudioPlaybackSubscription {
  return emitter.addListener('onPlaybackError', listener);
}

export default NativeCallAudioPlayback;
