/** 用户维护摘要；AI 只领取统一时间范围并原子追加，不拥有旧正文的编辑权限。 */
import type { ChatCanonicalCursor, ChatContextItem } from './ChatContext';
import type { CallSummarySource } from '@features/calls';
import type { ConversationContextItem } from './ChatSummaryTimeline';
/** 包含首次请求，真正失败后只允许一次自动重试；取消不消耗失败预算。 */
export const CHAT_SUMMARY_MAX_AUTOMATIC_ATTEMPTS = 2;
export const CHAT_SUMMARY_INPUT_MAX_CHARACTERS = 5000;
export interface ChatSummarySegment {
  id: string; conversationId: string; sequence: number; content: string;
  level: 'primary' | 'secondary'; compactionId: string | null; contextSequence: number;
  messageCount: number; batchSize: number | null; sourceStartAt: string | null; sourceEndAt: string | null;
  timeZone: string; createdAt: string; updatedAt: string;
}
export interface ChatSummaryCallBoundary { processedCallIds: string[]; historyStartsAfter: string | null }
export interface ChatSummarySnapshot {
  tasks: ChatSummaryTask[];
  segments: ChatSummarySegment[]; raw: ChatContextItem[];
  settings: ChatSummarySettings; contextSegments: ChatSummarySegment[];
  pendingCalls: CallSummarySource[];
  timeline: ConversationContextItem[];
  fixedStart: { messageId: number; content: string; messageCount: number } | null;
}
export interface ChatSummarySettings {
  generationEnabled: boolean; injectEnabled: boolean;
  secondaryEnabled: boolean; secondaryTokenThreshold: number; fixedMessageId: number | null;
  requestTimeoutSeconds: number; maxOutputTokens: number | null;
  /** null 明确选择当前聊天模型／群管理员；非空值持续引用通用资产。 */
  modelConfigId: string | null; groupTriggerCount: number;
}
export type ChatSummarySettingsPatch = Partial<Omit<ChatSummarySettings, 'fixedMessageId'>>;
export const DEFAULT_CHAT_SUMMARY_SETTINGS: ChatSummarySettings = {
  generationEnabled: true, injectEnabled: true, secondaryEnabled: true, secondaryTokenThreshold: 8000, fixedMessageId: null,
  requestTimeoutSeconds: 300, maxOutputTokens: null,
  modelConfigId: null, groupTriggerCount: 40,
};
export type ChatSummaryLevel = 'primary' | 'secondary';
export interface ChatSummaryRequestSettings { requestTimeoutSeconds: number; maxOutputTokens: number | null; modelConfigId: string | null }
export interface ChatSummaryCallDiagnostics {
  httpStatus?: number | null;
  model: string; requestedMaxTokens: number | null; timeoutSeconds: number; durationMs: number;
  promptTokens: number | null; completionTokens: number | null; totalTokens: number | null; cachedTokens: number | null;
  finishReason: string | null; contentCharacters: number; reasoningCharacters: number; serverError: string | null;
}
export interface ChatSummaryFailure { kind: 'timeout' | 'request' | 'output_limit' | 'empty_output' | 'invalid_output'; message: string; retryable: boolean }
export interface ChatSummaryTask {
  id: string; conversationId: string; level: ChatSummaryLevel;
  status: 'running' | 'waiting' | 'failed' | 'completed';
  attemptCount: number; automaticFailures: number; nextAttemptAt: string | null;
  error: (ChatSummaryFailure & { occurredAt: string }) | null; calls: ChatSummaryCallDiagnostics[]; segmentIds: string[];
  createdAt: string; updatedAt: string;
}
export class ChatSummaryGenerationError extends Error {
  constructor(readonly failure: ChatSummaryFailure) { super(failure.message); }
}
export interface ChatSummaryTaskClaim { conversationId: string; claimId: string; generation: number; taskId: string }
export interface SecondaryChatSummaryClaim {
  requestSettings: ChatSummaryRequestSettings;
  taskId: string;
  conversationId: string; claimId: string; generation: number;
  segments: ChatSummarySegment[]; timeZone: string;
}
export interface ChatSummarySearchInput {
  conversationId?: string;
  from?: string; to?: string; keywords?: string[]; offset?: number;
}
export interface ChatSummarySearchPage {
  entries: ChatSummarySegment[]; nextOffset: number | null;
}
export interface ChatSummaryClaim {
  requestSettings: ChatSummaryRequestSettings;
  taskId: string;
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
export interface ChatBackgroundContextOptions {
  privateLimit: number; groupLimit: number;
  upperBound?: { messageId: number; createdAt: string };
}
export interface ChatBackgroundContext {
  conversationId: string; kind: 'direct' | 'group'; name: string;
  timeline: ConversationContextItem[]; contextSegments: ChatSummarySegment[];
}
export interface ChatSummaryRepository {
  invalidateModelReferencesInTransaction(transaction: import('@platform/persistence').DatabaseTransactionExecutor, modelConfigId: string): Promise<void>;
  readBackgroundContexts(assistantId: string, currentConversationId: string, options: ChatBackgroundContextOptions): Promise<ChatBackgroundContext[]>;
  readContext(conversationId: string, protectedMessageIds: readonly number[]): Promise<ChatSummarySnapshot>;
  prepareConversations(now: string): Promise<{ conversationIds: string[]; pausedConversationIds: string[] }>;
  getNextWakeAt(): Promise<string | null>;
  claim(conversationId: string, batchSize: number, claimId: string, now: string, expiresAt: string, timeZone: string): Promise<ChatSummaryClaim | null>;
  renewClaim(claim: ChatSummaryClaim | SecondaryChatSummaryClaim, now: string, expiresAt: string): Promise<boolean>;
  appendClaim(claim: ChatSummaryClaim, additions: readonly ChatSummaryAddition[], now: string): Promise<boolean>;
  releaseClaim(claim: ChatSummaryClaim): Promise<void>;
  readSettings(conversationId: string): Promise<ChatSummarySettings>;
  updateSettings(conversationId: string, patch: ChatSummarySettingsPatch): Promise<void>;
  setFixedStart(conversationId: string, messageId: number | null): Promise<void>;
  recordInvocation(claim: ChatSummaryTaskClaim, diagnostics: ChatSummaryCallDiagnostics, now: string): Promise<void>;
  failTask(claim: ChatSummaryTaskClaim, failure: ChatSummaryFailure, now: string): Promise<boolean>;
  retryTask(conversationId: string, taskId: string, now: string): Promise<void>;
  claimSecondary(conversationId: string, claimId: string, now: string, expiresAt: string, timeZone: string): Promise<SecondaryChatSummaryClaim | null>;
  appendSecondary(claim: SecondaryChatSummaryClaim, segmentId: string, content: string, now: string): Promise<boolean>;
  releaseSecondaryClaim(claim: SecondaryChatSummaryClaim): Promise<void>;
  search(assistantId: string, input: ChatSummarySearchInput): Promise<ChatSummarySearchPage>;
  create(conversationId: string, segmentId: string, content: string, now: string, timeZone: string): Promise<void>;
  edit(conversationId: string, segmentId: string, content: string, now: string): Promise<void>;
  replaceSecondary(conversationId: string, expected: readonly ChatSummarySegment[], content: string | null, now: string): Promise<void>;
  delete(conversationId: string, segmentId: string): Promise<void>;
  clear(conversationId: string): Promise<void>;
}
