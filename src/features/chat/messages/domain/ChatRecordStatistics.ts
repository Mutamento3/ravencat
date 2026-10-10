/** 只统计仍保存的单聊原文与调用用量，不使用摘要或展示分页。 */
export interface ChatRecordStatistics {
  userMessageCount: number;
  assistantMessageCount: number;
  userCharacterCount: number;
  assistantCharacterCount: number;
  totalTokens: number;
  promptTokens: number;
  completionTokens: number;
  assistantRepliesWithoutUsage: number;
}

export interface ChatStatistics extends ChatRecordStatistics {
  encounterStartedAt: string;
}

export function buildChatStatistics(records: ChatRecordStatistics, assistantCreatedAt: string): ChatStatistics {
  return {
    ...records,
    encounterStartedAt: assistantCreatedAt,
  };
}

/** 相遇天数按已经度过的完整 24 小时计算，当天显示 0 天。 */
export function getEncounterDays(startedAt: string, now: number): number {
  return Math.max(0, Math.floor((now - Date.parse(startedAt)) / 86_400_000));
}
