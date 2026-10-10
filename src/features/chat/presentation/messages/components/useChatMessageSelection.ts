/** 多选只拥有页面状态；整轮记录展开与持久化删除归 application。 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BackHandler, ToastAndroid } from 'react-native';
import { showAppDialog } from '@shared/ui';
import type { ChatMessage } from '../../../messages/domain/ChatMessage';
import { canSelectChatMessage, getChatSelectionKey, MAX_CHAT_SELECTION_UNITS, toggleChatSelection, type ChatSelectionUnit } from '../../../messages/domain/ChatMessageSelection';
import { deleteChatSelection } from '../../../messages/application/DeleteChatSelection';

export function useChatMessageSelection({ sessionId, isActive, messages, hiddenRunId, onDeleted }: {
  sessionId: string | undefined;
  isActive: boolean;
  messages: readonly ChatMessage[];
  hiddenRunId?: string | null;
  onDeleted: (ids: readonly number[]) => void;
}) {
  const [selecting, setSelecting] = useState(false);
  const [selectedUnits, setSelectedUnits] = useState<readonly ChatSelectionUnit[]>([]);
  const [isDeleting, setIsDeleting] = useState(false);
  const selectionRef = useRef(selectedUnits);
  const currentSession = useRef(sessionId);
  currentSession.current = sessionId;
  const deletion = useRef<object | null>(null);
  const availableUnits = useMemo(() => {
    const units = new Map<string, ChatSelectionUnit>();
    for (const message of messages) {
      if (!canSelectChatMessage(message) || (hiddenRunId && message.turnRunId === hiddenRunId)) continue;
      const key = getChatSelectionKey(message);
      if (!units.has(key)) units.set(key, { key, anchorMessageId: message.id });
    }
    return units;
  }, [messages, hiddenRunId]);
  const availableKeys = useMemo(() => new Set(availableUnits.keys()), [availableUnits]);
  const units = useMemo(() => selectedUnits.flatMap((unit) => { const available = availableUnits.get(unit.key); return available ? [available] : []; }), [selectedUnits, availableUnits]);
  selectionRef.current = units;
  const selectedKeys = useMemo(() => new Set(units.map((unit) => unit.key)), [units]);

  useEffect(() => {
    // 数据库刷新可移除或替换所选轮次，现存轮次改用仍存在的正文作为锚点。
    setSelectedUnits((current) => {
      const next = current.flatMap((unit) => { const available = availableUnits.get(unit.key); return available ? [available] : []; });
      return next.length === current.length && next.every((unit, index) => unit.anchorMessageId === current[index].anchorMessageId) ? current : next;
    });
  }, [availableUnits]);

  const exit = useCallback(() => {
    if (deletion.current) return;
    selectionRef.current = [];
    setSelectedUnits([]);
    setSelecting(false);
  }, []);

  useEffect(() => {
    selectionRef.current = [];
    setSelectedUnits([]);
    setSelecting(false);
    setIsDeleting(false);
    deletion.current = null;
  }, [sessionId, isActive]);

  useEffect(() => {
    if (!isActive || !selecting) return;
    const listener = BackHandler.addEventListener('hardwareBackPress', () => { exit(); return true; });
    return () => listener.remove();
  }, [isActive, selecting, exit]);

  const enter = useCallback((message: ChatMessage) => {
    const unit = availableUnits.get(getChatSelectionKey(message))!;
    selectionRef.current = [unit];
    setSelectedUnits([unit]);
    setSelecting(true);
  }, [availableUnits]);

  const toggle = useCallback((key: string) => {
    if (deletion.current) return;
    const current = selectionRef.current;
    const next = toggleChatSelection(current, availableUnits.get(key)!);
    if (next === current) {
      ToastAndroid.show(`最多选择 ${MAX_CHAT_SELECTION_UNITS} 条，AI 一整轮回复算一条`, ToastAndroid.SHORT);
      return;
    }
    selectionRef.current = next;
    setSelectedUnits(next);
  }, [availableUnits]);

  const requestDelete = useCallback(() => {
    const targetSession = sessionId!;
    const selected = selectionRef.current;
    showAppDialog({
      title: '删除消息',
      message: `确定删除所选的 ${selected.length} 条消息吗？AI 回复将整轮删除，已经执行的工具操作不会撤销。删除后无法恢复。`,
      buttons: [
        { text: '取消', style: 'cancel' },
        { text: '删除', style: 'destructive', onPress: async () => {
          if (deletion.current || currentSession.current !== targetSession) return;
          const request = {};
          deletion.current = request;
          setIsDeleting(true);
          try {
            const ids = await deleteChatSelection(targetSession, selected.map((unit) => unit.anchorMessageId));
            if (currentSession.current !== targetSession || deletion.current !== request) return;
            onDeleted(ids);
            setSelectedUnits([]);
            setSelecting(false);
          } catch (error) {
            if (currentSession.current === targetSession && deletion.current === request) {
              showAppDialog({ title: '删除失败', message: error instanceof Error ? error.message : '删除消息失败', tone: 'error' });
            }
          } finally {
            if (deletion.current === request) { deletion.current = null; setIsDeleting(false); }
          }
        } },
      ],
    });
  }, [sessionId, onDeleted]);

  return { selecting, selectedKeys, availableKeys, availableUnits, anchorMessageIds: units.map((unit) => unit.anchorMessageId), count: units.length, isDeleting, enter, exit, toggle, requestDelete };
}
