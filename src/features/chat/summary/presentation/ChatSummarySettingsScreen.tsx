/** 设置与正文列表分开；离开设置页先确认草稿，模型执行不占用页面 busy。 */
import React, { useRef, useState } from 'react';
import { ActivityIndicator, ScrollView, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { NavigationHeader } from '@shared/ui';
import { useAutoSaveNavigation } from '@shared/ui/useAutoSaveDraft';
import { useTheme, useThemedStyles } from '@shared/theme';
import { estimateTextTokens } from '@shared/prompt';
import { updateChatSummarySettings } from '../application/ChatSummary';
import type { ChatSummarySettingsPatch } from '../domain/ChatSummaryRepository';
import ChatSummarySettingsPanel, { type ChatSummarySettingsEditor } from './ChatSummarySettingsPanel';
import { useChatSummarySnapshot } from './useChatSummarySnapshot';
import { createChatSummaryStyles } from './chatSummaryStyles';

export default function ChatSummarySettingsScreen({ conversationId, onBack }: { conversationId: string; onBack(): void }) {
  const theme = useTheme(), styles = useThemedStyles(createChatSummaryStyles);
  const { snapshot, error } = useChatSummarySnapshot(conversationId);
  const editor = useRef<ChatSummarySettingsEditor>(null);
  const [busy, setBusy] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const { back } = useAutoSaveNavigation(async () => !snapshot || await editor.current!.flush(), onBack, () => setBlocked(true));
  const save = async (patch: ChatSummarySettingsPatch) => {
    setBusy(true);
    try { await updateChatSummarySettings(conversationId, patch); setBlocked(false); }
    finally { setBusy(false); }
  };
  return <SafeAreaView style={styles.screen}>
    <NavigationHeader title="摘要设置" onGoBack={back} />
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
      {error && <Text style={styles.danger}>{error}</Text>}
      {blocked && <Text style={styles.danger}>请先修正或恢复尚未保存的输入。</Text>}
      {!snapshot && !error && <ActivityIndicator color={theme.colors.brand.primary} />}
      {snapshot && <ChatSummarySettingsPanel ref={editor} settings={snapshot.settings} busy={busy} onSave={save}
        pendingTokens={snapshot.segments.filter((segment) => segment.level === 'primary' && segment.compactionId === null).reduce((sum, segment) => sum + estimateTextTokens(segment.content), 0)} />}
    </ScrollView>
  </SafeAreaView>;
}
