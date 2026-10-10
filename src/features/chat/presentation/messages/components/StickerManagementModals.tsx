/** Sticker 面板的收藏项与分组管理弹窗。 */

import { showAppDialog } from '@shared/ui';
import React, { useCallback, useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import type { Sticker, StickerGroup } from '@features/stickers';
import { useTheme, useThemedStyles } from '@shared/theme';
import { createStickerManagementModalStyles } from './stickerManagementModalStyles';

export interface StickerManagementInput {
  name: string;
  description: string;
  tags: string[];
  emotion: string;
  groupId: string | null;
}

interface StickerManagementModalsProps {
  sticker: Sticker | null;
  groups: StickerGroup[];
  stickerVisible: boolean;
  groupVisible: boolean;
  onStickerClose: () => void;
  onStickerSave: (input: StickerManagementInput) => Promise<void>;
  onStickerDelete: () => Promise<void>;
  onToggleFavorite: () => Promise<void>;
  onGroupClose: () => void;
  onGroupCreate: (name: string) => Promise<void>;
  onGroupRename: (groupId: string, name: string) => Promise<void>;
  onGroupDelete: (groupId: string) => Promise<void>;
}

function StickerEditorModal({
  sticker,
  groups,
  visible,
  onStickerClose: onClose,
  onStickerSave: onSave,
  onStickerDelete: onDelete,
  onToggleFavorite,
}: Pick<
  StickerManagementModalsProps,
  'sticker' | 'groups' | 'onStickerClose' | 'onStickerSave' | 'onStickerDelete' | 'onToggleFavorite'
> & { visible: boolean }) {
  const theme = useTheme();
  const styles = useThemedStyles(createStickerManagementModalStyles);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [tags, setTags] = useState('');
  const [emotion, setEmotion] = useState('');
  const [groupId, setGroupId] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (!sticker) {
      return;
    }
    setName(sticker.name);
    setDescription(sticker.description || '');
    setTags(sticker.tags.join(' '));
    setEmotion(sticker.emotion || '');
    setGroupId(sticker.groupId);
  }, [sticker]);

  const handleSave = useCallback(async () => {
    if (!sticker || isSaving) {
      return;
    }
    setIsSaving(true);
    try {
      await onSave({
        name,
        description,
        tags: tags.split(/[,，\s]+/).map((tag) => tag.trim()).filter(Boolean),
        emotion,
        groupId,
      });
      onClose();
    } catch (error) {
      showAppDialog({ title: '保存失败', message: error instanceof Error ? error.message : '保存表情包信息失败', tone: 'error' });
    } finally {
      setIsSaving(false);
    }
  }, [description, emotion, groupId, isSaving, name, onClose, onSave, sticker, tags]);

  const handleDelete = useCallback(() => {
    if (!sticker || isSaving) {
      return;
    }
    showAppDialog({
      title: '删除表情包',
      message: `确定从收藏库删除“${sticker.name}”吗？已发送的历史消息不会被改写。`,
      buttons: [
        { text: '取消', style: 'cancel' },
        {
          text: '删除',
          style: 'destructive',
          onPress: () => {
            setIsSaving(true);
            void onDelete()
              .then(onClose)
              .catch((error) => {
                showAppDialog({ title: '删除失败', message: error instanceof Error ? error.message : '删除表情包失败', tone: 'error' });
              })
              .finally(() => setIsSaving(false));
          },
        },
      ],
    });
  }, [isSaving, onClose, onDelete, sticker]);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.overlay} onPress={onClose}>
        <Pressable style={styles.card} onPress={() => undefined}>
          <View style={styles.header}>
            <Text style={styles.title}>编辑表情包</Text>
            <TouchableOpacity onPress={onClose} hitSlop={8}>
              <Ionicons name="close" size={22} color={theme.colors.icon.primary} />
            </TouchableOpacity>
          </View>
          <TextInput value={name} onChangeText={setName} placeholder="名称" placeholderTextColor={theme.colors.text.tertiary} style={styles.input} maxLength={120} />
          <TextInput value={description} onChangeText={setDescription} placeholder="含义/描述" placeholderTextColor={theme.colors.text.tertiary} style={[styles.input, styles.multilineInput]} multiline maxLength={500} />
          <TextInput value={tags} onChangeText={setTags} placeholder="标签（空格或逗号分隔）" placeholderTextColor={theme.colors.text.tertiary} style={styles.input} maxLength={300} />
          <TextInput value={emotion} onChangeText={setEmotion} placeholder="情绪" placeholderTextColor={theme.colors.text.tertiary} style={styles.input} maxLength={80} />
          <Text style={styles.sectionLabel}>分组</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipList}>
            <TouchableOpacity style={[styles.chip, groupId === null && styles.activeChip]} onPress={() => setGroupId(null)}>
              <Text style={[styles.chipText, groupId === null && styles.activeChipText]}>未分组</Text>
            </TouchableOpacity>
            {groups.map((group) => (
              <TouchableOpacity key={group.id} style={[styles.chip, groupId === group.id && styles.activeChip]} onPress={() => setGroupId(group.id)}>
                <Text style={[styles.chipText, groupId === group.id && styles.activeChipText]}>{group.name}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
          <View style={styles.actions}>
            <TouchableOpacity style={styles.secondaryButton} onPress={() => void onToggleFavorite()} disabled={isSaving}>
              <Text style={styles.secondaryButtonText}>{sticker?.isFavorite ? '取消收藏' : '收藏'}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.deleteButton} onPress={handleDelete} disabled={isSaving}>
              <Text style={styles.deleteButtonText}>删除</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.primaryButton} onPress={() => void handleSave()} disabled={isSaving}>
              <Text style={styles.primaryButtonText}>{isSaving ? '保存中…' : '保存'}</Text>
            </TouchableOpacity>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function GroupEditorModal({
  groups,
  visible,
  onGroupClose: onClose,
  onGroupCreate: onCreate,
  onGroupRename: onRename,
  onGroupDelete: onDelete,
}: Pick<
  StickerManagementModalsProps,
  'groups' | 'onGroupClose' | 'onGroupCreate' | 'onGroupRename' | 'onGroupDelete'
> & { visible: boolean }) {
  const theme = useTheme();
  const styles = useThemedStyles(createStickerManagementModalStyles);
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (visible) {
      setSelectedGroupId(null);
      setName('');
    }
  }, [visible]);

  const handleSubmit = useCallback(async () => {
    if (isSaving || !name.trim()) {
      return;
    }
    setIsSaving(true);
    try {
      if (selectedGroupId) {
        await onRename(selectedGroupId, name);
      } else {
        await onCreate(name);
      }
      onClose();
    } catch (error) {
      showAppDialog({ title: '分组保存失败', message: error instanceof Error ? error.message : '保存 Sticker 分组失败', tone: 'error' });
    } finally {
      setIsSaving(false);
    }
  }, [isSaving, name, onClose, onCreate, onRename, selectedGroupId]);

  const handleDelete = useCallback((group: StickerGroup) => {
    if (isSaving) {
      return;
    }
    showAppDialog({
      title: '删除分组',
      message: `确定删除“${group.name}”吗？组内表情包会移到未分组。`,
      buttons: [
        { text: '取消', style: 'cancel' },
        {
          text: '删除',
          style: 'destructive',
          onPress: () => {
            setIsSaving(true);
            void onDelete(group.id)
              .then(() => {
                if (selectedGroupId === group.id) {
                  setSelectedGroupId(null);
                  setName('');
                }
              })
              .catch((error) => {
                showAppDialog({ title: '删除失败', message: error instanceof Error ? error.message : '删除 Sticker 分组失败', tone: 'error' });
              })
              .finally(() => setIsSaving(false));
          },
        },
      ],
    });
  }, [isSaving, onDelete, selectedGroupId]);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.overlay} onPress={onClose}>
        <Pressable style={styles.card} onPress={() => undefined}>
          <View style={styles.header}>
            <Text style={styles.title}>管理表情包分组</Text>
            <TouchableOpacity onPress={onClose} hitSlop={8}>
              <Ionicons name="close" size={22} color={theme.colors.icon.primary} />
            </TouchableOpacity>
          </View>
          <TextInput value={name} onChangeText={setName} placeholder={selectedGroupId ? '分组名称' : '新分组名称'} placeholderTextColor={theme.colors.text.tertiary} style={styles.input} maxLength={80} />
          <ScrollView style={styles.groupList}>
            {groups.map((group) => (
              <View key={group.id} style={styles.groupRow}>
                <TouchableOpacity
                  style={styles.groupSelect}
                  onPress={() => {
                    setSelectedGroupId(group.id);
                    setName(group.name);
                  }}
                >
                  <Text style={styles.groupName} numberOfLines={1}>{group.name}</Text>
                  {selectedGroupId === group.id ? <Ionicons name="checkmark-circle" size={18} color={theme.colors.brand.primary} /> : null}
                </TouchableOpacity>
                <TouchableOpacity onPress={() => handleDelete(group)} hitSlop={8}>
                  <Ionicons name="trash-outline" size={18} color={theme.colors.feedback.error} />
                </TouchableOpacity>
              </View>
            ))}
          </ScrollView>
          <View style={styles.actions}>
            {selectedGroupId ? (
              <TouchableOpacity style={styles.secondaryButton} onPress={() => { setSelectedGroupId(null); setName(''); }}>
                <Text style={styles.secondaryButtonText}>新建分组</Text>
              </TouchableOpacity>
            ) : null}
            <TouchableOpacity style={styles.primaryButton} onPress={() => void handleSubmit()} disabled={isSaving}>
              <Text style={styles.primaryButtonText}>{isSaving ? '保存中…' : selectedGroupId ? '重命名' : '创建'}</Text>
            </TouchableOpacity>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

export default function StickerManagementModals(props: StickerManagementModalsProps) {
  return (
    <>
      <StickerEditorModal
        sticker={props.sticker}
        groups={props.groups}
        visible={props.stickerVisible}
        onStickerClose={props.onStickerClose}
        onStickerSave={props.onStickerSave}
        onStickerDelete={props.onStickerDelete}
        onToggleFavorite={props.onToggleFavorite}
      />
      <GroupEditorModal
        groups={props.groups}
        visible={props.groupVisible}
        onGroupClose={props.onGroupClose}
        onGroupCreate={props.onGroupCreate}
        onGroupRename={props.onGroupRename}
        onGroupDelete={props.onGroupDelete}
      />
    </>
  );
}
