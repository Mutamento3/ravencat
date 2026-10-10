/** 解析绑定并通过 Host 的同一编译入口生成即时预览，不持久化正文。 */

import type { PromptPack, PromptScenarioId } from '@shared/prompt';
import { getPromptingRuntimeDependencies } from './PromptingRuntimeDependencies';
import {
  resolveLegacyPromptPreset,
  type ResolvedPromptPreset,
} from './ResolveLegacyPromptPreset';

export interface PromptPackPreviewResult {
  pack: PromptPack;
  preset: ResolvedPromptPreset['preset'];
  bindingSource: ResolvedPromptPreset['source'];
  usedRealContext: boolean;
  privacyNotice: string;
}

export async function previewResolvedPromptPack(input: {
  scenarioId: PromptScenarioId;
  assistantId?: string | null;
  groupId?: string | null;
  exampleInput: string;
  useRealContext?: boolean;
}): Promise<PromptPackPreviewResult> {
  const exampleInput = input.exampleInput.trim();
  if (!exampleInput) throw new Error('请输入用于预览的示例输入');
  const dependencies = getPromptingRuntimeDependencies();
  const resolved = await resolveLegacyPromptPreset(input);
  const customBlocks = await dependencies.customBlocks.listCustomBlocks();
  const referencedIds = new Set(resolved.preset.items.map((item) => item.definitionId));
  const pack = await dependencies.preview.preview({
    scenarioId: input.scenarioId,
    assistantId: input.assistantId || null,
    groupId: input.groupId || null,
    exampleInput,
    useRealContext: input.useRealContext === true,
    preset: resolved.preset,
    customBlocks: customBlocks.filter((block) => referencedIds.has(block.id)),
  });
  return {
    pack,
    preset: resolved.preset,
    bindingSource: resolved.source,
    usedRealContext: input.useRealContext === true,
    privacyNotice: input.useRealContext
      ? '本次即时读取了允许的近期上下文；预览正文没有写入数据库。'
      : '安全预览未读取真实聊天、记忆或协议正文，动态 Provider 仅显示摘要。',
  };
}
