/** 表情包图库：全部收藏项的浏览与基础 metadata 管理。 */

import React, { useCallback, useEffect, useState } from 'react';
import { FlatList, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@shared/theme';
import { EmptyState, ModalSheet, showAppDialog } from '@shared/ui';
import {
  deleteStickerFromLibrary,
  editStickerMetadata,
  toggleStickerFavorite,
} from '../../application/StickerCommands';
import { listStickerGroups, listStickers } from '../../application/StickerQueries';
import type { Sticker, StickerGroup } from '../../domain/Sticker';
import { useStickerSystemStyles } from './styles';

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

interface TextInputRowProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  multiline?: boolean;
}

function TextInputRow({ label, value, onChange, multiline = false }: TextInputRowProps) {
  const styles = useStickerSystemStyles();
  return (
    <View>
      <Text style={styles.formLabel}>{label}</Text>
      <TextInput
        style={multiline ? [styles.input, { minHeight: 72, textAlignVertical: 'top' }] : styles.input}
        value={value}
        onChangeText={onChange}
        multiline={multiline}
      />
    </View>
  );
}

export default function StickerSystemLibraryScreen() {
  const styles = useStickerSystemStyles();
  const theme = useTheme();
  const [stickers, setStickers] = useState<Sticker[]>([]);
  const [groups, setGroups] = useState<StickerGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Sticker | null>(null);
  const [draftName, setDraftName] = useState('');
  const [draftDescription, setDraftDescription] = useState('');
  const [draftTags, setDraftTags] = useState('');
  const [draftEmotion, setDraftEmotion] = useState('');

  const reload = useCallback(async () => {
    const [items, groupRows] = await Promise.all([
      listStickers({ mode: 'all' }),
      listStickerGroups(),
    ]);
    setStickers(items);
    setGroups(groupRows);
  }, []);

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    reload().catch((error) => {
      showAppDialog({ title: '加载失败', message: getErrorMessage(error), tone: 'error' });
    }).finally(() => {
      if (mounted) setLoading(false);
    });
    return () => {
      mounted = false;
    };
  }, [reload]);

  const groupNameById = new Map(groups.map((group) => [group.id, group.name]));

  const openEditor = useCallback((sticker: Sticker) => {
    setEditing(sticker);
    setDraftName(sticker.name);
    setDraftDescription(sticker.description ?? '');
    setDraftTags(sticker.tags.join('、'));
    setDraftEmotion(sticker.emotion ?? '');
  }, []);

  const handleSaveMetadata = useCallback(async () => {
    if (!editing) return;
    try {
      await editStickerMetadata(editing.id, {
        name: draftName,
        description: draftDescription,
        tags: draftTags.split(/[、,，]/).map((tag) => tag.trim()).filter(Boolean),
        emotion: draftEmotion,
      });
      setEditing(null);
      await reload();
    } catch (error) {
      showAppDialog({ title: '保存失败', message: getErrorMessage(error), tone: 'error' });
    }
  }, [draftDescription, draftEmotion, draftName, draftTags, editing, reload]);

  const handleDelete = useCallback((sticker: Sticker) => {
    showAppDialog({
      title: '删除表情包',
      message: `确定从收藏库删除「${sticker.name}」吗？历史聊天消息不受影响。`,
      buttons: [
        { text: '取消', style: 'cancel' },
        {
          text: '删除',
          style: 'destructive',
          onPress: () => {
            deleteStickerFromLibrary(sticker.id).then(() => reload()).catch((error) => {
              showAppDialog({ title: '删除失败', message: getErrorMessage(error), tone: 'error' });
            });
          },
        },
      ],
    });
  }, [reload]);

  return (
    <View style={styles.container}>
      {loading ? (
        <Text style={styles.stateText}>正在加载…</Text>
      ) : stickers.length === 0 ? (
        <EmptyState title="还没有表情包" description="在聊天输入面板中导入表情包后，会出现在这里。" />
      ) : (
        <FlatList
          data={stickers}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ paddingHorizontal: theme.spacing.lg, paddingTop: theme.spacing.sm }}
          renderItem={({ item }) => (
            <View style={[styles.card, { marginHorizontal: 0, marginBottom: theme.spacing.sm }]}>
              <View style={[styles.row, { borderBottomWidth: 0 }]}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowTitle} numberOfLines={1}>
                    {item.name}
                  </Text>
                  <Text style={styles.rowSubtitle} numberOfLines={1}>
                    {[
                      item.groupId ? groupNameById.get(item.groupId) ?? '未知分组' : '未分组',
                      item.emotion ?? null,
                      item.tags.slice(0, 3).join('、') || null,
                    ].filter(Boolean).join(' · ')}
                  </Text>
                </View>
                <View style={styles.rowRight}>
                  <TouchableOpacity
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    onPress={() => {
                      toggleStickerFavorite(item.id).then(reload).catch((error) => {
                        showAppDialog({ title: '操作失败', message: getErrorMessage(error), tone: 'error' });
                      });
                    }}
                  >
                    <Ionicons
                      name={item.isFavorite ? 'star' : 'star-outline'}
                      size={20}
                      color={theme.colors.text.secondary}
                    />
                  </TouchableOpacity>
                  <TouchableOpacity
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    onPress={() => openEditor(item)}
                  >
                    <Ionicons
                      name="create-outline"
                      size={20}
                      color={theme.colors.text.secondary}
                    />
                  </TouchableOpacity>
                  <TouchableOpacity
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    onPress={() => handleDelete(item)}
                  >
                    <Ionicons name="trash-outline" size={20} color={theme.colors.text.secondary} />
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          )}
        />
      )}

      <ModalSheet
        visible={editing !== null}
        onClose={() => setEditing(null)}
        title="编辑表情信息"
      >
        <Text style={styles.hint}>修改名称 / 描述 / 标签 / 情绪会递增语义版本并重建该表情的向量。</Text>
        <TextInputRow label="名称" value={draftName} onChange={setDraftName} />
        <TextInputRow label="描述" value={draftDescription} onChange={setDraftDescription} multiline />
        <TextInputRow label="标签（用顿号分隔）" value={draftTags} onChange={setDraftTags} />
        <TextInputRow label="情绪" value={draftEmotion} onChange={setDraftEmotion} />
        <View style={styles.actionRow}>
          <TouchableOpacity style={styles.actionButton} onPress={() => setEditing(null)}>
            <Text style={styles.actionButtonText}>取消</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.actionButton}
            onPress={() => void handleSaveMetadata()}
          >
            <Text style={styles.actionButtonText}>保存</Text>
          </TouchableOpacity>
        </View>
      </ModalSheet>
    </View>
  );
}
