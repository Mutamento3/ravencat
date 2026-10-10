/** 串联单次通话回复、语音播放和 AI 主动结束，避免终态早于最后一句。 */

import type { CallAIConfig } from '../../domain/CallAIConfig';
import type { CallSession } from '../../domain/CallSession';
import { aiCallRuntimeService } from './AICallRuntimeService';
import { callTTSPlaybackQueue } from './CallTTSPlaybackQueue';
import type { CallSentenceSpeech } from './CallSpeechSentenceStream';
import {
  assertCallReplyRunActive,
  beginCallReplyRun,
  CallReplyRunCancelledError,
  cancelCallReplyRun,
  finishCallReplyRun,
  isActiveCallReplyRun,
  isCallReplyCancellationError,
  setCallReplyRunPhase,
} from './CallReplyRunState';
import {
  processCallAIReply,
  type ProcessCallAIReplyResult,
} from './ProcessCallAIReply';

const AI_END_GRACE_MS = 1_500;

export type RunCallTurnResult = ProcessCallAIReplyResult & {
  endedCall?: CallSession;
};

export interface RunCallTurnParams {
  callId: string;
  userText: string;
  aiConfig: CallAIConfig;
  onPlaybackStarted?: () => void;
  onPlaybackEnded?: () => void;
}

interface CallTurnRuntimeDependencies {
  processReply: typeof processCallAIReply;
  enqueueSpeech(params: {
    callId: string;
    assistantId: string | null;
    text: string;
    speech: CallSentenceSpeech;
    onPlaybackStarted?: () => void;
    onPlaybackEnded?: () => void;
  }): Promise<void>;
  interruptForUserSpeech(callId: string): Promise<boolean>;
  endCall(callId: string): Promise<CallSession>;
  aiEndGraceMs: number;
}

export class CallTurnRuntimeService {
  constructor(private readonly dependencies: CallTurnRuntimeDependencies = {
    processReply: processCallAIReply,
    enqueueSpeech: (params) => callTTSPlaybackQueue.enqueueAISpeech(params),
    interruptForUserSpeech: (callId) => callTTSPlaybackQueue.interruptForUserSpeech(callId),
    endCall: async (callId) => (await aiCallRuntimeService.endCall(callId, 'aiEnded')).call,
    aiEndGraceMs: AI_END_GRACE_MS,
  }) {}

  async run(params: RunCallTurnParams): Promise<RunCallTurnResult> {
    const { runId, signal } = beginCallReplyRun(params.callId);
    // 逐句准流式：已经通过 Speech 文本边界的句子立即进入 TTS 队列；
    // 回合播放结束 = 全部句子 promise settle（正常播完、version 作废或被打断）。
    const sentencePromises: Promise<void>[] = [];
    let playbackStartedNotified = false;
    let playbackEndedNotified = false;
    const notifyPlaybackEndedOnce = () => {
      if (playbackStartedNotified && !playbackEndedNotified) {
        playbackEndedNotified = true;
        params.onPlaybackEnded?.();
      }
    };

    try {
      const reply = await this.dependencies.processReply({
        callId: params.callId,
        userText: params.userText,
        aiConfig: params.aiConfig,
        signal,
        onSpeechSentence: (sentence, speech) => {
          // run fence：回合被取代或取消后，迟到的句子不得再进入 TTS 队列。
          if (!isActiveCallReplyRun(params.callId, runId)) {
            return;
          }
          // 首句入队即进入 speaking 相位（TTS 合成或播放中都算）。
          setCallReplyRunPhase(params.callId, runId, 'speaking');
          const isFirstSentence = sentencePromises.length === 0;
          sentencePromises.push(this.dependencies.enqueueSpeech({
            callId: params.callId,
            assistantId: params.aiConfig.id,
            text: sentence,
            speech,
            onPlaybackStarted: isFirstSentence ? () => {
              playbackStartedNotified = true;
              params.onPlaybackStarted?.();
            } : undefined,
          }));
        },
      });

      // 等待本回合全部句子 settle，保持"回复 + 全部句子播放完毕"的回合原子性；
      // failed/cancelled 同样等待，避免 TTS 仍在播放就提前结束 duplex guard。
      await Promise.allSettled(sentencePromises);
      notifyPlaybackEndedOnce();
      if (reply.status !== 'completed') {
        return reply;
      }

      assertCallReplyRunActive(params.callId, runId);

      if (!reply.callEnded) {
        return reply;
      }

      await waitForAIEndGrace(params.callId, signal, this.dependencies.aiEndGraceMs);
      assertCallReplyRunActive(params.callId, runId);
      const endedCall = await this.dependencies.endCall(params.callId);
      return {
        ...reply,
        endedCall,
      };
    } catch (error) {
      if (isCallReplyCancellationError(error)) {
        return {
          status: 'cancelled',
          userEvent: null,
        };
      }
      throw error;
    } finally {
      notifyPlaybackEndedOnce();
      finishCallReplyRun(params.callId, runId);
    }
  }

  /**
   * 统一用户输入入口（architecture.md 5.5）：ASR 稳态文本与文字提交走同一路径。
   * - speaking：先走 TTS 打断边界（version bump 作废排队句子 + 停播 + 记录 ttsInterrupted）；
   * - generating：新回合 begin 时静默取代并 abort 在途回合，已落库用户事件保留；
   * - idle：直接开启新回合。文字不需要回声确认，直接打断。
   */
  async submitUserInput(params: RunCallTurnParams): Promise<RunCallTurnResult> {
    await this.dependencies.interruptForUserSpeech(params.callId);
    return this.run(params);
  }

  cancel(callId: string): boolean {
    return cancelCallReplyRun(callId);
  }
}

const callTurnRuntimeService = new CallTurnRuntimeService();

export function runCallTurn(params: RunCallTurnParams): Promise<RunCallTurnResult> {
  return callTurnRuntimeService.run(params);
}

export function submitCallUserInput(params: RunCallTurnParams): Promise<RunCallTurnResult> {
  return callTurnRuntimeService.submitUserInput(params);
}

export function cancelCallTurn(callId: string): boolean {
  return callTurnRuntimeService.cancel(callId);
}

function waitForAIEndGrace(
  callId: string,
  signal: AbortSignal,
  delayMs: number
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new CallReplyRunCancelledError(callId));
      return;
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', handleAbort);
      resolve();
    }, delayMs);
    const handleAbort = () => {
      clearTimeout(timer);
      reject(new CallReplyRunCancelledError(callId));
    };

    signal.addEventListener('abort', handleAbort, { once: true });
  });
}
