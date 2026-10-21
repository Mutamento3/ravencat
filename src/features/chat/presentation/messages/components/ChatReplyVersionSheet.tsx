/** 浏览只预览候选，显式采用才替换当前回复；历史媒体复用只读预览和独立播放身份。 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Button, ModalSheet } from '@shared/ui';
import { useTheme } from '@shared/theme';
import { copyTextToClipboard } from '@platform/device';
import { adoptChatReplyVersion, getChatReplyVersionHistory } from '../../../reply/application/ChatReplyVersions';
import type { ChatReplyVersionHistory } from '../../../reply/domain/ChatReplyVersion';
import { setChatEventBus } from '../../../messages/events/ChatEvents';
import { getMessageAttachments, getMessageSticker, getMessageVoice } from '../../../messages/domain/chatMessageMetadata';
import { voiceMessagePlaybackCoordinator } from '../../../messages/application/VoiceMessagePlaybackCoordinator';
import AttachmentCard from '../MessageBubble/AttachmentCard';
import StickerMessageCard from '../MessageBubble/StickerMessageCard';
import VoiceMessageCard from '../MessageBubble/VoiceMessageCard';
import type { PreviewFileHandler } from '../MessageBubble/MessageBubbleContent';

export default function ChatReplyVersionSheet({ sessionId, runId, blocked, onClose, onPreviewFile }: {
  sessionId: string; runId: string; blocked: boolean; onClose(): void; onPreviewFile: PreviewFileHandler;
}) {
  const theme = useTheme();
  const [history, setHistory] = useState<ChatReplyVersionHistory | null>(null);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const busy = useRef(false);
  const requestState = useRef({ revision: 0 });
  const requests = requestState.current;
  const load = useCallback(async () => {
    const request = ++requests.revision;
    try {
      const next = await getChatReplyVersionHistory(sessionId, runId);
      if (request !== requests.revision) return;
      setHistory(next);
      setError(next ? '' : '这轮回复的历史版本已被删除');
    } catch (cause) {
      if (request === requests.revision) setError(cause instanceof Error ? cause.message : '历史版本加载失败');
    }
  }, [sessionId, runId, requests]);
  useEffect(() => {
    void load();
    const unsubscribe = setChatEventBus({ emit: (name, payload) => {
      if (payload.sessionId === sessionId && ['regenerationChanged', 'messagesUpdated', 'messagesPatched', 'messagesDeleted', 'turnExecutionChanged'].includes(name)) void load();
    } });
    return () => { ++requests.revision; unsubscribe(); void voiceMessagePlaybackCoordinator.stop(); };
  }, [load, sessionId, requests]);
  const preview = history?.versions.find(version => version.id === (previewId ?? history.selectedVersionId));
  const adopt = async () => {
    if (busy.current) return;
    busy.current = true; setSaving(true);
    try {
      await voiceMessagePlaybackCoordinator.stop();
      await adoptChatReplyVersion(sessionId, runId, preview!.id, history!.selectedVersionId);
      await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : '采用版本失败'); }
    finally { busy.current = false; setSaving(false); }
  };
  return <ModalSheet visible title="历史版本" onClose={() => { if (!saving) onClose(); }}>
    <ScrollView contentContainerStyle={styles.content}>
      {!history && !error ? <ActivityIndicator color={theme.colors.brand.primary} /> : null}
      {error ? <Text accessibilityRole="alert" style={{ color: theme.colors.feedback.error }}>{error}</Text> : null}
      {history ? <>
        <Text style={{ color: theme.colors.text.secondary }}>{history.canAdopt && !blocked
          ? '查看不会切换版本。点击「采用此版本」后，后续对话使用该回复。'
          : '继续对话或生成回复后，本轮版本仅供查看和复制。'}</Text>
        <View style={styles.versions}>{history.versions.map((version, index) => <Button
          key={version.id} title={`版本 ${index + 1}${version.id === history.selectedVersionId ? ' · 当前采用' : ''}`}
          variant={preview?.id === version.id ? 'primary' : 'secondary'} disabled={saving}
          onPress={() => { void voiceMessagePlaybackCoordinator.stop(); setPreviewId(version.id); }} />)}</View>
        {preview ? <>
          <Text style={{ color: theme.colors.text.secondary }}>{new Date(preview.createdAt).toLocaleString()}</Text>
          {preview.messages.map((message, index) => {
            const voice = getMessageVoice(message);
            const sticker = getMessageSticker(message);
            return <View key={index} style={[styles.message, { borderColor: theme.colors.border.light }]}>
              {message.senderType !== 'assistant' ? <Text style={{ color: theme.colors.text.secondary }}>{message.senderType === 'reasoning' ? '思考记录' : '历史行动记录'}</Text> : null}
              {message.text ? <Text selectable style={[styles.text, { color: theme.colors.text.primary }]}>{message.text}</Text> : null}
              {voice ? <VoiceMessageCard playbackTarget={{ kind: 'reply_version', id: `${preview.id}:${index}` }} voice={voice} transcript={message.text} isTranscriptExpanded={false} isMe={false} foregroundColor={theme.colors.text.primary} /> : null}
              {sticker ? <StickerMessageCard sticker={sticker} /> : null}
              {getMessageAttachments(message).map(attachment => <AttachmentCard key={attachment.id} attachment={attachment} isMe={false} onPreview={onPreviewFile} />)}
            </View>;
          })}
          <Button title="复制回复正文" variant="secondary" onPress={() => copyTextToClipboard(preview.messages.filter(message => message.senderType === 'assistant').map(message => message.text).join('\n\n'))} />
          {preview.id !== history.selectedVersionId && history.canAdopt && !blocked ? <Button title={saving ? '正在采用…' : '采用此版本'} disabled={saving} onPress={() => { void adopt(); }} /> : null}
        </> : null}
      </> : null}
    </ScrollView>
  </ModalSheet>;
}

const styles = StyleSheet.create({
  content: { padding: 20, gap: 16 }, versions: { gap: 8 },
  message: { gap: 10, borderBottomWidth: StyleSheet.hairlineWidth, paddingBottom: 14 },
  text: { fontSize: 15, lineHeight: 23 },
});
