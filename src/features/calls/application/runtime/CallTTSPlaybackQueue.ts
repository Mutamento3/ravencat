/** 串行合成并播放通话语音，同时记录播放状态事件。 */

import { temporarySpeechAudioStore } from '@platform/device';
import { synthesizeTextToSpeech } from '@features/speech';
import type { CallSentenceSpeech } from './CallSpeechSentenceStream';
import { appendCallErrorEvent } from '../events/AppendCallSystemEvent';
import { publishCallTranscriptFact } from '../events/CallTranscriptFacts';
import {
  getCallRuntimeDependencies,
  type CallAudioPlaybackSession,
} from './CallRuntimeDependencies';

interface PlayCallAISpeechParams {
  callId: string;
  assistantId: string | null;
  text: string;
  /** 开场白是纯正文；实时回复附带已经验证的合成输入和本轮模型快照。 */
  speech?: CallSentenceSpeech;
  onPlaybackStarted?: () => void;
  onPlaybackEnded?: () => void;
}

interface ActivePlayback {
  callId: string;
  version: number;
  phase: 'synthesizing' | 'playing';
  abortController: AbortController;
  audioUri: string | null;
  playbackSession: CallAudioPlaybackSession | null;
  interrupted: boolean;
  /** 当前句文本，供打断事件与 UI 字幕推送使用。 */
  text: string;
}

/** 按句播放的 UI 同步事件；字幕契约要求每句开播即显示，不能等 events 轮询。 */
export type CallSentencePlaybackEvent =
  | { type: 'started'; callId: string; text: string }
  | { type: 'ended'; callId: string; text: string }
  | { type: 'interrupted'; callId: string; text: string };

type CallSentencePlaybackListener = (event: CallSentencePlaybackEvent) => void;

const sentencePlaybackListeners = new Set<CallSentencePlaybackListener>();

/** 订阅按句播放事件（全通话）；返回退订函数。presentation 用 callId 自行过滤。 */
export function subscribeCallSentencePlayback(
  listener: CallSentencePlaybackListener
): () => void {
  sentencePlaybackListeners.add(listener);
  return () => {
    sentencePlaybackListeners.delete(listener);
  };
}

function emitSentencePlayback(event: CallSentencePlaybackEvent): void {
  sentencePlaybackListeners.forEach((listener) => {
    try {
      listener(event);
    } catch (error) {
      console.warn('[CallTTSPlaybackQueue] Sentence playback listener failed:', error);
    }
  });
}

export class CallTTSPlaybackQueue {
  private queueByCallId = new Map<string, Promise<void>>();
  private versionByCallId = new Map<string, number>();
  private activePlayback: ActivePlayback | null = null;

  enqueueAISpeech(params: PlayCallAISpeechParams): Promise<void> {
    const text = params.text.trim();
    if (!text) {
      return Promise.resolve();
    }

    const version = this.getVersion(params.callId);
    const previous = this.queueByCallId.get(params.callId) || Promise.resolve();
    const next = previous
      .catch(() => undefined)
      .then(() => this.playAISpeech({ ...params, text }, version));

    this.queueByCallId.set(params.callId, next);
    void next.then(() => {
      this.clearQueuedCall(params.callId, next);
    }, () => {
      this.clearQueuedCall(params.callId, next);
    });
    return next;
  }

  private clearQueuedCall(callId: string, queued: Promise<void>): void {
    if (this.queueByCallId.get(callId) === queued) {
      this.queueByCallId.delete(callId);
    }
  }

  async interruptForUserSpeech(callId: string): Promise<boolean> {
    this.bumpVersion(callId);
    const active = this.activePlayback;
    if (!active || active.callId !== callId) {
      return false;
    }

    active.interrupted = true;
    active.abortController.abort();
    if (active.playbackSession) {
      await active.playbackSession.stop();
    } else {
      await getCallRuntimeDependencies().native.audioPlayback.stop();
    }
    await this.deleteAudio(active.audioUri);
    this.activePlayback = null;
    emitSentencePlayback({ type: 'interrupted', callId, text: active.text });
    await appendTtsEvent({
      callId,
      kind: 'ttsInterrupted',
      text: 'AI 语音播放被用户语音打断。',
      payload: {
        reason: 'userSpeech',
        phase: active.phase,
        interruptedText: active.text,
      },
    });
    return true;
  }

  async stopCallPlayback(callId: string): Promise<void> {
    this.bumpVersion(callId);
    const active = this.activePlayback;
    if (!active || active.callId !== callId) {
      return;
    }

    active.interrupted = true;
    active.abortController.abort();
    if (active.playbackSession) {
      await active.playbackSession.stop();
    } else {
      await getCallRuntimeDependencies().native.audioPlayback.stop();
    }
    await this.deleteAudio(active.audioUri);
    this.activePlayback = null;
    // 挂断清理：字幕区依赖该事件清除当前句。
    emitSentencePlayback({ type: 'interrupted', callId, text: active.text });
  }

