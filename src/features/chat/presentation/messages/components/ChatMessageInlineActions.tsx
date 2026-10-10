/** 渲染助手消息下方的快捷操作按钮，并通过回调上报用户选择。 */

import React, { memo } from 'react';
import { View, TouchableOpacity, StyleSheet, type ViewStyle } from 'react-native';
import { Copy, CornerUpRight, Leaf, ThumbsUp, ThumbsDown, Volume2, type LucideIcon } from 'lucide-react-native';

import { useTheme, useThemedStyles } from '@shared/theme';
import type { PresentationTheme } from '@shared/theme';

export type ChatMessageInlineActionKey =
  | 'read-aloud'
  | 'copy'
  | 'like'
  | 'dislike'
  | 'save-memory'
  | 'share';

interface ChatMessageInlineActionsProps {
  onActionPress?: (action: ChatMessageInlineActionKey) => void;
  style?: ViewStyle;
}

type InlineActionItem = {
  key: ChatMessageInlineActionKey;
  Icon: LucideIcon;
};

const LEFT_ACTIONS: InlineActionItem[] = [
  { key: 'read-aloud', Icon: Volume2 },
  { key: 'copy', Icon: Copy },
  { key: 'like', Icon: ThumbsUp },
  { key: 'dislike', Icon: ThumbsDown },
];

const RIGHT_ACTIONS: InlineActionItem[] = [
  { key: 'save-memory', Icon: Leaf },
  { key: 'share', Icon: CornerUpRight },
];

const createStyles = (theme: PresentationTheme) =>
  StyleSheet.create({
    container: {
      width: '100%',
      marginTop: theme.spacing.md,
      marginBottom: theme.spacing.lg,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    actionGroup: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.sm,
    },
    actionButton: {
      width: 26,
      height: 26,
      alignItems: 'center',
      justifyContent: 'center',
    },
  });

function ChatMessageInlineActions({ onActionPress, style }: ChatMessageInlineActionsProps) {
  const theme = useTheme();
  const styles = useThemedStyles(createStyles);

  const renderAction = (item: InlineActionItem) => (
    <TouchableOpacity
      key={item.key}
      style={styles.actionButton}
      activeOpacity={0.7}
      onPress={() => onActionPress?.(item.key)}
    >
      <item.Icon size={18} strokeWidth={1.9} color={theme.colors.icon.secondary} />
    </TouchableOpacity>
  );

  return (
    <View style={[styles.container, style]}>
      <View style={styles.actionGroup}>
        {LEFT_ACTIONS.map(renderAction)}
      </View>
      <View style={styles.actionGroup}>
        {RIGHT_ACTIONS.map(renderAction)}
      </View>
    </View>
  );
}

export default memo(ChatMessageInlineActions);
