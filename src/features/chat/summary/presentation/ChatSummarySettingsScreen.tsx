/** 设置与正文列表分开；离开设置页先确认草稿，模型执行不占用页面 busy。 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, ScrollView, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { KeyboardAvoidingContainer, NavigationHeader, ConfiguredModelPicker } from '@shared/ui';
import { aiAssistantRepository, getAuxiliaryModelSelection, requireAuxiliaryModel, subscribeAuxiliaryModelsChanged } from '@features/assistants';
import { useAutoSaveNavigation } from '@shared/ui/useAutoSaveDraft';
import { useTheme, useThemedStyles } from '@shared/theme';
import { estimateTextTokens } from '@shared/prompt';
import { getChatSummarySettings, updateChatSummarySettings } from '../application/ChatSummary';
import { subscribeChatSummaryChanged } from '../application/ChatSummaryRuntime';
import type { ChatSummarySettingsPatch } from '../domain/ChatSummaryRepository';
import ChatSummarySettingsPanel, { type ChatSummarySettingsEditor } from './ChatSummarySettingsPanel';
import { useChatSummarySnapshot } from './useChatSummarySnapshot';
import { createChatSummaryStyles } from './chatSummaryStyles';

export default function ChatSummarySettingsScreen({ conversationId, onBack, group = false, assistantId }: { conversationId: string; onBack(): void; group?: boolean; assistantId?: string }) {
  const theme = useTheme(), styles = useThemedStyles(createChatSummaryStyles);
  const { snapshot, error } = useChatSummarySnapshot(conversationId);
  const editor = useRef<ChatSummarySettingsEditor>(null);
  const [busy, setBusy] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [followPrimaryLimit, setFollowPrimaryLimit] = useState<number | null>(null);
  // 跟随值只是展示；真正解析在领取时按当时的主视角上限读取，无需订阅同步。
  useEffect(() => {
    if (group || !assistantId) return;
    let alive = true;
    void aiAssistantRepository.getById(assistantId).then((assistant) => {
      if (alive && assistant) setFollowPrimaryLimit(assistant.privateContextPrimaryLimit);
    });
    return () => { alive = false; };
  }, [group, assistantId, snapshot?.settings.primaryLimit]);
  const getModels = useCallback(async () => getAuxiliaryModelSelection({
    modelConfigId: (await getChatSummarySettings(conversationId)).modelConfigId, capabilityKind: 'general',
  }), [conversationId]);
  const subscribeModels = useCallback((listener: () => void) => {
    const models = subscribeAuxiliaryModelsChanged(listener);
    const summary = subscribeChatSummaryChanged((id) => { if (id === conversationId) listener(); });
    return () => { models(); summary(); };
  }, [conversationId]);
  const selectModel = useCallback(async (modelConfigId: string | null) => {
    if (modelConfigId !== null) await requireAuxiliaryModel(modelConfigId, 'general');
    await updateChatSummarySettings(conversationId, { modelConfigId });
  }, [conversationId]);
  const { back } = useAutoSaveNavigation(async () => !snapshot || await editor.current!.flush(), onBack, () => setBlocked(true));
  const save = async (patch: ChatSummarySettingsPatch) => {
    setBusy(true);
    try { await updateChatSummarySettings(conversationId, patch); setBlocked(false); }
    finally { setBusy(false); }
  };
  return <SafeAreaView style={styles.screen}><KeyboardAvoidingContainer style={styles.screen}>
    <NavigationHeader title="摘要设置" onGoBack={back} />
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
      {error && <Text style={styles.danger}>{error}</Text>}
      {blocked && <Text style={styles.danger}>请先修正或恢复尚未保存的输入。</Text>}
      {!snapshot && !error && <ActivityIndicator color={theme.colors.brand.primary} />}
      {snapshot && <ConfiguredModelPicker title="总结模型" description="一级、二级共用选择。通用模型持续引用配置；停用或删除后暂停任务并保留选择。切换保留正文和进度。"
        unconfiguredLabel={group ? '群聊管理员' : '当前聊天模型'} clearSelectionLabel={group ? '使用群聊管理员' : '使用当前聊天模型'}
        getSettings={getModels} onSelect={selectModel} subscribeChanged={subscribeModels} />}
      {snapshot && <ChatSummarySettingsPanel ref={editor} settings={snapshot.settings} busy={busy} onSave={save} group={group}
        followPrimaryLimit={followPrimaryLimit}
        pendingTokens={snapshot.segments.filter((segment) => segment.level === 'primary' && segment.compactionId === null).reduce((sum, segment) => sum + estimateTextTokens(segment.content), 0)} />}
    </ScrollView>
  </KeyboardAvoidingContainer></SafeAreaView>;
}
