import type { DatabaseTransactionExecutor } from '@platform/persistence';
import type { AgentToolExecutionContext, AgentToolExecutionResult, ToolDefinition } from '@shared/aiTools';
import { mediaImageFailure } from '@features/media';
import { changeOwnAvatarFromMediaAsset } from '../AIAssistantManagement';

export function createChangeOwnAvatarTool(assertCurrent: (transaction: DatabaseTransactionExecutor, context: AgentToolExecutionContext) => Promise<void>) {
  return {
    name: 'change_own_avatar',
    definition: {
      name: 'change_own_avatar', description: '使用 mediaAssetId 更换自己的头像。只能修改自己的头像，不能修改用户或其他 AI；不确定图片内容时先 view_image。',
      parameters: { type: 'object', properties: { media_asset_id: { type: 'string', minLength: 1, maxLength: 120 } },
        required: ['media_asset_id'], additionalProperties: false },
    } satisfies ToolDefinition,
    async execute(input: { media_asset_id: string }, context: AgentToolExecutionContext): Promise<AgentToolExecutionResult<unknown>> {
      try {
        const data = await changeOwnAvatarFromMediaAsset(context.task.assistantId, input.media_asset_id, tx => assertCurrent(tx, context));
        if (!data.changed) return { status: 'error', code: 'AVATAR_CHANGE_CONFLICT', retryable: false, modelContent: data.reason! };
        return { status: 'success', data, modelContent: JSON.stringify(data) };
      } catch (error) {
        const failure = mediaImageFailure(error);
        if (failure) return failure;
        throw error;
      }
    },
  };
}
