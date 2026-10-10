/** 重写只改变展示投影；旧回复直到新回复完整提交才从数据库移除。 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { ToastAndroid } from 'react-native';
import { getChatRegenerationState, regenerateChatReply } from '../../../reply/application/RegenerateChatReply';
import type { ChatRegenerationState } from '../../../reply/domain/ConversationTurn';
import type { ChatMessage } from '../../../messages/domain/ChatMessage';
import { setChatEventBus } from '../../../messages/events/ChatEvents';

const IDLE: ChatRegenerationState = { eligibleRunId: null, sourceRunId: null, hiddenMessageIds: [] };

export function useChatRegeneration(sessionId: string | undefined, refresh: () => Promise<void>) {
  const [state, setState] = useState(IDLE);
  const stateRef = useRef(state);
  const requesting = useRef<{ sessionId: string } | null>(null);
  const activeSession = useRef(sessionId);
  activeSession.current = sessionId;
  stateRef.current = state;

  useEffect(() => {
    let disposed = false;
    let revision = 0;
    setState(IDLE);
    if (!sessionId) return;
    const sync = async () => {
      const expectedRevision = ++revision;
      try {
        const next = await getChatRegenerationState(sessionId);
        if (disposed || expectedRevision !== revision) return;
        // 替换成功后的数据库刷新先于解除隐藏，避免旧 cache 在交接空窗闪回。
        if (stateRef.current.sourceRunId && !next.sourceRunId) await refresh();
        if (!disposed && expectedRevision === revision) setState(next);
      } catch (error) {
        console.error('[useChatRegeneration] 读取重写状态失败', error);
      }
    };
    const unsubscribe = setChatEventBus({
      emit: async (name, payload) => {
        if (payload.sessionId !== sessionId || name === 'typingStatusChanged' || name === 'groupSpeechPlanChanged') return;
        await sync();
        if (!disposed && payload.regenerationError) ToastAndroid.show(payload.regenerationError, ToastAndroid.LONG);
      },
    });
    void sync();
    return () => { disposed = true; unsubscribe(); };
  }, [sessionId, refresh]);

  const regenerate = useCallback(async (message: ChatMessage, messages: ChatMessage[]) => {
    if (!sessionId || requesting.current?.sessionId === sessionId) return;
    const request = { sessionId };
    requesting.current = request;
    setState({
      eligibleRunId: null,
      sourceRunId: message.turnRunId!,
      hiddenMessageIds: messages.filter((item) => item.turnRunId === message.turnRunId && item.turnItemIndex != null).map((item) => item.id),
    });
    try {
      await regenerateChatReply(sessionId, message.id);
    } catch (error) {
      if (activeSession.current !== sessionId || requesting.current !== request) return;
      setState(IDLE);
      ToastAndroid.show(error instanceof Error ? error.message : '重写失败，已恢复原消息', ToastAndroid.LONG);
    } finally {
      if (requesting.current === request) requesting.current = null;
    }
  }, [sessionId]);

  return { ...state, regenerate };
}
