import {
  addVoiceAudioListener,
  pauseVoiceAudio,
  playVoiceAudio,
  resumeVoiceAudio,
  stopVoiceAudioPlayback,
  type VoiceAudioSubscription,
} from '../../../modules/voice-message-audio';
import { createRandomUUID } from './randomUUID';

export type LocalAudioPlaybackState = 'playing' | 'paused' | 'ended' | 'error';
export type LocalAudioPlaybackSnapshot = {
  state: LocalAudioPlaybackState;
  positionMs: number;
  durationMs: number;
  errorMessage?: string;
};

export interface LocalAudioPlaybackSession {
  readonly playbackId: string;
  pause(): Promise<void>;
  resume(): Promise<void>;
  stop(): Promise<void>;
  subscribe(listener: (snapshot: LocalAudioPlaybackSnapshot) => void): () => void;
}

export interface LocalAudioPlaybackPort {
  play(uri: string): Promise<LocalAudioPlaybackSession>;
}

class NativeLocalAudioPlaybackPort implements LocalAudioPlaybackPort {
  async play(uri: string): Promise<LocalAudioPlaybackSession> {
    const playbackId = createRandomUUID();
    let snapshot: LocalAudioPlaybackSnapshot = { state: 'playing', positionMs: 0, durationMs: 0 };
    const listeners = new Set<(value: LocalAudioPlaybackSnapshot) => void>();
    const subscriptions: VoiceAudioSubscription[] = [];
    const publish = (value: LocalAudioPlaybackSnapshot) => {
      snapshot = value;
      listeners.forEach((listener) => listener(value));
    };
    const add = (
      eventName: 'onPlaybackStarted' | 'onPlaybackProgress' | 'onPlaybackEnded',
      state: LocalAudioPlaybackState
    ) => subscriptions.push(addVoiceAudioListener(eventName, (event) => {
      if (event.playbackId === playbackId) {
        publish({ state, positionMs: event.positionMs, durationMs: event.durationMs });
      }
    }));
    add('onPlaybackStarted', 'playing');
    add('onPlaybackProgress', 'playing');
    add('onPlaybackEnded', 'ended');
    subscriptions.push(addVoiceAudioListener('onPlaybackError', (event) => {
      if (event.playbackId === playbackId) {
        publish({
          state: 'error',
          positionMs: event.positionMs,
          durationMs: event.durationMs,
          errorMessage: event.message,
        });
      }
    }));

    try {
      await playVoiceAudio({ playbackId, uri });
    } catch (error) {
      subscriptions.forEach((subscription) => subscription.remove());
      throw error;
    }

    let active = true;
    const release = () => {
      if (!active) return false;
      active = false;
      subscriptions.forEach((subscription) => subscription.remove());
      listeners.clear();
      return true;
    };
    return {
      playbackId,
      pause: async () => {
        await pauseVoiceAudio(playbackId);
        publish({ ...snapshot, state: 'paused' });
      },
      resume: async () => {
        await resumeVoiceAudio(playbackId);
      },
      stop: async () => {
        if (release()) await stopVoiceAudioPlayback(playbackId);
      },
      subscribe: (listener) => {
        listeners.add(listener);
        listener(snapshot);
        return () => listeners.delete(listener);
      },
    };
  }
}

export const localAudioPlaybackPort: LocalAudioPlaybackPort = new NativeLocalAudioPlaybackPort();