  private async playAISpeech(params: PlayCallAISpeechParams, version: number): Promise<void> {
    if (version !== this.getVersion(params.callId)) {
      return;
    }

    const call = await getCallRuntimeDependencies().repositories.calls.getSessionById(params.callId);
    if (!call || call.state !== 'active') {
      return;
    }

    const abortController = new AbortController();
    const active: ActivePlayback = {
      callId: params.callId,
      version,
      phase: 'synthesizing',
      abortController,
      audioUri: null,
      playbackSession: null,
      interrupted: false,
      text: params.text,
    };
    this.activePlayback = active;
    let playbackStarted = false;

    try {
      const synthesis = await synthesizeTextToSpeech({
        text: params.speech?.synthesisText ?? params.text,
        assistantId: params.assistantId,
        consumer: 'call',
        modelSnapshot: params.speech?.modelSnapshot,
        signal: abortController.signal,
      });

      if (active.interrupted || version !== this.getVersion(params.callId)) {
        await this.deleteAudio(synthesis.audioUri);
        return;
      }

      if (!synthesis.success || !synthesis.audioUri) {
        await appendCallErrorEvent({
          callId: params.callId,
          text: synthesis.errorInfo?.message || synthesis.rawError || 'TTS 合成失败',
          payload: {
            type: 'ttsFailure',
            modelConfigId: synthesis.modelConfigId,
            modelConfigName: synthesis.modelConfigName,
          },
        });
        return;
      }

      active.phase = 'playing';
      active.audioUri = synthesis.audioUri;
      await appendTtsEvent({
        callId: params.callId,
        kind: 'ttsStarted',
        text: params.text,
        payload: {
          audioUri: synthesis.audioUri,
          mimeType: synthesis.mimeType,
          modelConfigId: synthesis.modelConfigId,
          modelConfigName: synthesis.modelConfigName,
          model: synthesis.model,
        },
      });

      playbackStarted = true;
      emitSentencePlayback({ type: 'started', callId: params.callId, text: params.text });
      params.onPlaybackStarted?.();
      const playbackSession = await getCallRuntimeDependencies().native.audioPlayback.play(synthesis.audioUri);
      active.playbackSession = playbackSession;
      await playbackSession.finished;

      if (active.interrupted || version !== this.getVersion(params.callId)) {
        await this.deleteAudio(synthesis.audioUri);
        return;
      }

      await appendTtsEvent({
        callId: params.callId,
        kind: 'ttsEnded',
        text: params.text,
        payload: {
          audioUri: synthesis.audioUri,
          playbackId: playbackSession.playbackId,
        },
      });
      emitSentencePlayback({ type: 'ended', callId: params.callId, text: params.text });
      await this.deleteAudio(synthesis.audioUri);
    } catch (error) {
      if (active.interrupted || abortController.signal.aborted) {
        await this.deleteAudio(active.audioUri);
        return;
      }

      if (playbackStarted) {
        // 播放中途失败：字幕区需要退出当前句。
        emitSentencePlayback({ type: 'interrupted', callId: params.callId, text: params.text });
      }
      await appendCallErrorEvent({
        callId: params.callId,
        text: error instanceof Error ? error.message : 'TTS 播放失败',
        payload: {
          type: 'ttsFailure',
          phase: active.phase,
        },
      });
    } finally {
      if (playbackStarted) {
        params.onPlaybackEnded?.();
      }
      if (this.activePlayback === active) {
        this.activePlayback = null;
      }
    }
  }

  private getVersion(callId: string): number {
    return this.versionByCallId.get(callId) || 0;
  }

  private bumpVersion(callId: string): void {
    this.versionByCallId.set(callId, this.getVersion(callId) + 1);
  }

  private async deleteAudio(uri: string | null): Promise<void> {
    try {
      await temporarySpeechAudioStore.deleteIfExists(uri);
    } catch (error) {
      console.warn('[CallTTSPlaybackQueue] Failed to delete temporary TTS audio:', error);
    }
  }
}

async function appendTtsEvent(params: {
  callId: string;
  kind: 'ttsStarted' | 'ttsInterrupted' | 'ttsEnded';
  text: string;
  payload?: Record<string, unknown>;
}): Promise<void> {
  const call = await getCallRuntimeDependencies().repositories.calls.getSessionById(params.callId);
  if (!call) {
    throw new Error(`Call ${params.callId} not found`);
  }

  const event = await getCallRuntimeDependencies().repositories.calls.appendEvent({
    callId: call.id,
    chatSessionId: call.chatSessionId,
    kind: params.kind,
    actorType: 'system',
    actorId: call.agentId,
    text: params.text,
    visibleInChat: false,
    includeInAIContext: true,
    payloadJson: params.payload ? JSON.stringify(params.payload) : null,
  });
  publishCallTranscriptFact(event);
}

export const callTTSPlaybackQueue = new CallTTSPlaybackQueue();
