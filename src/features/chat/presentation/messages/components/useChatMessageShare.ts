/** 分享弹窗持有快照与发送状态；页面草稿和多选状态由原页面继续持有。 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { ToastAndroid } from 'react-native';
import { randomUUID } from 'expo-crypto';
import { createChatShareSnapshot, listChatShareTargets, shareChatRecord, type ChatShareTarget } from '../../../messages/application/ShareChatMessages';
import type { SharedChatRecord } from '../../../messages/domain/SharedChatRecord';

export function useChatMessageShare({ sessionId, sourceName, assistantId, isActive, onShared }: {
  sessionId?: string; sourceName: string; assistantId?: string; isActive: boolean; onShared: () => void;
}) {
  const [visible, setVisible] = useState(false);
  const [record, setRecord] = useState<SharedChatRecord | null>(null);
  const [targets, setTargets] = useState<ChatShareTarget[]>([]);
  const [target, setTarget] = useState<ChatShareTarget | null>(null);
  const [comment, setComment] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const request = useRef<object | null>(null);
  const sendingRef = useRef(false);
  const clientMessageId = useRef('');
  const close = useCallback(() => {
    if (sendingRef.current) return;
    request.current = null;
    setVisible(false);
  }, []);
  useEffect(() => {
    request.current = null;
    sendingRef.current = false;
    setVisible(false);
    setSending(false);
    return () => { request.current = null; };
  }, [sessionId, isActive]);

  const open = useCallback(async (anchorMessageIds: readonly number[]) => {
    const token = {};
    request.current = token;
    setVisible(true); setRecord(null); setTarget(null); setComment(''); setError(null); setLoading(true);
    try {
      const [snapshot, destinations] = await Promise.all([
        createChatShareSnapshot({ sessionId: sessionId!, name: sourceName, assistantId }, anchorMessageIds),
        listChatShareTargets(),
      ]);
      if (request.current !== token) return;
      setRecord(snapshot); setTargets(destinations.filter((destination) => destination.kind === 'group' ? destination.id !== sessionId : destination.id !== assistantId));
    } catch (failure) {
      if (request.current === token) setError(failure instanceof Error ? failure.message : '加载分享记录失败');
    } finally {
      if (request.current === token) setLoading(false);
    }
  }, [sessionId, sourceName, assistantId]);

  const choose = useCallback((destination: ChatShareTarget | null) => {
    setTarget(destination); setError(null); clientMessageId.current = randomUUID();
  }, []);
  const send = useCallback(async () => {
    if (sendingRef.current) return;
    const token = request.current;
    sendingRef.current = true; setSending(true); setError(null);
    try {
      const result = await shareChatRecord({ target: target!, record: record!, comment, clientMessageId: clientMessageId.current });
      if (request.current !== token) return;
      sendingRef.current = false; setSending(false);
      setVisible(false); request.current = null; onShared();
      ToastAndroid.show(result.warning ?? `已分享给${target!.name}`, result.warning ? ToastAndroid.LONG : ToastAndroid.SHORT);
    } catch (failure) {
      if (request.current === token) setError(failure instanceof Error ? failure.message : '分享失败');
    } finally {
      if (request.current === token) { sendingRef.current = false; setSending(false); }
    }
  }, [target, record, comment, onShared]);
  return { visible, record, targets, target, comment, error, loading, sending, open, close, choose, setComment, send };
}
