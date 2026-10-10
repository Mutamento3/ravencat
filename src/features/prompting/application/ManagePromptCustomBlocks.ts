/** 只读提供 2.x 自定义片段给升级兼容链路；3.0 删除。 */

import type { PromptCustomBlock } from '../domain/Prompting';
import { getPromptingRuntimeDependencies } from './PromptingRuntimeDependencies';

export async function listPromptCustomBlocks(): Promise<PromptCustomBlock[]> {
  return getPromptingRuntimeDependencies().customBlocks.listCustomBlocks();
}
