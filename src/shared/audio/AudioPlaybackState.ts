/** 本地音频展示状态，不包含消息、通话或媒体资产的业务语义。 */
export interface AudioPlaybackViewState {
  state: 'idle' | 'loading' | 'playing' | 'paused' | 'ended' | 'error';
  positionMs: number;
  durationMs: number;
  errorMessage?: string;
}

export type AudioPlaybackKey = number | string;
export interface AudioPlaybackSubscription {
  subscribe(key: AudioPlaybackKey, durationMs: number, listener: (state: AudioPlaybackViewState) => void): () => void;
}
