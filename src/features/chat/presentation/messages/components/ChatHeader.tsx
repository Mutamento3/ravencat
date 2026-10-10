/** 渲染聊天详情顶部栏，承载菜单、返回、静音与输入状态。 */

import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { ChevronRight, Menu, Volume2, VolumeX } from 'lucide-react-native';
import { isMoonKimiTheme, ThemedSurface, useTheme, useThemedStyles } from '@shared/theme';
import type { PresentationTheme } from '@shared/theme';

interface ChatHeaderProps {
  aiName?: string | null;
  isTyping?: boolean;
  onOpenMenu?: () => void;
  paddingTop?: number;
  onGoBack?: () => void;
  onToggleMute?: () => void;
  isMuted?: boolean;
  onTitlePress?: () => void;
}

const createStyles = (theme: PresentationTheme) =>
  StyleSheet.create({
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      position: 'relative',
      paddingHorizontal: 16,
      paddingVertical: 8,
      borderBottomWidth: 0.5,
      borderBottomColor: theme.components.navigation.borderColor,
      backgroundColor: theme.components.navigation.backgroundColor,
    },
    headerSide: {
      width: 88,
      alignItems: 'flex-start',
    },
    headerSideLeft: {
      flexDirection: 'row',
      alignItems: 'center',
    },
    backBtn: {
      padding: 5,
      marginLeft: -5,
    },
    headerSideRight: {
      flexDirection: 'row',
      justifyContent: 'flex-end',
      alignItems: 'flex-end',
    },
    titleContainer: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: 36,
    },
    headerTitle: {
      fontSize: 17,
      fontWeight: '600',
      color: theme.components.navigation.titleColor,
    },
    headerActionBtn: {
      padding: 8,
      marginRight: -6,
    },
    moonKimiTitleContainer: {
      flex: 1,
      justifyContent: 'center',
      marginLeft: 6,
    },
    moonKimiTitleRow: {
      flexDirection: 'row',
      alignItems: 'center',
    },
    moonKimiTitleMeta: {
      // marginLeft: theme.spacing.xs,
      marginLeft: 7,
      fontSize: theme.typography.title.fontSize,
      color: theme.colors.text.secondary,
    },
    moonKimiRightActions: {
      width: 88,
      flexDirection: 'row',
      justifyContent: 'flex-end',
      alignItems: 'center',
      gap: theme.spacing.sm,
    },
    typingOverlay: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
    },
    typingText: {
      fontSize: 17,
      color: theme.components.navigation.titleColor,
      fontWeight: '500',
    },
  });

function ChatHeader({
  aiName,
  isTyping = false,
  onOpenMenu,
  paddingTop = 0,
  onGoBack,
  onToggleMute,
  isMuted = true,
  onTitlePress,
}: ChatHeaderProps) {
  const theme = useTheme();
  const styles = useThemedStyles(createStyles);
  const isMoonKimi = isMoonKimiTheme(theme);
  // 上层未接入静音逻辑时，先提供本地视觉切换；接入后以 props 为准。
  const [localMuted, setLocalMuted] = React.useState(isMuted);
  const effectiveMuted = onToggleMute ? isMuted : localMuted;
  const handleToggleMute = onToggleMute ?? (() => setLocalMuted((value) => !value));

  if (isMoonKimi) {
    return (
      <ThemedSurface nativeGlass variant="navigation" style={[styles.header, { paddingTop, borderBottomWidth: 0 }]}>
        <TouchableOpacity onPress={onOpenMenu} style={styles.headerActionBtn}>
          <Menu size={26} strokeWidth={1.65} color="#000000" />
        </TouchableOpacity>

        {onTitlePress ? (
          <TouchableOpacity style={styles.moonKimiTitleContainer} activeOpacity={0.7} onPress={onTitlePress}>
            <View style={styles.moonKimiTitleRow}>
              <Text style={styles.headerTitle} numberOfLines={1}>{aiName}</Text>
              <Text style={styles.moonKimiTitleMeta}>思考</Text>
              <ChevronRight size={18} strokeWidth={1.65} color={theme.colors.text.secondary} />
            </View>
          </TouchableOpacity>
        ) : (
          <View style={styles.moonKimiTitleContainer}>
            <View style={styles.moonKimiTitleRow}>
              <Text style={styles.headerTitle} numberOfLines={1}>{aiName}</Text>
              <Text style={styles.moonKimiTitleMeta}>思考</Text>
              <ChevronRight size={18} strokeWidth={1.65} color={theme.colors.text.secondary} />
            </View>
          </View>
        )}

        <View style={styles.moonKimiRightActions}>
          <TouchableOpacity
            onPress={handleToggleMute}
            style={styles.headerActionBtn}
          >
            {effectiveMuted ? (
              <VolumeX size={24} strokeWidth={1.65} color="#000000" />
            ) : (
              <Volume2 size={24} strokeWidth={1.65} color="#000000" />
            )}
          </TouchableOpacity>
        </View>
      </ThemedSurface>
    );
  }

  return (
    <ThemedSurface nativeGlass variant="navigation" style={[styles.header, { paddingTop }]}>
      <View style={[styles.headerSide, styles.headerSideLeft]}>
        {onGoBack ? (
          <TouchableOpacity onPress={onGoBack} style={styles.backBtn}>
            <Ionicons name="chevron-back" size={28} color={theme.colors.brand.primary} />
          </TouchableOpacity>
        ) : null}
      </View>

      <View style={styles.titleContainer}>
        {isTyping ? (
          <View style={styles.typingOverlay}>
            <Text style={styles.typingText}>对方正在输入...</Text>
          </View>
        ) : (
          <Text style={styles.headerTitle}>{aiName}</Text>
        )}
      </View>

      <View style={[styles.headerSide, styles.headerSideRight]}>
        <TouchableOpacity onPress={onOpenMenu} style={styles.headerActionBtn}>
          <Ionicons name="ellipsis-horizontal" size={24} color={theme.colors.text.primary} />
        </TouchableOpacity>
      </View>
    </ThemedSurface>
  );
}

export default React.memo(ChatHeader);
