/** 通用 AI 信息卡片组件。 */

import type { StyleProp, ViewStyle } from 'react-native';
import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import AIAvatar from './AIAvatar';
import { useThemedStyles } from '@shared/theme';
import type { PresentationTheme } from '@shared/theme';

export interface AIInfoCardProps {
  name: string;
  model?: string;
  avatarUrl?: string | null;
  size?: 'medium' | 'large';
  onAvatarPress?: () => void;
  style?: StyleProp<ViewStyle>;
}

export default function AIInfoCard({
  name,
  model,
  avatarUrl,
  size = 'medium',
  onAvatarPress,
  style,
}: AIInfoCardProps) {
  const styles = useThemedStyles(createStyles);
  const isLarge = size === 'large';

  const avatar = (
    <AIAvatar
      name={name}
      avatarUrl={avatarUrl}
      size={isLarge ? 'large' : 'medium'}
    />
  );

  return (
    <View style={[styles.container, style]}>
      {onAvatarPress ? (
        <TouchableOpacity
          style={[styles.avatarSection, isLarge && styles.avatarSectionLarge]}
          onPress={onAvatarPress}
          activeOpacity={0.8}
        >
          <View style={styles.avatarWrapper}>
            {avatar}
            <View style={styles.editBadge}>
              <Text style={styles.editBadgeText}>+</Text>
            </View>
          </View>
        </TouchableOpacity>
      ) : (
        <View style={[styles.avatarSection, isLarge && styles.avatarSectionLarge]}>
          {avatar}
        </View>
      )}

      <View style={styles.info}>
        <Text style={[styles.name, isLarge && styles.nameLarge]}>
          {name || '未命名 AI'}
        </Text>
        {model ? (
          <Text style={styles.model}>{model}</Text>
        ) : null}
      </View>
    </View>
  );
}

const createStyles = (theme: PresentationTheme) => StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: theme.spacing.lg,
  },
  avatarSection: {
    marginRight: theme.spacing.lg,
  },
  avatarSectionLarge: {
    alignItems: 'center',
  },
  avatarWrapper: {
    position: 'relative',
  },
  editBadge: {
    position: 'absolute',
    bottom: -4,
    right: -4,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: theme.colors.brand.primary,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: theme.colors.surface.default,
  },
  editBadgeText: {
    fontSize: 12,
    color: theme.colors.brand.onPrimary,
    fontWeight: '600',
  },
  info: {
    flex: 1,
  },
  name: {
    fontSize: 16,
    fontWeight: '600',
    color: theme.colors.text.primary,
  },
  nameLarge: {
    fontSize: 18,
  },
  model: {
    fontSize: 13,
    color: theme.colors.text.secondary,
    marginTop: 4,
  },
});
