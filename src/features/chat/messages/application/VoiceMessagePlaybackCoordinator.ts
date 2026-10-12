import { resolveMediaAsset } from '@features/media';
import {
  localAudioPlaybackPort,
  type LocalAudioPlaybackSession,
  type LocalAudioPlaybackSnapshot,
} from '@platform/device';

import { markVoiceMessagePlayed } from './MarkVoiceMessagePlayed';

export type VoiceMessagePlaybackViewState = LocalAudioPlaybackSnapshot | {
  state: 'idle' | 'loading';
  positionMs: number;
  durationMs: number;
};

type Listener = (state: VoiceMessagePlaybackViewState) => void;
export type VoicePlaybackTarget = { kind: 'message'; id: number; isIncoming: boolean } | { kind: 'favorite' | 'quote'; id: string };
export function getVoicePlaybackKey(target: VoicePlaybackTarget): number | string {
  return target.kind === 'message' ? target.id : `${target.kind}:${target.id}`;
}

class VoiceMessagePlaybackCoordinator {
  private requestVersion = 0;
  private active: { messageId: number | string; session: LocalAudioPlaybackSession; unsubscribe: () => void } | null = null;
  private readonly states = new Map<number | string, VoiceMessagePlaybackViewState>();
  private readonly listeners = new Map<number | string, Set<Listener>>();

  subscribe(messageId: number | string, durationMs: number, listener: Listener): () => void {
    let messageListeners = this.listeners.get(messageId);
    if (!messageListeners) {
      messageListeners = new Set();
      this.listeners.set(messageId, messageListeners);
    }
    messageListeners.add(listener);
    listener(this.states.get(messageId) || { state: 'idle', positionMs: 0, durationMs });
    return () => {
      messageListeners!.delete(listener);
      if (messageListeners!.size === 0) this.listeners.delete(messageId);
    };
  }

  async toggle(target: VoicePlaybackTarget, mediaAssetId: string, durationMs: number): Promise<void> {
    const messageId = getVoicePlaybackKey(target);
    if (this.active?.messageId === messageId) {
      const state = this.states.get(messageId);
      if (state?.state === 'playing') {
        await this.active.session.pause();
      } else if (state?.state === 'paused') {
        await this.active.session.resume();
      }
      return;
    }

    const requestVersion = ++this.requestVersion;
    await this.stopActive();
    this.publish(messageId, { state: 'loading', positionMs: 0, durationMs });
    try {
      const resolved = await resolveMediaAsset(mediaAssetId);
      if (requestVersion !== this.requestVersion) return;
      const session = await localAudioPlaybackPort.play(resolved.localUri);
      if (requestVersion !== this.requestVersion) {
        await session.stop();
        return;
      }
      const unsubscribe = session.subscribe((snapshot) => {
        this.publish(messageId, snapshot);
        if (snapshot.state === 'ended' || snapshot.state === 'error') {
          void this.releaseFinished(messageId);
        }
      });
      this.active = { messageId, session, unsubscribe };
      if (target.kind === 'message' && target.isIncoming) {
        void markVoiceMessagePlayed(target.id).catch((error) => {
          console.warn('[VoiceMessagePlayback] 写入已播放状态失败', error);
        });
      }
    } catch (error) {
      this.publish(messageId, {
        state: 'error',
        positionMs: 0,
        durationMs,
        errorMessage: error instanceof Error ? error.message : '语音文件不可用',
      });
    }
  }

  async stop(): Promise<void> {
    this.requestVersion += 1;
    await this.stopActive();
  }

  private async stopActive(): Promise<void> {
    const active = this.active;
    if (!active) return;
    this.active = null;
    active.unsubscribe();
    await active.session.stop();
    const previous = this.states.get(active.messageId);
    this.publish(active.messageId, {
      state: 'idle',
      positionMs: 0,
      durationMs: previous?.durationMs || 0,
    });
  }

  private async releaseFinished(messageId: number | string): Promise<void> {
    if (this.active?.messageId !== messageId) return;
    const active = this.active;
    this.active = null;
    active.unsubscribe();
    await active.session.stop();
  }

  private publish(messageId: number | string, state: VoiceMessagePlaybackViewState) {
    this.states.set(messageId, state);
    this.listeners.get(messageId)?.forEach((listener) => listener(state));
  }
}

export const voiceMessagePlaybackCoordinator = new VoiceMessagePlaybackCoordinator();
