/** 封装 Android 原生通话音频播放模块，向通话应用层提供稳定接口。 */

import {
  addCallAudioPlaybackEndedListener,
  addCallAudioPlaybackErrorListener,
  playCallAudio,
  stopCallAudio,
  type CallAudioPlaybackSubscription,
} from '../../../../modules/call-audio-playback';
import { nativeCallRuntime, getNativeCallRoute, subscribeNativeCallRoute } from '../../../../modules/call-runtime';
import type {
  CallAudioPlaybackPort,
  CallAudioPlaybackSession,
  CallAudioRoute,
  CallAudioRouteState,
} from '../application/runtime/CallRuntimeDependencies';

class NativeCallAudioPlayback implements CallAudioPlaybackPort {
  async beginSession(callId: string): Promise<void> {
    await nativeCallRuntime.activate(callId);
  }

  async endSession(callId: string): Promise<void> {
    await nativeCallRuntime.releaseAudio(callId);
  }

  private active:
    | {
        playbackId: string;
        subscriptions: CallAudioPlaybackSubscription[];
        settle: (error?: Error) => void;
      }
    | null = null;

  async play(uri: string): Promise<CallAudioPlaybackSession> {
    await this.stop();

    const playbackId = `call_tts_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    let resolveFinished: () => void = () => undefined;
    let rejectFinished: (error: Error) => void = () => undefined;
    const finished = new Promise<void>((resolve, reject) => {
      resolveFinished = resolve;
      rejectFinished = reject;
    });

    const subscriptions: CallAudioPlaybackSubscription[] = [
      addCallAudioPlaybackEndedListener((event) => {
        if (event.playbackId !== playbackId) {
          return;
        }
        this.clearActive(playbackId);
        resolveFinished();
      }),
      addCallAudioPlaybackErrorListener((event) => {
        if (event.playbackId !== playbackId) {
          return;
        }
        this.clearActive(playbackId);
        rejectFinished(new Error(event.message || '通话语音播放失败'));
      }),
    ];

    const active = {
      playbackId,
      subscriptions,
      settle: (error?: Error) => {
        this.clearActive(playbackId);
        if (error) {
          rejectFinished(error);
          return;
        }
        resolveFinished();
      },
    };
    this.active = active;

    try {
      await playCallAudio({ uri, playbackId });
    } catch (error) {
      this.clearActive(playbackId);
      throw error;
    }

    return {
      playbackId,
      uri,
      finished,
      stop: async () => {
        if (this.active?.playbackId !== playbackId) {
          return;
        }
        await this.stop();
      },
    };
  }

  async stop(): Promise<void> {
    const active = this.active;
    if (!active) {
      await stopCallAudio();
      return;
    }

    await stopCallAudio();
    active.settle(new Error('通话语音播放已停止'));
  }

  getRouteState(): Promise<CallAudioRouteState | null> {
    return getNativeCallRoute();
  }

  subscribeRoute(listener: (state: CallAudioRouteState) => void): () => void {
    const subscription = subscribeNativeCallRoute(listener);
    return () => subscription.remove();
  }

  selectRoute(callId: string, route: CallAudioRoute): Promise<void> {
    return nativeCallRuntime.selectRoute(callId, route);
  }

  private clearActive(playbackId: string): void {
    if (this.active?.playbackId !== playbackId) {
      return;
    }

    const subscriptions = this.active.subscriptions;
    this.active = null;
    subscriptions.forEach((subscription) => subscription.remove());
  }
}

export const callAudioPlayback: CallAudioPlaybackPort = new NativeCallAudioPlayback();
