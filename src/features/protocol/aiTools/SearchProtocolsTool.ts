/**
 * @fileoverview 按关键词搜索协议的 AI 工具
 * @module features/protocol/aiTools/SearchProtocolsTool
 */

import type { ProtocolToolContext } from './ProtocolToolContext';
import type { Protocol } from '../domain/ProtocolRepository';

/**
 * 工具参数接口
 */
interface SearchProtocolsArgs {
  keyword: string;
}

/**
 * 工具执行结果接口
 */
interface SearchProtocolsResult {
  success: boolean;
  message?: string;
  error?: string;
  data?: Protocol[];
}

/**
 * 工具定义（JSON Schema）
 */
export const definition = {
  name: 'searchProtocols',
  description: '按关键词查找协议空间条目及 ID；正文已自动注入。',
  parameters: {
    type: 'object',
    properties: {
      keyword: { type: 'string', description: '搜索关键词' },
    },
    required: ['keyword'],
  },
};

/**
 * 执行工具
 * @param args - 工具参数
 * @param context - 工具执行上下文
 * @returns 执行结果
 */
export async function execute(
  args: SearchProtocolsArgs,
  context: ProtocolToolContext
): Promise<SearchProtocolsResult> {
  const aiAssistantId = context.getAIId();
  const { keyword } = args;

  if (!aiAssistantId) {
    return { success: false, error: '未指定AI助手' };
  }

  if (!keyword) {
    return { success: false, error: '缺少搜索关键词' };
  }

  try {
    const protocols = await context.repositories.protocol!.search(aiAssistantId, keyword);

    if (protocols.length === 0) {
      return { success: true, message: `未找到包含"${keyword}"的协议`, data: [] };
    }

    const summary = protocols.map((p, i) =>
      `${i + 1}. ${p.content}`
    ).join('\n');

    return {
      success: true,
      message: `找到 ${protocols.length} 条相关协议:\n${summary}`,
      data: protocols
    };
  } catch (error) {
    console.error('[SearchProtocolsTool] Failed:', error);
    return { success: false, error: '搜索协议失败' };
  }
}

/**
 * 工具对象（定义 + 执行）
 */
export const SearchProtocolsTool = {
  name: definition.name,
  definition,
  execute,
};
