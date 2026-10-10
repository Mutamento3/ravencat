/** 聊天 Sticker 面板：选择会直接发送独立 Sticker 消息。 */

import { showAppDialog } from '@shared/ui';
import React, { useCallback, useEffect, useState } from 'react';
import { FlatList, Image, ScrollView, Text, TouchableOpacity, View, type ListRenderItemInfo } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { Ionicons } from '@expo/vector-icons';

import {
  completeStickerAnnotationManually,
  createStickerGroup,
  deleteStickerFromLibrary,
  deleteStickerGroup,
  editStickerMetadata,
  importSticker,
  listStickerGroups,
  listStickers,
  moveStickerToGroup,
  renameStickerGroup,
  resolveStickerMedia,
  subscribeStickerAnnotationChanged,
  toggleStickerFavorite,
  type Sticker,
  type StickerGroup,
  type StickerListMode,
} from '@features/stickers';
import type { StickerMessageSnapshot } from '@features/chat/messages/domain';
import { inspectImageAnimation } from '@platform/device';
import { useTheme, useThemedStyles } from '@shared/theme';
import {
  createChatEmojiPanelStyles,
  STICKER_GRID_COLUMNS,
} from './chatEmojiPanelStyles';
import StickerManagementModals, {
  type StickerManagementInput,
} from './StickerManagementModals';

const LIST_MODES: readonly { mode: StickerListMode; label: string }[] = [
  { mode: 'all', label: '全部' },
  { mode: 'favorites', label: '收藏' },
  { mode: 'recent', label: '最近' },
];

type StickerPanelFilter =
  | { type: 'mode'; mode: StickerListMode }
  | { type: 'group'; groupId: string };

function getEmptyStateText(
  filter: StickerPanelFilter,
  managementMode: boolean,
): string {
  if (filter.type === 'group') {
    return managementMode
      ? '当前分组暂无可管理的表情包'
      : '当前分组还没有表情包，点击右上角导入';
  }
  if (filter.mode === 'favorites') {
    return managementMode ? '暂无可管理的收藏表情包' : '还没有收藏的表情包';
  }
  if (filter.mode === 'recent') {
    return managementMode ? '暂无可管理的最近表情包' : '还没有最近使用的表情包';
  }
  return managementMode
    ? '暂无可管理的未分组表情包'
    : '还没有未分组表情包，点击右上角导入';
}

interface ChatEmojiPanelProps {
  height: number;
  /** 点击 Sticker 后由聊天详情页走 canonical 用户消息命令。 */
  onStickerPress?: (sticker: StickerMessageSnapshot) => void;
}

function inferFileName(uri: string): string {
  const cleanUri = String(uri || '').split('?')[0].split('#')[0];
  return cleanUri.split('/').pop()?.trim() || `sticker_${Date.now()}.jpg`;
}

function inferMimeType(fileName: string, mimeType?: string | null): string {
  const normalizedMimeType = mimeType?.trim().toLowerCase();
  if (normalizedMimeType) {
    return normalizedMimeType;
  }
  switch (fileName.split('.').pop()?.toLowerCase()) {
    case 'gif':
      return 'image/gif';
    case 'webp':
      return 'image/webp';
    case 'apng':
      return 'image/apng';
    case 'png':
      return 'image/png';
    default:
      return 'image/jpeg';
  }
}

async function resolveStickerFileSize(
  uri: string,
  providedSize?: number | null,
): Promise<number> {
  if (providedSize !== null && providedSize !== undefined) {
    return providedSize;
  }
  const info = await FileSystem.getInfoAsync(uri);
  if (!info.exists || info.size === undefined) {
    throw new Error('无法读取表情包文件大小');
  }
  return info.size;
}

function getAnnotationStatusText(status: Sticker['annotationStatus']): string | null {
  switch (status) {
    case 'pending':
    case 'processing':
      return '识别中';
    case 'manual_required':
      return '需手动含义';
    case 'failed':
      return '识别失败';
    case 'ready':
    default:
      return null;
  }
}

