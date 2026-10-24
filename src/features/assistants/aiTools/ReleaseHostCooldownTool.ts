/** 解除权只属于冷静期中的原主理 AI，调用者身份来自可信运行上下文。 */
import type { Tool, ToolContext } from '@shared/aiTools';
import { throwIfAbortSignalAborted } from '@shared/runtime/abortSignal';
import { releaseHostAICooldown } from '../AIAssistantManagement';

export const ReleaseHostCooldownTool: Tool<Record<string, never>, ToolContext> = {
  name: 'release_host_cooldown',
  definition: {
    name: 'release_host_cooldown',
    description: '你可以自主决定是否提前解除自己的七天冷静期。只有你同意解除时才调用；不同意无需调用，等待七天自然结束。解除后用户可以重新任命任意 AI，不会自动恢复你的主理身份。',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
  },
  async execute(_args, context) {
    throwIfAbortSignalAborted(context.abortSignal);
    const released = await releaseHostAICooldown(context.aiConfig.id, context.abortSignal);
    return released
      ? { success: true, message: '已解除你的主理 AI 冷静期。用户现在可以重新任命 AI；你仍是普通 AI，主理权限没有恢复。' }
      : { success: false, error: '你当前不处于可由自己解除的主理 AI 冷静期，未作任何修改。' };
  },
};
