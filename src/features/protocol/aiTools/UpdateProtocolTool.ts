/**
 * @fileoverview 更新已有协议的 AI 工具
 * @module features/protocol/aiTools/UpdateProtocolTool
 */

import type { ProtocolToolContext } from './ProtocolToolContext';
import type { Protocol, UpdateProtocolInput } from '../domain/ProtocolRepository';
import { throwIfAbortSignalAborted } from '@shared/runtime/abortSignal';

/**
 * 工具参数接口
 */
interface UpdateProtocolArgs {
  protocolId: string;
  content?: string;
  summary?: string;
}

/**
 * 工具执行结果接口
 */
interface UpdateProtocolResult {
  success: boolean;
  message?: string;
  error?: string;
  data?: Partial<Protocol> & Pick<Protocol, 'id' | 'updatedAt'>;
}

/**
 * 工具定义（JSON Schema）
 */
export const definition = {
  name: 'updateProtocol',
  description: '修改协议空间的一条提示词或信息。',
  parameters: {
    type: 'object',
    properties: {
      protocolId: { type: 'string', description: '协议ID' },
      content: { type: 'string', description: '新协议内容' },
      summary: { type: 'string', description: '新协议摘要' },
    },
    required: ['protocolId'],
  },
};

/**
 * 执行工具
 * @param args - 工具参数
 * @param context - 工具执行上下文
 * @returns 执行结果
 */
export async function execute(
  args: UpdateProtocolArgs,
  context: ProtocolToolContext
): Promise<UpdateProtocolResult> {
  const { protocolId, content, summary } = args;

  if (!protocolId) {
    return { success: false, error: '缺少协议ID' };
  }

  const updates: UpdateProtocolInput = {};
  if (content !== undefined) updates.content = content;
  if (summary !== undefined) updates.summary = summary;

  if (Object.keys(updates).length === 0) {
    return { success: false, error: '没有要更新的内容' };
  }

  try {
    throwIfAbortSignalAborted(context.abortSignal);
    const protocol = await context.repositories.protocol!.update(protocolId, updates);

    return {
      success: true,
      message: '已更新协议',
      data: protocol
    };
  } catch (error) {
    throwIfAbortSignalAborted(context.abortSignal);
    console.error('[UpdateProtocolTool] Failed:', error);
    return { success: false, error: '更新协议失败' };
  }
}

/**
 * 工具对象（定义 + 执行）
 */
export const UpdateProtocolTool = {
  name: definition.name,
  definition,
  execute,
};
