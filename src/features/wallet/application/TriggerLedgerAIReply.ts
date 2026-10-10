import type { AIProfile, IAIHostRepository } from '@features/assistants';
import type { WalletRecord } from '../domain/WalletRecord';
import { getRecordsSummary } from '../domain/WalletRecord';
import type { ILedgerRepository } from '../domain/LedgerRepository';

export interface LedgerAIReplyPayload {
  aiId: string;
  agentId: string;
  aiName: string;
  aiAvatar: string | null;
  sessionId: string;
  message: string;
  newRecords: WalletRecord[];
}

export interface TriggerLedgerAIReplyParams {
  aiProfile: AIProfile;
  newRecords: WalletRecord[];
}

export interface TriggerLedgerAIReplyResult {
  success: boolean;
  payload: LedgerAIReplyPayload | null;
  error: string | null;
}

export interface WalletChatReplyRequest {
  aiProfile: AIProfile;
  prompt: string;
  newRecords: WalletRecord[];
}

export interface WalletChatReplyResult {
  sessionId: string | null;
  text: string;
  error: string | null;
}

export interface WalletChatReplyGateway {
  generateReply(request: WalletChatReplyRequest): Promise<WalletChatReplyResult>;
}

export interface TriggerLedgerAIReplyDeps {
  hostRepository: Pick<IAIHostRepository, 'cleanupExpiredBlocks' | 'isAIBlocked'>;
  ledgerRepository: ILedgerRepository;
  chatReplyGateway: WalletChatReplyGateway;
}

export async function triggerLedgerAIReply(
  params: TriggerLedgerAIReplyParams,
  deps: TriggerLedgerAIReplyDeps
): Promise<TriggerLedgerAIReplyResult> {
  const { aiProfile, newRecords } = params;

  if (newRecords.length === 0) {
    return { success: false, payload: null, error: '缺少新记账记录' };
  }

  if (!aiProfile.apiKey || !aiProfile.model) {
    return { success: false, payload: null, error: '记账 AI 缺少模型或 API Key 配置' };
  }

  await deps.hostRepository.cleanupExpiredBlocks();
  const blockedState = await deps.hostRepository.isAIBlocked(aiProfile.id);
  if (aiProfile.isBlocked || blockedState.isBlocked) {
    return { success: false, payload: null, error: '记账 AI 当前已被拉黑，已跳过自动回复' };
  }

  const prompt = await buildLedgerAIPrompt(newRecords, deps.ledgerRepository);
  const chatReply = await deps.chatReplyGateway.generateReply({ aiProfile, prompt, newRecords });

  if (chatReply.error || !chatReply.sessionId) {
    return {
      success: false,
      payload: null,
      error: chatReply.error || '无法为记账 AI 准备会话',
    };
  }

  if (!chatReply.text.trim()) {
    return {
      success: false,
      payload: null,
      error: '记账 AI 未生成可用回复',
    };
  }

  return {
    success: true,
    payload: {
      aiId: aiProfile.id,
      agentId: aiProfile.agentId,
      aiName: aiProfile.name,
      aiAvatar: aiProfile.avatar ?? null,
      sessionId: chatReply.sessionId,
      message: chatReply.text,
      newRecords,
    },
    error: null,
  };
}

async function buildLedgerAIPrompt(
  newRecords: WalletRecord[],
  ledgerRepository: ILedgerRepository
): Promise<string> {
  const batchIds = new Set(newRecords.map((record) => record.id));
  const targetDate = newRecords[0]?.recordDate;

  const sameDayRecords = targetDate
    ? await ledgerRepository.getRecords({
        startDate: targetDate,
        endDate: targetDate,
        limit: 30,
      })
    : [];

  const earlierRecords = sameDayRecords
    .filter((record) => !batchIds.has(record.id))
    .slice(0, 8);

  const batchExpense = sumAmount(newRecords, 'expense');
  const batchIncome = sumAmount(newRecords, 'income');

  const lines = [
    '你正在接收一条来自“羽库”记账应用的自动触发消息。',
    '这不是用户在聊天框里主动提问，而是用户刚刚连续新增了若干条记账记录。',
    '',
    '【本次新增记录｜最高优先级】',
    `记录日期：${targetDate || '未知'}`,
    `新增笔数：${newRecords.length}`,
    `本批次支出合计：¥${batchExpense.toFixed(2)}`,
    `本批次收入合计：¥${batchIncome.toFixed(2)}`,
    formatDetailedRecords(newRecords),
    '',
    '【今日较早记录｜低优先级参考】',
    earlierRecords.length > 0
      ? `${getRecordsSummary(earlierRecords)}\n${formatCompactRecords(earlierRecords)}`
      : '今天更早的记录暂无，或无需参考。',
    '',
    '【回复要求】',
    '1. 主要围绕“本次新增记录”回应，今日较早记录只能作为低权重背景。',
    '2. 保持你自己的人设和语气，自然、口语化、像对用户说话。',
    '3. 回复控制在 1~3 句，不要写成长报告，不要使用项目符号。',
    '4. 不要假装自己看到了未提供的数据；如果需要更多信息，可以使用账本工具。',
    '5. 如果用户明显是在连续补记多条账，就把这批记录当成一次整体行为来回应。',
  ];

  return lines.join('\n');
}

function formatDetailedRecords(records: WalletRecord[]): string {
  return records
    .map((record, index) => {
      const typeLabel = record.type === 'expense' ? '支出' : '收入';
      const detail = record.detail ? `（${record.detail}）` : '';
      return `${index + 1}. ${typeLabel} ${record.category}${detail} ¥${record.amount.toFixed(2)}`;
    })
    .join('\n');
}

function formatCompactRecords(records: WalletRecord[]): string {
  return records
    .slice(0, 6)
    .map((record) => {
      const detail = record.detail ? `（${record.detail}）` : '';
      return `- ${record.category}${detail} ¥${record.amount.toFixed(2)}`;
    })
    .join('\n');
}

function sumAmount(records: WalletRecord[], type: WalletRecord['type']): number {
  return records
    .filter((record) => record.type === type)
    .reduce((total, record) => total + record.amount, 0);
}