/** 发送时复制 Sticker 字段，历史消息不跟随收藏库后续编辑。 */
function toStickerMessageSnapshot(sticker: Sticker): StickerMessageSnapshot {
  return {
    stickerId: sticker.id,
    mediaAssetId: sticker.mediaAssetId,
    name: sticker.name,
    description: sticker.description,
    tags: [...sticker.tags],
    emotion: sticker.emotion,
    sourceFileName: sticker.sourceFileName,
    mimeType: sticker.mimeType,
    width: sticker.width,
    height: sticker.height,
    isAnimated: sticker.isAnimated,
  };
}

function StickerGridItem({
  sticker,
  managementMode,
  onPress,
  onLongPress,
}: {
  sticker: Sticker;
  managementMode: boolean;
  onPress: (sticker: Sticker) => void;
  onLongPress: (sticker: Sticker) => void;
}) {
  const theme = useTheme();
  const styles = useThemedStyles(createChatEmojiPanelStyles);
  const [localUri, setLocalUri] = useState<string | null>(null);
  const statusText = getAnnotationStatusText(sticker.annotationStatus);

  useEffect(() => {
    let isMounted = true;
    setLocalUri(null);
    void resolveStickerMedia(sticker.id)
      .then((resolved) => {
        if (isMounted) {
          setLocalUri(resolved.localUri);
        }
      })
      .catch(() => {
        if (isMounted) {
          setLocalUri(null);
        }
      });
    return () => {
      isMounted = false;
    };
  }, [sticker.id, sticker.mediaAssetId]);

  return (
    <TouchableOpacity
      style={styles.gridItem}
      onPress={() => onPress(sticker)}
      onLongPress={() => onLongPress(sticker)}
      delayLongPress={450}
      activeOpacity={0.72}
    >
      {localUri ? (
        <Image source={{ uri: localUri }} style={styles.gridImage} resizeMode="contain" />
      ) : (
        <View style={[styles.gridImage, styles.gridPlaceholder]}>
          <Ionicons name="happy-outline" size={22} color={theme.colors.icon.secondary} />
        </View>
      )}
      {sticker.isFavorite ? <Ionicons name="heart" size={12} color={theme.colors.feedback.error} style={styles.favoriteMark} /> : null}
      {managementMode ? (
        <View style={styles.manageMark}>
          <Ionicons name="create-outline" size={13} color={theme.colors.brand.onPrimary} />
        </View>
      ) : null}
      <Text style={styles.gridName} numberOfLines={1}>{sticker.name}</Text>
      {statusText ? (
        <Text
          style={[
            styles.annotationStatus,
            sticker.annotationStatus === 'failed' ? styles.annotationStatusError : null,
            sticker.annotationStatus === 'manual_required' ? styles.annotationStatusManual : null,
          ]}
          numberOfLines={1}
        >
          {statusText}
        </Text>
      ) : null}
    </TouchableOpacity>
  );
}

