/** 摘要页面只订阅当前会话，迟到的旧读取不能覆盖新的任务终态。 */
import { useCallback, useEffect, useState } from 'react';
import { getChatSummaryContext } from '../application/ChatSummary';
import { subscribeChatSummaryChanged } from '../application/ChatSummaryRuntime';
import type { ChatSummarySnapshot } from '../domain/ChatSummaryRepository';
import { subscribeAuxiliaryModelsChanged } from '@features/assistants';

export function useChatSummarySnapshot(conversationId: string) {
  const [snapshot, setSnapshot] = useState<ChatSummarySnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => getChatSummaryContext(conversationId), [conversationId]);
  useEffect(() => {
    let active = true, revision = 0;
    const refresh = async () => {
      const current = ++revision;
      try {
        const value = await load();
        if (active && current === revision) { setSnapshot(value); setError(null); }
      } catch (failure) {
        if (active && current === revision) setError(failure instanceof Error ? failure.message : '读取摘要失败');
      }
    };
    void refresh();
    const unsubscribe = subscribeChatSummaryChanged((id) => { if (id === conversationId) void refresh(); });
    const models = subscribeAuxiliaryModelsChanged(() => { void refresh(); });
    return () => { active = false; unsubscribe(); models(); };
  }, [conversationId, load]);
  return { snapshot, error };
}
