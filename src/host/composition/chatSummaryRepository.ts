/** 只读历史快照与前台摘要维护共用仓储；读取不依赖摘要队列已启动。 */
import { SQLiteChatSummaryRepository } from '@features/chat/composition';
import { callRepository } from '@features/calls/composition';

export const chatSummaryRepository = new SQLiteChatSummaryRepository((tx, conversationId, boundary) => callRepository.readSummarySources(tx, {
  chatSessionId: conversationId, excludedCallIds: boundary.processedCallIds, after: boundary.historyStartsAfter,
}));
