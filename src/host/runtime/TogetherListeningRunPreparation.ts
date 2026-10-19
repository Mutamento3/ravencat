/**
 * 在一次真实模型 run 的 Host 准备阶段冻结 Together Listening 运行时事实。
 * Prompt 消费本轮冻结的运行时快照；Tool exposure 只裁决 Host 场景与持久权限，
 * 具体 Activity 状态由 Tool 执行时重新读取最新事实后裁决。
 */

import {
  captureTogetherListeningRuntimeSnapshot,
  reconcileTogetherListeningRuntime,
  readTogetherListeningCurrentLyric,
  type TogetherListeningRuntimeSnapshot,
} from '@features/togetherListening';
import type {
  HostModelRunPreparationInput,
  HostModelRunPreparationResult,
} from '@shared/aiTools';
import { createTogetherListeningRuntimePromptBlock } from '../prompt/TogetherListeningPromptBlock';

export const TOGETHER_LISTENING_AI_TOOL_NAMES = [
  'invite_listening_together',
  'respond_to_listening_invitation',
  'leave_listening_together',
] as const;

export async function prepareTogetherListeningRuntimeSnapshot(): Promise<TogetherListeningRuntimeSnapshot> {
  const captured = await captureTogetherListeningRuntimeSnapshot();
  return reconcileTogetherListeningRuntime(captured);
}

export async function prepareTogetherListeningHostModelRun(
  input: HostModelRunPreparationInput,
): Promise<HostModelRunPreparationResult> {
  const persistentNames = new Set(input.persistentAllowedToolNames);
  const base = {
    managedToolNames: TOGETHER_LISTENING_AI_TOOL_NAMES,
    dynamicAllowedToolNames: [] as string[],
    additionalPromptBlocks: [],
  };
  if (
    !input.isHostAI
    || (input.scenario !== 'chat.private_reply'
      && input.scenario !== 'chat.group_member_reply'
      && input.scenario !== 'raven_cat.ai_schedule_trigger')
  ) {
    return base;
  }

  const snapshot = await prepareTogetherListeningRuntimeSnapshot();
  if (snapshot.currentHostAiId !== input.currentAiId) {
    return base;
  }
  const additionalPromptBlocks: HostModelRunPreparationResult['additionalPromptBlocks'] = [];
  // 邀请只通过聊天历史和工具结果表达；实时歌曲资料仅属于已开始的共同活动。
  if (snapshot.activity?.hostAiId === input.currentAiId && snapshot.activity.phase === 'active') {
    const currentLyric = await readTogetherListeningCurrentLyric(snapshot.netease, snapshot.capturedAtEpochMs);
    additionalPromptBlocks.push(createTogetherListeningRuntimePromptBlock({
      snapshot: { ...snapshot, currentLyric },
      scenario: input.scenario,
    }));
  }
  return {
    ...base,
    additionalPromptBlocks,
    dynamicAllowedToolNames: TOGETHER_LISTENING_AI_TOOL_NAMES.filter((name) =>
      persistentNames.has(name)),
  };
}
