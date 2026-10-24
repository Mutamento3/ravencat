/** 摘要查询属于 Chat；工具运行提供可信 AI 身份，不能由模型指定其他会话。 */
import type { AgentToolExecutionContext, AgentToolExecutionResult } from '@shared/aiTools';
import { throwIfAbortSignalAborted } from '@shared/runtime/abortSignal';
import { ChatSummaryInputError, searchChatSummaries } from '../application/ChatSummary';
import type { ChatSummarySearchInput, ChatSummarySearchPage } from '../domain/ChatSummaryRepository';

export const SearchChatSummariesTool = {
  name: 'search_chat_summaries',
  definition: {
    name: 'search_chat_summaries',
    description: '查询自己与用户的单聊或仍参加群聊的已保存摘要，包括已归纳一级与二级。默认查询当前会话，可指定有权访问的来源会话ID。按讨论时间和关键词筛选，关键词匹配任一词。时间是讨论时间，手动记录按保存时间。关闭自动注入时仍可查询，分页传回nextOffset。',
    parameters: { type: 'object', properties: {
      conversationId: { type: 'string', description: '可选来源会话ID，只能访问自己的单聊与当前仍参加的群' },
      from: { type: 'string', description: '讨论范围开始时间，ISO 8601，建议携带时区' },
      to: { type: 'string', description: '讨论范围结束时间，ISO 8601，建议携带时区' },
      keywords: { type: 'array', minItems: 1, maxItems: 20, items: { type: 'string', minLength: 1 } },
      offset: { type: 'integer', minimum: 0 },
    }, required: [], additionalProperties: false },
  },
  async execute(input: ChatSummarySearchInput, context: AgentToolExecutionContext): Promise<AgentToolExecutionResult<ChatSummarySearchPage>> {
    throwIfAbortSignalAborted(context.abortSignal);
    try {
      const data = await searchChatSummaries(context.task.assistantId, { ...input,
        conversationId: input.conversationId ?? context.task.sessionId ?? undefined });
      return { status: 'success', data, modelContent: JSON.stringify(data) };
    } catch (error) {
      if (error instanceof ChatSummaryInputError) return { status: 'error', code: 'CHAT_SUMMARY_INPUT_ERROR', retryable: false, modelContent: error.message };
      throw error;
    }
  },
};
