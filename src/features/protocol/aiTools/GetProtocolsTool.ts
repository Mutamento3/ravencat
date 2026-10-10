/**
 * @fileoverview 获取协议空间全部协议的 AI 工具
 * @module features/protocol/aiTools/GetProtocolsTool
 */

import type { ProtocolToolContext } from './ProtocolToolContext';
import type { Protocol } from '../domain/ProtocolRepository';

/**
 * 工具参数接口（本工具无参数）
 */
type GetProtocolsArgs = Record<string, never>;

/**
 * 工具执行结果接口
 */
interface GetProtocolsResult {
  success: boolean;
  message?: string;
  error?: string;
  data?: Protocol[];
}

/**
 * 工具定义（JSON Schema）
 */
export const definition = {
  name: 'getProtocols',
  description: '查看当前 AI 协议空间的全部条目及 ID，用于管理；正文已自动注入，不必为读正文查询。',
  parameters: {
    type: 'object',
    properties: {},
    required: [],
  },
};

/**
 * 执行工具
 * @param _args - 工具参数（本工具无参数）
 * @param context - 工具执行上下文
 * @returns 执行结果
 */
export async function execute(
  _args: GetProtocolsArgs,
  context: ProtocolToolContext
): Promise<GetProtocolsResult> {
  const aiAssistantId = context.getAIId();
  
  if (!aiAssistantId) {
    return { success: false, error: '未指定AI助手' };
  }

  try {
    const protocols = await context.repositories.protocol!.getByAI(aiAssistantId);

    if (protocols.length === 0) {
      return { success: true, message: '协议空间为空', data: [] };
    }

    const summary = protocols.map((p, i) =>
      `${i + 1}. ${p.content.substring(0, 30)}${p.content.length > 30 ? '...' : ''}${p.summary ? ` (${p.summary})` : ''}`
    ).join('\n');

    return {
      success: true,
      message: `共 ${protocols.length} 条协议:\n${summary}`,
      data: protocols
    };
  } catch (error) {
    console.error('[GetProtocolsTool] Failed:', error);
    return { success: false, error: '获取协议失败' };
  }
}

/**
 * 工具对象（定义 + 执行）
 */
export const GetProtocolsTool = {
  name: definition.name,
  definition,
  execute,
};
