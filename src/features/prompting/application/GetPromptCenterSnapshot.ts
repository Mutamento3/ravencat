/** 构建不读取真实聊天、记忆或协议正文的提示词中心只读快照。 */

import type { PromptDefinitionDescriptor } from '@shared/prompt';
import { getPromptingRuntimeDependencies } from './PromptingRuntimeDependencies';

export interface PromptCenterSnapshot {
  definitions: readonly PromptDefinitionDescriptor[];
}

export function getPromptCenterSnapshot(): PromptCenterSnapshot {
  return { definitions: getPromptingRuntimeDependencies().catalog.list() };
}