export default function ChatEmojiPanel({ height, onStickerPress }: ChatEmojiPanelProps) {
  const theme = useTheme();
  const styles = useThemedStyles(createChatEmojiPanelStyles);
  const [filter, setFilter] = useState<StickerPanelFilter>({ type: 'mode', mode: 'all' });
  const [groups, setGroups] = useState<StickerGroup[]>([]);
  const [stickers, setStickers] = useState<Sticker[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isImporting, setIsImporting] = useState(false);
  const [managementMode, setManagementMode] = useState(false);
  const [managedSticker, setManagedSticker] = useState<Sticker | null>(null);
  const [isGroupManagementVisible, setIsGroupManagementVisible] = useState(false);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    try {
      const listInput = filter.type === 'group'
        ? { mode: 'all' as const, groupId: filter.groupId }
        : filter.mode === 'all'
          ? { mode: 'all' as const, groupId: null }
          : { mode: filter.mode };
      const [nextGroups, nextStickers] = await Promise.all([
        listStickerGroups(),
        listStickers(listInput),
      ]);
      setGroups(nextGroups);
      setStickers(nextStickers);
    } catch (error) {
      showAppDialog({ title: '表情包加载失败', message: error instanceof Error ? error.message : '无法加载表情包收藏库', tone: 'error' });
    } finally {
      setIsLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => subscribeStickerAnnotationChanged(() => {
    void refresh();
  }), [refresh]);

  const handleStickerPress = useCallback((sticker: Sticker) => {
    if (managementMode) {
      setManagedSticker(sticker);
      return;
    }
    onStickerPress?.(toStickerMessageSnapshot(sticker));
  }, [managementMode, onStickerPress]);

  const renderStickerItem = useCallback(({ item }: ListRenderItemInfo<Sticker>) => (
    <StickerGridItem
      sticker={item}
      managementMode={managementMode}
      onPress={handleStickerPress}
      onLongPress={setManagedSticker}
    />
  ), [handleStickerPress, managementMode]);

  const handleImportPress = useCallback(async () => {
    if (isImporting) {
      return;
    }
    setIsImporting(true);
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        throw new Error('未获得相册权限，无法导入表情包');
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: false,
        allowsMultipleSelection: true,
        selectionLimit: 0,
        quality: 1,
      });
      if (result.canceled || !result.assets?.length) {
        return;
      }

      let importedCount = 0;
      let pendingCount = 0;
      let manualCount = 0;
      const failedFiles: string[] = [];
      for (const asset of result.assets) {
        const fileName = asset.fileName?.trim() || inferFileName(asset.uri);
        try {
          const fileSize = await resolveStickerFileSize(asset.uri, asset.fileSize);
          // 文件头检查在 Sticker 事务外完成，并把明确结果交给 import 命令。
          const isAnimated = await inspectImageAnimation(asset.uri);
          const imported = await importSticker({
            sourceUri: asset.uri,
            fileName,
            mimeType: inferMimeType(fileName, asset.mimeType),
            fileSize,
            width: asset.width || null,
            height: asset.height || null,
            isAnimated,
            groupId: filter.type === 'group' ? filter.groupId : null,
          });
          importedCount += 1;
          if (imported.sticker.annotationStatus === 'manual_required') {
            manualCount += 1;
          } else if (imported.sticker.annotationStatus === 'pending') {
            pendingCount += 1;
          }
        } catch (error) {
          failedFiles.push(`${fileName}：${error instanceof Error ? error.message : '导入失败'}`);
        }
      }
      await refresh();
      if (importedCount > 0) {
        const messages = [`已导入 ${importedCount} 个表情包`];
        if (pendingCount > 0) messages.push(`${pendingCount} 个静态图片已进入 AI 识别队列`);
        if (manualCount > 0) messages.push(`${manualCount} 个 GIF/动态 WebP/APNG 需要手动补充含义`);
        if (failedFiles.length > 0) messages.push(`${failedFiles.length} 个文件导入失败`);
        showAppDialog({ title: '导入完成', message: messages.join('；'), tone: 'success' });
      } else if (failedFiles.length > 0) {
        showAppDialog({ title: '导入失败', message: failedFiles.join('\n'), tone: 'error' });
      }
    } catch (error) {
      showAppDialog({ title: '导入失败', message: error instanceof Error ? error.message : '导入表情包失败', tone: 'error' });
    } finally {
      setIsImporting(false);
    }
  }, [filter, isImporting, refresh]);

  const handleSaveSticker = useCallback(async (input: StickerManagementInput) => {
    if (!managedSticker) {
      return;
    }
    const metadata = {
      name: input.name,
      description: input.description,
      tags: input.tags,
      emotion: input.emotion,
    };
    if (managedSticker.annotationStatus === 'manual_required' || managedSticker.annotationStatus === 'failed') {
      // 动态媒体或失败项必须完成手动标注，不能只改字段而继续停留在不可用状态。
      await completeStickerAnnotationManually(managedSticker.id, metadata);
    } else {
      await editStickerMetadata(managedSticker.id, metadata);
    }
    if (input.groupId !== managedSticker.groupId) {
      await moveStickerToGroup(managedSticker.id, input.groupId);
    }
    await refresh();
  }, [managedSticker, refresh]);

  const handleDeleteSticker = useCallback(async () => {
    if (!managedSticker) return;
    await deleteStickerFromLibrary(managedSticker.id);
    setManagedSticker(null);
    await refresh();
  }, [managedSticker, refresh]);

  const handleToggleFavorite = useCallback(async () => {
    if (!managedSticker) return;
    await toggleStickerFavorite(managedSticker.id, !managedSticker.isFavorite);
    setManagedSticker(null);
    await refresh();
  }, [managedSticker, refresh]);

  const handleCreateGroup = useCallback(async (name: string) => {
    await createStickerGroup({ name });
    await refresh();
  }, [refresh]);

  const handleRenameGroup = useCallback(async (groupId: string, name: string) => {
    await renameStickerGroup(groupId, name);
    await refresh();
  }, [refresh]);

  const handleDeleteGroup = useCallback(async (groupId: string) => {
    await deleteStickerGroup(groupId);
    if (filter.type === 'group' && filter.groupId === groupId) {
      setFilter({ type: 'mode', mode: 'all' });
      return;
    }
    await refresh();
  }, [filter, refresh]);

  return (
    <View style={[styles.container, { height }]}>
      <View style={styles.header}>
        <Text style={styles.title}>
          {stickers.length ? `表情包 · ${stickers.length}` : '表情包'}
        </Text>
        <TouchableOpacity style={[styles.headerAction, managementMode && styles.headerActionActive]} onPress={() => setManagementMode((current) => !current)} activeOpacity={0.75}>
          <Ionicons name={managementMode ? 'checkmark' : 'settings-outline'} size={15} color={managementMode ? theme.colors.brand.onPrimary : theme.colors.icon.primary} />
          <Text style={[styles.headerActionText, managementMode && styles.headerActionTextActive]}>{managementMode ? '完成' : '管理'}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.headerAction} onPress={() => setIsGroupManagementVisible(true)} activeOpacity={0.75}>
          <Ionicons name="folder-outline" size={15} color={theme.colors.icon.primary} />
          <Text style={styles.headerActionText}>分组</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.headerAction} onPress={() => void handleImportPress()} disabled={isImporting}>
          <Ionicons name="add" size={17} color={theme.colors.icon.primary} />
          <Text style={styles.headerActionText}>{isImporting ? '导入中' : '导入'}</Text>
        </TouchableOpacity>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filterScroll} contentContainerStyle={styles.filterContent}>
        {LIST_MODES.map((item) => (
          <TouchableOpacity
            key={item.mode}
            style={[
              styles.filterChip,
              filter.type === 'mode' && filter.mode === item.mode && styles.filterChipActive,
            ]}
            onPress={() => setFilter({ type: 'mode', mode: item.mode })}
          >
            <Text style={[
              styles.filterChipText,
              filter.type === 'mode' && filter.mode === item.mode && styles.filterChipTextActive,
            ]}>
              {item.label}
            </Text>
          </TouchableOpacity>
        ))}
        {groups.map((group) => (
          <TouchableOpacity
            key={group.id}
            style={[
              styles.filterChip,
              filter.type === 'group' && filter.groupId === group.id && styles.filterChipActive,
            ]}
            onPress={() => setFilter({ type: 'group', groupId: group.id })}
          >
            <Text style={[
              styles.filterChipText,
              filter.type === 'group' && filter.groupId === group.id && styles.filterChipTextActive,
            ]}>
              {group.name}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {isLoading ? (
        <Text style={styles.loadingText}>加载表情包…</Text>
      ) : stickers.length === 0 ? (
        <View style={styles.emptyState}>
          <Ionicons name="happy-outline" size={28} color={theme.colors.icon.secondary} />
          <Text style={styles.emptyStateText}>
            {getEmptyStateText(filter, managementMode)}
          </Text>
        </View>
      ) : (
        <FlatList
          data={stickers}
          renderItem={renderStickerItem}
          keyExtractor={(sticker) => sticker.id}
          numColumns={STICKER_GRID_COLUMNS}
          style={styles.gridScroll}
          contentContainerStyle={styles.gridContainer}
          columnWrapperStyle={styles.gridRow}
          initialNumToRender={15}
          maxToRenderPerBatch={15}
          windowSize={3}
          removeClippedSubviews
        />
      )}

      <StickerManagementModals
        sticker={managedSticker}
        groups={groups}
        stickerVisible={Boolean(managedSticker)}
        groupVisible={isGroupManagementVisible}
        onStickerClose={() => setManagedSticker(null)}
        onStickerSave={handleSaveSticker}
        onStickerDelete={handleDeleteSticker}
        onToggleFavorite={handleToggleFavorite}
        onGroupClose={() => setIsGroupManagementVisible(false)}
        onGroupCreate={handleCreateGroup}
        onGroupRename={handleRenameGroup}
        onGroupDelete={handleDeleteGroup}
      />
    </View>
  );
}
