/** 单条与多选共用目标选择、完整预览与确认发送，不改变来源页的输入草稿。 */
import React, { useEffect, useRef } from 'react';
import { ActivityIndicator, Keyboard, KeyboardAvoidingView, Modal, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme, useThemedStyles, type PresentationTheme } from '@shared/theme';
import type { useChatMessageShare } from './useChatMessageShare';
import { SharedChatRecordEntries } from './SharedChatRecordView';
import type { PreviewFileHandler } from '../MessageBubble/MessageBubbleContent';

export default function ChatShareSheet({ share, onPreviewFile }: { share: ReturnType<typeof useChatMessageShare>; onPreviewFile: PreviewFileHandler }) {
  const theme = useTheme();
  const styles = useThemedStyles(createStyles);
  const insets = useSafeAreaInsets();
  const commentInput = useRef<TextInput>(null);
  useEffect(() => {
    if (!share.visible) return;
    // 输入法自身的收起按钮不会解除焦点，隐藏后显式结束这次输入。
    const subscription = Keyboard.addListener('keyboardDidHide', () => commentInput.current?.blur());
    return () => subscription.remove();
  }, [share.visible]);
  return <Modal visible={share.visible} animationType="slide" statusBarTranslucent navigationBarTranslucent onRequestClose={share.close}>
    {/* 透明系统栏下原生窗口可能不缩放；用留白避让，避免 height 模式反复改变自身测量高度。 */}
    <KeyboardAvoidingView behavior="padding" style={styles.page}>
    <View style={[styles.page, { paddingTop: insets.top, paddingBottom: Math.max(insets.bottom, 8) }]}>
      <View style={styles.header}>
        <TouchableOpacity disabled={share.sending} onPress={share.target ? () => share.choose(null) : share.close} style={styles.button}><Text style={styles.link}>{share.target ? '返回' : '取消'}</Text></TouchableOpacity>
        <Text style={styles.title}>{share.target ? `分享给${share.target.name}` : '选择分享对象'}</Text>
        <View style={styles.button} />
      </View>
      {share.loading ? <ActivityIndicator style={styles.loading} color={theme.colors.brand.primary} /> : null}
      {share.error ? <Text accessibilityRole="alert" style={styles.error}>{share.error}</Text> : null}
      {share.record && !share.target ? <ScrollView>
        <Text style={styles.hint}>已选 {share.record.selectionCount} 条 · AI 回复按整轮分享</Text>
        {share.targets.length === 0 ? <Text style={styles.hint}>还没有可分享的 AI 或群聊</Text> : null}
        {share.targets.map((target) => <TouchableOpacity key={`${target.kind}:${target.id}`} accessibilityRole="button" onPress={() => share.choose(target)} style={styles.destination}><Text style={styles.text}>{target.name}</Text><Text style={styles.hint}>{target.kind === 'group' ? '群聊' : 'AI 单聊'}</Text></TouchableOpacity>)}
      </ScrollView> : null}
      {share.record && share.target ? <>
        <ScrollView keyboardShouldPersistTaps="handled" pointerEvents={share.sending ? 'none' : 'auto'}>
          <Text style={styles.hint}>来源：{share.record.sourceName} · {share.record.selectionCount} 条消息</Text>
          <SharedChatRecordEntries record={share.record} onPreviewFile={onPreviewFile} />
        </ScrollView>
        <TextInput ref={commentInput} editable={!share.sending} accessibilityLabel="分享附言" placeholder="附言（可选，作为单独消息发送）" placeholderTextColor={theme.colors.text.secondary} multiline value={share.comment} onChangeText={share.setComment} style={styles.input} />
        <TouchableOpacity accessibilityRole="button" disabled={share.sending} accessibilityState={{ disabled: share.sending }} onPress={() => { void share.send(); }} style={[styles.send, share.sending && styles.disabled]}><Text style={styles.sendText}>{share.sending ? '分享中…' : '确认分享'}</Text></TouchableOpacity>
      </> : null}
    </View>
    </KeyboardAvoidingView>
  </Modal>;
}

const createStyles = (theme: PresentationTheme) => StyleSheet.create({
  page: { flex: 1, backgroundColor: theme.colors.background.screen },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, minHeight: 52 },
  button: { width: 64, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  title: { flex: 1, textAlign: 'center', fontSize: 17, fontWeight: '600', color: theme.colors.text.primary },
  text: { fontSize: 16, color: theme.colors.text.primary }, link: { color: theme.colors.brand.primary },
  hint: { paddingHorizontal: 16, paddingVertical: 10, color: theme.colors.text.secondary, fontSize: 12 },
  loading: { margin: 32 }, error: { color: theme.colors.feedback.error, padding: 16 },
  destination: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, minHeight: 56, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.colors.border.light },
  input: { color: theme.colors.text.primary, backgroundColor: theme.colors.surface.default, borderColor: theme.colors.border.light, borderWidth: StyleSheet.hairlineWidth, borderRadius: 8, marginHorizontal: 16, marginBottom: 12, padding: 12, maxHeight: 100 },
  send: { marginHorizontal: 16, borderRadius: 8, backgroundColor: theme.colors.brand.primary, padding: 14, alignItems: 'center' },
  sendText: { color: theme.colors.brand.onPrimary, fontSize: 16, fontWeight: '600' }, disabled: { opacity: 0.5 },
});
