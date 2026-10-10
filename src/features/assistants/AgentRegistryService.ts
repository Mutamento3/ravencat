/** 汇总可协作 AI 助手及主理拉黑状态。 */
import type { AIProfile } from './domain/AIProfile';
import { aiAssistantRepository } from './infrastructure/SQLiteAssistantRepository';
import { aiHostRepository } from './infrastructure/SQLiteHostRepository';

export type AgentRegistryCollaborationState = 'self' | 'available' | 'blocked';

export interface AgentRegistryEntry {
  aiId: string;
  agentId: string;
  name: string;
  isHostAI: boolean;
  isLedgerAI: boolean;
  isBlocked: boolean;
  blockedUntil: string | null;
  blockReason: string | null;
  collaborationState: AgentRegistryCollaborationState;
  roleTags: string[];
}

export interface GetAgentRegistrySummaryOptions {
  currentAgentId?: string | null;
}

export interface AgentRegistrySummary {
  totalCount: number;
  availableCount: number;
  blockedCount: number;
  hostAgentId: string | null;
  hostAgentName: string | null;
  entries: AgentRegistryEntry[];
  text: string;
}

export class AgentRegistryService {
  async getSummary(
    options: GetAgentRegistrySummaryOptions = {}
  ): Promise<AgentRegistrySummary> {
    await aiHostRepository.cleanupExpiredBlocks();

    const assistants = await aiAssistantRepository.getAll();
    const currentAgentId = options.currentAgentId || null;
    const entries = assistants.map((assistant) =>
      this.#toRegistryEntry(assistant, currentAgentId)
    );

    const hostEntry = entries.find((entry) => entry.isHostAI) || null;
    const availableCount = entries.filter(
      (entry) => entry.collaborationState !== 'blocked'
    ).length;
    const blockedCount = entries.filter((entry) => entry.isBlocked).length;

    return {
      totalCount: entries.length,
      availableCount,
      blockedCount,
      hostAgentId: hostEntry?.agentId || null,
      hostAgentName: hostEntry?.name || null,
      entries,
      text: this.#buildSummaryText({
        totalCount: entries.length,
        availableCount,
        blockedCount,
        hostEntry,
        entries,
      }),
    };
  }

  #toRegistryEntry(
    assistant: AIProfile,
    currentAgentId: string | null
  ): AgentRegistryEntry {
    const isSelf = !!currentAgentId && assistant.agentId === currentAgentId;
    const isBlocked = assistant.isBlocked === true;
    const collaborationState: AgentRegistryCollaborationState = isBlocked
      ? 'blocked'
      : isSelf
        ? 'self'
        : 'available';

    const roleTags = [
      isSelf ? '你自己' : null,
      assistant.isHostAI ? '主理AI' : null,
      assistant.isLedgerAI ? '记账AI' : null,
      collaborationState === 'blocked'
        ? `已拉黑${assistant.blockedUntil ? `至 ${this.#formatTime(assistant.blockedUntil)}` : ''}`
        : collaborationState === 'self'
          ? '当前可用'
          : '可协作',
    ].filter((value): value is string => Boolean(value));

    return {
      aiId: assistant.id,
      agentId: assistant.agentId,
      name: assistant.name,
      isHostAI: assistant.isHostAI,
      isLedgerAI: assistant.isLedgerAI,
      isBlocked,
      blockedUntil: assistant.blockedUntil || null,
      blockReason: assistant.blockReason || null,
      collaborationState,
      roleTags,
    };
  }

  #buildSummaryText(params: {
    totalCount: number;
    availableCount: number;
    blockedCount: number;
    hostEntry: AgentRegistryEntry | null;
    entries: AgentRegistryEntry[];
  }): string {
    const { totalCount, availableCount, blockedCount, hostEntry, entries } = params;

    if (entries.length === 0) {
      return [
        '【AI 身份池摘要】',
        '- 当前系统内还没有可用的 AI 身份记录。',
      ].join('\n');
    }

    const headerLines = [
      '【AI 身份池摘要】',
      `- 当前系统内共有 ${totalCount} 个 AI；当前可用/可协作 ${availableCount} 个；已拉黑 ${blockedCount} 个。`,
      `- 当前主理AI：${hostEntry ? `${hostEntry.name}（${hostEntry.agentId}）` : '暂无'}`,
    ];

    const entryLines = entries.map((entry, index) => {
      const roleText = entry.roleTags.join(' / ');
      const reasonText =
        entry.isBlocked && entry.blockReason
          ? `；原因：${entry.blockReason}`
          : '';

      return `${index + 1}. ${entry.name}（${entry.agentId}） - ${roleText}${reasonText}`;
    });

    const footerLines = [
      '- 这份摘要用于告诉你系统里还有哪些 AI、谁是主理AI、谁当前不可协作。',
      '- 如果某个 AI 已被拉黑，就不要把它当作当前可协作对象或可继续参与的对象。',
      '- AI 基础身份信息应直接依赖这份摘要，而不是再额外调用助手列表工具。',
    ];

    return [...headerLines, ...entryLines, ...footerLines].join('\n');
  }

  #formatTime(value: string): string {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return value;
    }

    return date.toLocaleString('zh-CN', { hour12: false });
  }
}

export const agentRegistryService = new AgentRegistryService();

