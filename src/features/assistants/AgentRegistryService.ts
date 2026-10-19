/** 汇总可协作 AI 助手及主理拉黑状态。 */
import type { AIProfile } from './domain/AIProfile';
import { aiAssistantRepository } from './infrastructure/SQLiteAssistantRepository';
import { aiHostRepository } from './infrastructure/SQLiteHostRepository';

export type AgentRegistryCollaborationState = 'self' | 'available' | 'blocked';

export interface AgentRegistryEntry {
  aiId: string;
  agentId: string;
  name: string;
  model: string;
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
  excludedAssistantIds?: readonly string[];
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

    const [assistants, cooldown] = await Promise.all([
      aiAssistantRepository.getAll(), aiHostRepository.checkHostCooldown(),
    ]);
    const currentAgentId = options.currentAgentId || null;
    const excludedIds = new Set(options.excludedAssistantIds);
    const entries = assistants.filter((assistant) => !excludedIds.has(assistant.id)).map((assistant) =>
      this.#toRegistryEntry(assistant, currentAgentId, cooldown.isInCooldown && cooldown.revokedAIId === assistant.id)
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
        isInHostCooldown: cooldown.isInCooldown,
      }),
    };
  }

  #toRegistryEntry(
    assistant: AIProfile,
    currentAgentId: string | null,
    isInHostCooldown: boolean,
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
      isInHostCooldown ? '已被移除主理ai身份，当前处于冷静期' : null,
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
      model: assistant.model,
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
    isInHostCooldown: boolean;
  }): string {
    const { totalCount, availableCount, blockedCount, hostEntry, entries } = params;

    if (entries.length === 0) {
      return [
        '【AI 身份池摘要】',
        '- 当前身份池内没有入选的 AI 身份记录。',
      ].join('\n');
    }

    const headerLines = [
      '【AI 身份池摘要】',
      `- 当前身份池内共有 ${totalCount} 个 AI；当前可用/可协作 ${availableCount} 个；已拉黑 ${blockedCount} 个。`,
      `- 身份池中的主理AI：${hostEntry ? `${hostEntry.name}（${hostEntry.agentId}）` : '无'}`,
      ...(params.isInHostCooldown ? ['- 当前主理任命处于冷静期，期间不能任命或恢复任何主理 AI。'] : []),
    ];

    const entryLines = entries.map((entry, index) => {
      const roleText = entry.roleTags.join(' / ');
      const reasonText =
        entry.isBlocked && entry.blockReason
          ? `；原因：${entry.blockReason}`
          : '';

      return `${index + 1}. ${entry.name}（${entry.agentId}）；底层模型：${entry.model} - ${roleText}${reasonText}`;
    });

    const footerLines = [
      '- 这份摘要只列出用户选入身份池的 AI 及其底层模型、身份和协作状态，不代表系统内全部 AI。',
      '- 已被拉黑的 AI 无法继续交流或协作。',
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

