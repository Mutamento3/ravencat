/**
 * 背景类图片选择卡片：缩略预览 + 「更换 / 恢复默认」双按钮。
 *
 * 统一「全局背景 / 聊天背景 / 通话背景 / 时刻封面」这类设置的视觉语言。
 * 纯展示组件：选图、持久化、清除逻辑由调用方（各自的 controller / hook）承担。
 *
 * 按钮语义约定：
 * - `isPicking`：本卡片选图进行中，主按钮禁用并显示「选择中...」；
 * - `pickDisabled`：主按钮整体禁用（例如当前主题不支持、或另一张卡片正在选图）；
 * - `resetDisabled`：恢复按钮整体禁用；
 * - `resetDimmed`：恢复按钮只淡显不禁用（历史交互：已是默认时可点但按下无操作）。
 */

import React from 'react';
import {
  Image,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  type ImageSourcePropType,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { useThemedStyles } from '@shared/theme';
import type { PresentationTheme } from '@shared/theme';

export interface BackgroundPickerCardProps {
  /** 卡片标题，如「时刻封面」；缺省则不渲染标题区（调用方可自管卡片外标题）。 */
  title?: string;
  /** 标题下的说明文字。 */
  description?: string;
  /** 标题/描述与预览之间的自定义内容（例如应用范围分段选择）。 */
  children?: React.ReactNode;
  /** 当前图；缺省时显示占位块。 */
  previewSource?: ImageSourcePropType | null;
  /** 占位块颜色，默认跟随应用背景；聊天/通话背景类可传聊天底色。 */
  previewFallbackColor?: string;
  /** 预览右侧主文案，如「自定义封面」/「默认封面」。 */
  previewTitle: string;
  /** 预览右侧次文案。 */
  previewSubtitle?: string;
  /** 选图进行中：主按钮显示「选择中...」并禁用。 */
  isPicking?: boolean;
  /** 主按钮整体禁用（与 isPicking 叠加等价于任一成立即禁用）。 */
  pickDisabled?: boolean;
  pickLabel?: string;
  pickingLabel?: string;
  resetLabel?: string;
  /** 恢复按钮整体禁用。 */
  resetDisabled?: boolean;
  /** 恢复按钮只淡显文字、保持可点（用于「已是默认」的历史交互）。 */
  resetDimmed?: boolean;
  onPick: () => void;
  onReset: () => void;
  /** 可选：点击缩略图（例如打开全屏预览）。 */
  onPreviewPress?: () => void;
  style?: StyleProp<ViewStyle>;
}

const createStyles = (theme: PresentationTheme) =>
  StyleSheet.create({
    card: {
      backgroundColor: theme.colors.surface.default,
      borderRadius: theme.radius.lg,
      padding: theme.spacing.lg,
    },
    title: {
      fontSize: 17,
      fontWeight: '700',
      color: theme.colors.text.primary,
    },
    description: {
      marginTop: 4,
      fontSize: 13,
      lineHeight: 18,
      color: theme.colors.text.secondary,
    },
    previewRow: {
      flexDirection: 'row',
      alignItems: 'center',
      marginTop: theme.spacing.lg,
    },
    // 无标题/描述/自定义内容时预览即卡片首个元素，不再额外留白。
    previewRowFlush: {
      marginTop: 0,
    },
    preview: {
      width: 56,
      height: 56,
      borderRadius: theme.radius.md,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.colors.border.default,
      overflow: 'hidden',
      marginRight: theme.spacing.md,
    },
    previewImage: {
      width: '100%',
      height: '100%',
    },
    previewFallback: {
      flex: 1,
    },
    previewInfo: {
      flex: 1,
    },
    previewTitle: {
      fontSize: 15,
      fontWeight: '600',
      color: theme.colors.text.primary,
    },
    previewSubtitle: {
      marginTop: 2,
      fontSize: 12,
      color: theme.colors.text.tertiary,
    },
    actions: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.sm,
      marginTop: theme.spacing.lg,
    },
    button: {
      flex: 1,
      minHeight: 42,
      borderRadius: theme.radius.md,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: theme.colors.brand.primary,
    },
    secondaryButton: {
      backgroundColor: theme.colors.surface.muted,
    },
    buttonText: {
      fontSize: 14,
      fontWeight: '600',
      color: theme.colors.brand.onPrimary,
    },
    secondaryButtonText: {
      color: theme.colors.text.primary,
    },
    disabledButton: {
      opacity: 0.45,
    },
    disabledText: {
      color: theme.colors.text.tertiary,
    },
  });

export default function BackgroundPickerCard({
  title,
  description,
  children,
  previewSource,
  previewFallbackColor,
  previewTitle,
  previewSubtitle,
  isPicking = false,
  pickDisabled = false,
  pickLabel = '更换背景',
  pickingLabel = '选择中...',
  resetLabel = '恢复默认',
  resetDisabled = false,
  resetDimmed = false,
  onPick,
  onReset,
  onPreviewPress,
  style,
}: BackgroundPickerCardProps) {
  const styles = useThemedStyles(createStyles);
  const pickInactive = isPicking || pickDisabled;
  const hasHeaderContent = Boolean(title) || Boolean(description) || Boolean(children);

  const preview = (
    <View style={styles.preview}>
      {previewSource ? (
        <Image source={previewSource} style={styles.previewImage} resizeMode="cover" />
      ) : (
        <View
          style={[
            styles.previewFallback,
            previewFallbackColor ? { backgroundColor: previewFallbackColor } : null,
          ]}
        />
      )}
    </View>
  );

  return (
    <View style={[styles.card, style]}>
      {title ? <Text style={styles.title}>{title}</Text> : null}
      {description ? <Text style={styles.description}>{description}</Text> : null}
      {children}

      <View style={[styles.previewRow, !hasHeaderContent && styles.previewRowFlush]}>
        {onPreviewPress ? (
          <TouchableOpacity onPress={onPreviewPress} activeOpacity={0.8}>
            {preview}
          </TouchableOpacity>
        ) : (
          preview
        )}
        <View style={styles.previewInfo}>
          <Text style={styles.previewTitle}>{previewTitle}</Text>
          {previewSubtitle ? <Text style={styles.previewSubtitle}>{previewSubtitle}</Text> : null}
        </View>
      </View>

      <View style={styles.actions}>
        <TouchableOpacity
          style={[styles.button, pickInactive && styles.disabledButton]}
          activeOpacity={0.8}
          disabled={pickInactive}
          onPress={onPick}
        >
          <Text style={[styles.buttonText, pickInactive && styles.disabledText]}>
            {isPicking ? pickingLabel : pickLabel}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.button, styles.secondaryButton, resetDisabled && styles.disabledButton]}
          activeOpacity={0.8}
          disabled={resetDisabled}
          onPress={onReset}
        >
          <Text
            style={[
              styles.buttonText,
              styles.secondaryButtonText,
              (resetDisabled || resetDimmed) && styles.disabledText,
            ]}
          >
            {resetLabel}
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}
