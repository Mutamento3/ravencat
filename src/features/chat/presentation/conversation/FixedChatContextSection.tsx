/** 固定范围属于当前单聊；页面焦点与会话事件只刷新事实，不持有消息副本。 */
import React, { useCallback, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { ThemedSurface, useThemedStyles } from '@shared/theme';
import { showAppDialog } from '@shared/ui';
import { getChatSummaryContext, setFixedChatContextStart } from '../../summary/application/ChatSummary';
import { subscribeChatSummaryChanged } from '../../summary/application/ChatSummaryRuntime';
import { setChatEventBus } from '../../messages/events/ChatEvents';
import type { ChatSummarySnapshot } from '../../summary/domain/ChatSummaryRepository';
import { createStyles } from './chatSettingsStyles';

export default function FixedChatContextSection({ conversationId, onChoose, onFixedChange }: {
  conversationId: string; onChoose(): void; onFixedChange(fixed: boolean): void;
}) {
  const styles = useThemedStyles(createStyles);
  const [fixedStart, setFixedStart] = useState<ChatSummarySnapshot['fixedStart']>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useFocusEffect(useCallback(() => {
    let active = true;
    let revision = 0;
    const load = async () => {
      const current = ++revision;
      try {
        const snapshot = await getChatSummaryContext(conversationId);
        if (active && current === revision) {
          setFixedStart(snapshot.fixedStart); setLoaded(true); setError(null);
          onFixedChange(snapshot.settings.fixedMessageId !== null);
        }
      } catch (failure) {
        if (active && current === revision) setError(failure instanceof Error ? failure.message : '读取固定起点失败');
      }
    };
    void load();
    const unsubscribeSummary = subscribeChatSummaryChanged((id) => { if (id === conversationId) void load(); });
    const unsubscribeMessages = setChatEventBus({ emit(name, payload) {
      if (payload.sessionId === conversationId && ['messagesUpdated', 'messagesPatched', 'messagesDeleted', 'messagesReloadRequested'].includes(name)) void load();
    } });
    return () => { active = false; unsubscribeSummary(); unsubscribeMessages(); };
  }, [conversationId, onFixedChange]));
  const cancel = async () => {
    setBusy(true);
    try { await setFixedChatContextStart(conversationId, null); }
    catch (failure) { showAppDialog({ title: '取消固定失败', message: failure instanceof Error ? failure.message : '请稍后再试', tone: 'error' }); }
    finally { setBusy(false); }
  };
  return <ThemedSurface variant="card" style={styles.settingsSection}>
    <Text style={styles.cardTitle}>固定消息起点</Text>
    <Text style={styles.rowDescription}>{fixedStart ? '已固定 · 从选中消息起持续带入' : '从某条消息开始，保留之后的全部原文'}</Text>
    {error && <Text accessibilityRole="alert" style={styles.contextLimitError}>{error}</Text>}
    {fixedStart && <>
      <Text numberOfLines={4} style={styles.fixedPreview}>{fixedStart.content}</Text>
      <Text style={styles.rowDescription}>{fixedStart.messageCount} 条逻辑对话 · 自动摘要已暂停</Text>
      <Text style={styles.rowDescription}>范围会随对话增长，可能超出模型额度并增加用量。</Text>
    </>}
    <View style={styles.fixedActions}>
      <Pressable disabled={!loaded || busy} accessibilityRole="button" onPress={onChoose}>
        <Text style={styles.fixedAction}>{fixedStart ? '更换起点' : loaded ? '选择起点' : '读取中…'}</Text>
      </Pressable>
      {fixedStart && <Pressable disabled={busy} accessibilityRole="button" onPress={() => { void cancel(); }}>
        <Text style={styles.fixedAction}>取消固定</Text>
      </Pressable>}
    </View>
    <Text style={styles.rowDescription}>在聊天中长按消息，选择「固定」。</Text>
  </ThemedSurface>;
}
