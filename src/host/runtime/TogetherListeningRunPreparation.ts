/**
 * 在一次真实模型 run 的 Host 准备阶段冻结 Together Listening 运行时事实。
 * Prompt 消费本轮冻结的运行时快照；Tool exposure 只裁决 Host 场景与持久权限，
 * 具体 Activity 状态由 Tool 执行时重新读取最新事实后裁决。
 */

import {
  captureTogetherListeningRuntimeSnapshot,
  reconcileTogetherListeningRuntime,
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
      && input.scenario !== 'raven_cat.ai_schedule_trigger')
  ) {
    return base;
  }

  const snapshot = await prepareTogetherListeningRuntimeSnapshot();
  if (snapshot.currentHostAiId !== input.currentAiId) {
    return base;
  }
  return {
    ...base,
    additionalPromptBlocks: [createTogetherListeningRuntimePromptBlock({
      snapshot,
      currentAiId: input.currentAiId,
      scenario: input.scenario,
    })],
    dynamicAllowedToolNames: TOGETHER_LISTENING_AI_TOOL_NAMES.filter((name) =>
      persistentNames.has(name)),
  };
}
