/** 收藏页面只消费独立快照；原消息或会话删除不会改变展示和媒体播放。 */
import React, { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Modal, Pressable, ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { StarOff } from 'lucide-react-native';
import { ThemedSurface, useTheme, useThemedStyles } from '@shared/theme';
import { showAppDialog } from '@shared/ui';
import NavigationHeader from '@shared/ui/NavigationHeader';
import { listChatFavorites, removeChatFavorite } from '../../favorites/application/ChatFavorites';
import type { ChatFavorite, ChatFavoriteCategory, ChatFavoriteCursor } from '../../favorites/domain/ChatFavorite';
import { voiceMessagePlaybackCoordinator } from '../../messages/application/VoiceMessagePlaybackCoordinator';
import ImageAttachmentCard from '../messages/MessageBubble/ImageAttachmentCard';
import AttachmentCard from '../messages/MessageBubble/AttachmentCard';
import VoiceMessageCard from '../messages/MessageBubble/VoiceMessageCard';
import FilePreview from '../messages/FilePreview';
import type { PreviewFileHandler } from '../messages/MessageBubble/MessageBubbleContent';
import { createFavoriteStyles } from './ChatFavoritesScreen.styles';

const FILTERS: { category: ChatFavoriteCategory | null; label: string }[] = [
  { category: null, label: '全部' }, { category: 'text', label: '文本' }, { category: 'audio', label: '音频' },
  { category: 'image', label: '图片' }, { category: 'file', label: 'txt/md' },
];

export default function ChatFavoritesScreen({ onBack }: { onBack(): void }) {
  const theme = useTheme();
  const styles = useThemedStyles(createFavoriteStyles);
  const [category, setCategory] = useState<ChatFavoriteCategory | null>(null);
  const [items, setItems] = useState<ChatFavorite[]>([]);
  const [cursor, setCursor] = useState<ChatFavoriteCursor | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<ChatFavorite | null>(null);
  const [file, setFile] = useState<Parameters<PreviewFileHandler>[0] | null>(null);
  const requestVersion = useRef(0);
  const busy = useRef(false);
  const load = useCallback(async (nextCursor: ChatFavoriteCursor | null) => {
    if (nextCursor && busy.current) return;
    const version = nextCursor ? requestVersion.current : ++requestVersion.current;
    busy.current = true; setLoading(true); setError(null);
    if (!nextCursor) { setItems([]); setCursor(null); }
    try {
      const page = await listChatFavorites(category, nextCursor);
      if (version !== requestVersion.current) return;
      setItems(previous => nextCursor ? [...previous, ...page.items] : page.items);
      setCursor(page.nextCursor);
    } catch (failure) {
      if (version === requestVersion.current) setError(failure instanceof Error ? failure.message : '收藏加载失败');
    } finally {
      if (version === requestVersion.current) { busy.current = false; setLoading(false); }
    }
  }, [category]);
  useFocusEffect(useCallback(() => {
    void load(null);
    return () => {
      ++requestVersion.current; busy.current = false;
      // 失焦时释放此页面持有的预览，避免原生 Modal 遮住新的宿主路由。
      setItems([]); setCursor(null); setSelected(null); setFile(null);
      void voiceMessagePlaybackCoordinator.stop();
    };
  }, [load]));

  const remove = (favorite: ChatFavorite) => showAppDialog({ title: '取消收藏', message: '确定要取消收藏这条消息吗？', buttons: [
    { text: '取消', style: 'cancel' }, { text: '取消收藏', style: 'destructive', onPress: async () => {
      try {
        await voiceMessagePlaybackCoordinator.stop();
        await removeChatFavorite(favorite.id);
        setSelected(null);
        await load(null);
      } catch (failure) { showAppDialog({ title: '取消收藏失败', message: failure instanceof Error ? failure.message : '无法取消收藏', tone: 'error' }); }
    } },
  ] });
  const closeDetails = () => { setSelected(null); void voiceMessagePlaybackCoordinator.stop(); };
  const audio = (favorite: ChatFavorite) => favorite.snapshot.voice ? <VoiceMessageCard
    playbackTarget={{ kind: 'favorite', id: favorite.id }} voice={favorite.snapshot.voice}
    transcript={favorite.snapshot.text} isTranscriptExpanded={false} isMe={false}
    foregroundColor={theme.colors.text.primary} /> : null;
  const renderItem = ({ item }: { item: ChatFavorite }) => <ThemedSurface variant="card" style={styles.card}>
    <View style={styles.cardHeader}>
      <TouchableOpacity style={{ flex: 1 }} accessibilityRole="button" accessibilityLabel="查看收藏详情" onPress={() => setSelected(item)}>
        <Text style={styles.author}>{item.snapshot.authorName} · {item.snapshot.authorKind === 'user' ? '用户' : 'AI'}</Text>
        <Text style={styles.meta}>来自 {item.snapshot.sourceName}</Text>
      </TouchableOpacity>
      <TouchableOpacity style={styles.remove} accessibilityRole="button" accessibilityLabel="取消收藏" onPress={() => remove(item)}>
        <StarOff size={20} color={theme.colors.icon.secondary} />
      </TouchableOpacity>
    </View>
    <Pressable onPress={() => setSelected(item)} accessibilityRole="button" accessibilityLabel="查看收藏内容">
      {item.snapshot.text ? <Text numberOfLines={4} style={styles.text}>{item.snapshot.text}</Text> : null}
      {item.category === 'file' ? <Text style={styles.text}>{item.snapshot.attachments.filter(attachment => attachment.type === 'file').map(attachment => attachment.fileName).join('、')}</Text> : null}
    </Pressable>
    {item.category === 'image' ? <ImageAttachmentCard attachment={item.snapshot.attachments[0]} isMe={false} /> : null}
    {audio(item)}
    <Text style={styles.meta}>收藏于 {new Date(item.savedAt).toLocaleString()}</Text>
  </ThemedSurface>;

  return <SafeAreaView edges={['top', 'left', 'right', 'bottom']} style={styles.page}>
    <NavigationHeader title="收藏" onGoBack={onBack} />
    <View style={styles.filters}>{FILTERS.map(filter => <TouchableOpacity key={filter.label} accessibilityRole="tab"
      accessibilityState={{ selected: category === filter.category }} onPress={() => setCategory(filter.category)}
      style={[styles.filter, category === filter.category && styles.activeFilter]}>
      <Text style={[styles.filterLabel, category === filter.category && styles.activeFilterLabel]}>{filter.label}</Text>
    </TouchableOpacity>)}</View>
    {error ? <TouchableOpacity onPress={() => { void load(cursor); }}><Text style={styles.error}>{error} · 点击重试</Text></TouchableOpacity> : null}
    <FlatList data={items} renderItem={renderItem} keyExtractor={item => item.id} contentContainerStyle={styles.list}
      onEndReached={() => { if (cursor && !error) void load(cursor); }} onEndReachedThreshold={0.4}
      ListEmptyComponent={!loading && !error ? <Text style={styles.empty}>还没有收藏的消息</Text> : null}
      ListFooterComponent={loading ? <ActivityIndicator style={styles.footer} color={theme.colors.brand.primary} /> : null} />
    <Modal visible={selected !== null} animationType="slide" onRequestClose={closeDetails}>
      <SafeAreaView edges={['top', 'left', 'right', 'bottom']} style={styles.page}>
        <NavigationHeader title="收藏详情" onGoBack={closeDetails} />
        {selected ? <ScrollView contentContainerStyle={styles.details}>
          <Text style={styles.author}>{selected.snapshot.authorName} · 来自 {selected.snapshot.sourceName}</Text>
          <Text style={styles.meta}>消息时间：{new Date(selected.snapshot.messageCreatedAt).toLocaleString()}</Text>
          <Text style={styles.meta}>收藏时间：{new Date(selected.savedAt).toLocaleString()}</Text>
          {selected.snapshot.replyToText ? <Text selectable style={[styles.meta, styles.quote]}>{selected.snapshot.replyToText}</Text> : null}
          {selected.snapshot.text ? <Text selectable style={styles.text}>{selected.snapshot.text}</Text> : null}
          {audio(selected)}
          {selected.snapshot.attachments.map(attachment => <AttachmentCard key={attachment.id} attachment={attachment} isMe={false} onPreview={setFile} />)}
          <TouchableOpacity accessibilityRole="button" onPress={() => remove(selected)}><Text style={styles.link}>取消收藏</Text></TouchableOpacity>
        </ScrollView> : null}
      </SafeAreaView>
    </Modal>
    <Modal visible={file !== null} animationType="slide" onRequestClose={() => setFile(null)}>
      {file ? <FilePreview {...file} onBack={() => setFile(null)} /> : null}
    </Modal>
  </SafeAreaView>;
}
