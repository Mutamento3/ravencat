import type { AudioPlaybackKey, AudioPlaybackViewState } from '@shared/audio/AudioPlaybackState';
import { localAudioPlaybackPort, type LocalAudioPlaybackPort, type LocalAudioPlaybackSession } from './LocalAudioPlayback';

interface PlaybackRequest {
  key: AudioPlaybackKey;
  scope: string;
  durationMs: number;
  session: LocalAudioPlaybackSession | null;
  unsubscribe: (() => void) | null;
}

/** 聊天与通话记录共享一个本地播放器；业务 owner 只提供文件解析与开播后动作。 */
export class LocalAudioPlaybackCoordinator {
  private version = 0;
  private current: PlaybackRequest | null = null;
  private readonly states = new Map<AudioPlaybackKey, AudioPlaybackViewState>();
  private readonly listeners = new Map<AudioPlaybackKey, Set<(state: AudioPlaybackViewState) => void>>();
  constructor(private readonly player: LocalAudioPlaybackPort = localAudioPlaybackPort) {}

  subscribe(key: AudioPlaybackKey, durationMs: number, listener: (state: AudioPlaybackViewState) => void): () => void {
    let listeners = this.listeners.get(key);
    if (!listeners) { listeners = new Set(); this.listeners.set(key, listeners); }
    listeners.add(listener);
    listener(this.states.get(key) || { state: 'idle', positionMs: 0, durationMs });
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) {
        this.listeners.delete(key);
        if (this.current?.key !== key) this.states.delete(key);
      }
    };
  }

  async toggle(input: { key: AudioPlaybackKey; scope: string; durationMs: number; resolveUri(): Promise<string>; onStarted?(): void }): Promise<void> {
    const current = this.current;
    if (current?.key === input.key) {
      if (!current.session) { await this.stop(input.scope); return; }
      const state = this.states.get(input.key).state;
      if (state === 'playing') await current.session.pause();
      else if (state === 'paused') await current.session.resume();
      return;
    }
    const version = ++this.version;
    const request: PlaybackRequest = { key: input.key, scope: input.scope, durationMs: input.durationMs, session: null, unsubscribe: null };
    this.current = request;
    this.publish(input.key, { state: 'loading', positionMs: 0, durationMs: input.durationMs });
    try {
      if (current) await this.release(current, true);
      if (version !== this.version) return;
      const uri = await input.resolveUri();
      if (version !== this.version) return;
      const session = await this.player.play(uri);
      if (version !== this.version) { await session.stop(); return; }
      request.session = session;
      request.unsubscribe = session.subscribe(snapshot => {
        if (this.current !== request) return;
        this.publish(input.key, snapshot);
        if (snapshot.state === 'ended' || snapshot.state === 'error') {
          // 订阅可能同步重放末态；句柄赋值后才能完整解除订阅。
          void Promise.resolve().then(() => this.finish(request));
        }
      });
      input.onStarted?.();
    } catch (error) {
      if (version !== this.version) return;
      this.current = null;
      this.publish(input.key, { state: 'error', positionMs: 0, durationMs: input.durationMs,
        errorMessage: error instanceof Error ? error.message : '语音文件不可用' });
    }
  }

  async stop(scope?: string): Promise<void> {
    const current = this.current;
    if (!current || (scope !== undefined && scope !== current.scope)) return;
    this.version++;
    this.current = null;
    await this.release(current, true);
  }

  private async finish(request: PlaybackRequest): Promise<void> {
    if (this.current !== request) return;
    this.current = null;
    await this.release(request, false);
  }

  private async release(request: PlaybackRequest, reset: boolean): Promise<void> {
    request.unsubscribe?.();
    if (request.session) await request.session.stop();
    if (reset) this.publish(request.key, { state: 'idle', positionMs: 0, durationMs: request.durationMs });
    if (!this.listeners.has(request.key) && this.current?.key !== request.key) this.states.delete(request.key);
  }

  private publish(key: AudioPlaybackKey, state: AudioPlaybackViewState): void {
    this.states.set(key, state);
    this.listeners.get(key)?.forEach(listener => listener(state));
  }
}

export const localAudioPlaybackCoordinator = new LocalAudioPlaybackCoordinator();
