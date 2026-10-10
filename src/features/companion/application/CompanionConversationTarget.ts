/** 解析 Companion 对话目标，并映射 Chat 请求所需的 AI 配置。 */

import type { AIProfile } from '@features/assistants';
import type { AIReplyConfig, ChatSession } from '@features/chat';
import { getCompanionRuntimeDependencies } from './CompanionRuntimeDependencies';

export type CompanionConversationTargetFailureReason =
  | 'host_ai_unavailable'
  | 'host_ai_blocked'
  | 'session_unavailable';

export interface CompanionConversationTarget {
  ai: AIProfile;
  session: ChatSession;
}

export type CompanionConversationTargetResult =
  | CompanionConversationTarget
  | {
      error: string;
      reason: CompanionConversationTargetFailureReason;
    };

export function buildCompanionAIRequestConfig(
  ai: AIProfile,
): AIReplyConfig {
  return {
    id: ai.id,
    agentId: ai.agentId,
    name: ai.name,
    avatar: ai.avatar,
    model: ai.model,
    apiKey: ai.apiKey || '',
    apiBaseUrl: ai.apiBaseUrl || '',
    temperature: ai.temperature,
    topP: ai.topP,
    maxTokens: ai.maxTokens,
    privateContextPrimaryLimit: ai.privateContextPrimaryLimit,
    privateContextSecondaryLimit: ai.privateContextSecondaryLimit,
    groupContextPrimaryLimit: ai.groupContextPrimaryLimit,
    groupContextSecondaryLimit: ai.groupContextSecondaryLimit,
    systemPrompt: ai.systemPrompt || undefined,
    enableTools: false,
    allowMultipleBubbles: ai.allowMultipleBubbles,
    isHostAI: ai.isHostAI,
    isBlocked: ai.isBlocked,
  };
}

export async function resolveCompanionConversationTarget(
  input: { aiId?: string } = {},
): Promise<CompanionConversationTargetResult> {
  const { assistants } = getCompanionRuntimeDependencies().repositories;
  const { chat } = getCompanionRuntimeDependencies();
  const ai = await assistants.getHostAI();

  if (!ai) {
    return {
      error: '请先设置主理 AI 后再继续。',
      reason: 'host_ai_unavailable',
    };
  }

  if (input.aiId && input.aiId !== ai.id) {
    return {
      error: '主理 AI 已更换，本次对话目标已失效。',
      reason: 'host_ai_unavailable',
    };
  }

  if (ai.isBlocked) {
    return {
      error: '当前主理 AI 已被限制，暂时无法继续。',
      reason: 'host_ai_blocked',
    };
  }

  const session = await chat.getCanonicalConversation(ai.id);
  if (!session) {
    return {
      error: '未找到主理 AI 的 canonical conversation。',
      reason: 'session_unavailable',
    };
  }

  return { ai, session };
}
