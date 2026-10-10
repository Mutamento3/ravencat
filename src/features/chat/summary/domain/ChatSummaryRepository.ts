/** 用户维护摘要；AI 只领取统一时间范围并原子追加，不拥有旧正文的编辑权限。 */
import type { ChatCanonicalCursor, ChatContextItem } from './ChatContext';
import type { CallSummarySource } from '@features/calls';
import type { ConversationContextItem } from './ChatSummaryTimeline';
/** 仅约束模型自动追加的正文，用户维护已有摘要不受此限制。 */
export const CHAT_SUMMARY_ADDITION_MAX_CHARACTERS = 500;
export const CHAT_SUMMARY_INPUT_MAX_CHARACTERS = 5000;
export interface ChatSummarySegment {
  id: string; conversationId: string; sequence: number; content: string;
  messageCount: number; batchSize: number | null; sourceStartAt: string | null; sourceEndAt: string | null;
  timeZone: string; createdAt: string; updatedAt: string;
}
export interface ChatSummaryCallBoundary { processedCallIds: string[]; historyStartsAfter: string | null }
export interface ChatSummarySnapshot {
  segments: ChatSummarySegment[]; raw: ChatContextItem[];
  pendingCalls: CallSummarySource[];
  timeline: ConversationContextItem[];
}
export interface ChatSummaryClaim {
  conversationId: string; claimId: string; generation: number; revision: number;
  previous: ChatSummarySegment[]; timeZone: string;
  fromCursor: ChatCanonicalCursor | null; toCursor: ChatCanonicalCursor | null; batchSize: number;
  messages: ConversationContextItem[];
  calls: CallSummarySource[];
}
export interface ChatSummaryAddition {
  id: string; content: string; messages: ConversationContextItem[];
}
export interface ChatSummaryModelInput {
  conversationId: string; timeZone: string; previous: ChatSummarySegment[];
  messages: ConversationContextItem[]; calls: CallSummarySource[];
  part: { index: number; total: number };
  earlierAdditionsReadOnly: string[];
}
export interface ChatSummaryRepository {
  readContext(conversationId: string, protectedMessageIds: readonly number[]): Promise<ChatSummarySnapshot>;
  listConversationIds(): Promise<string[]>;
  getNextWakeAt(): Promise<string | null>;
  claim(conversationId: string, batchSize: number, claimId: string, now: string, expiresAt: string, timeZone: string): Promise<ChatSummaryClaim | null>;
  renewClaim(claim: ChatSummaryClaim, now: string, expiresAt: string): Promise<boolean>;
  appendClaim(claim: ChatSummaryClaim, additions: readonly ChatSummaryAddition[], now: string): Promise<boolean>;
  releaseClaim(claim: ChatSummaryClaim): Promise<void>;
  create(conversationId: string, segmentId: string, content: string, now: string, timeZone: string): Promise<void>;
  edit(conversationId: string, segmentId: string, content: string, now: string): Promise<void>;
  delete(conversationId: string, segmentId: string): Promise<void>;
  clear(conversationId: string): Promise<void>;
}
