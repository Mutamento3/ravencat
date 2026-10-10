/** 颜色选择弹窗：预设色板 + hex 输入，选择即生效。 */

import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, TextInput } from 'react-native';
import ModalSheet from './ModalSheet';
import { useTheme, useThemedStyles } from '@shared/theme';
import type { PresentationTheme } from '@shared/theme';

/** 预设色板，覆盖常见聊天文字颜色需求。 */
const PRESET_COLORS: string[] = [
  '#FFFFFF',
  '#000000',
  '#1A1A1A',
  '#1C1C1E',
  '#34475A',
  '#666666',
  '#8E8E93',
  '#3A9BEF',
  '#FF3B30',
  '#FF9500',
  '#34C759',
  '#AF52DE',
  '#5856D6',
  '#FF2D55',
  '#00C7BE',
  '#FFFDF4',
];

/** 校验 hex 颜色格式（支持 #RGB / #RRGGBB，不区分大小写）。 */
function isValidHex(color: string): boolean {
  return /^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/.test(color);
}

export interface ColorPickerModalProps {
  visible: boolean;
  title: string;
  /** 当前选中的颜色值 */
  currentColor: string;
  /** 主题默认颜色（用于"恢复默认"） */
  defaultColor: string;
  onClose: () => void;
  /** 选择某个颜色后即时保存并关闭弹窗 */
  onConfirm: (color: string) => void;
  /** 恢复为主题默认值 */
  onReset?: (() => void) | null;
}

const createStyles = (theme: PresentationTheme) =>
  StyleSheet.create({
    content: {
      paddingHorizontal: theme.spacing.lg,
      paddingBottom: theme.spacing.lg,
    },
    previewRow: {
      flexDirection: 'row',
      alignItems: 'center',
      marginBottom: theme.spacing.md,
    },
    previewSwatch: {
      width: 44,
      height: 44,
      borderRadius: theme.radius.md,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.colors.border.default,
      marginRight: theme.spacing.md,
    },
    previewLabel: {
      flex: 1,
      fontSize: 14,
      color: theme.colors.text.secondary,
    },
    presetGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: theme.spacing.sm,
      marginBottom: theme.spacing.lg,
    },
    presetSwatch: {
      width: 36,
      height: 36,
      borderRadius: theme.radius.sm,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.colors.border.light,
    },
    presetSwatchSelected: {
      borderWidth: 2,
      borderColor: theme.colors.brand.primary,
    },
    hexInputRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.sm,
      marginBottom: theme.spacing.md,
    },
    hexInput: {
      flex: 1,
      backgroundColor: theme.colors.surface.input,
      borderRadius: theme.radius.md,
      paddingHorizontal: theme.spacing.md,
      paddingVertical: 10,
      fontSize: 16,
      color: theme.colors.text.primary,
    },
    hexInputInvalid: {
      borderWidth: 1,
      borderColor: theme.colors.feedback.error,
    },
    hexError: {
      fontSize: 12,
      color: theme.colors.feedback.error,
      marginBottom: theme.spacing.md,
    },
    resetButton: {
      minHeight: 42,
      borderRadius: theme.radius.md,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: theme.colors.surface.muted,
    },
    resetButtonText: {
      fontSize: 14,
      fontWeight: '600',
      color: theme.colors.text.primary,
    },
    resetButtonDisabled: {
      opacity: 0.45,
    },
  });

export default function ColorPickerModal({
  visible,
  title,
  currentColor,
  defaultColor,
  onClose,
  onConfirm,
  onReset,
}: ColorPickerModalProps) {
  const theme = useTheme();
  const styles = useThemedStyles(createStyles);
  const [hexInput, setHexInput] = useState(currentColor);
  const isDefault = currentColor === defaultColor;

  // 弹窗打开时同步输入框
  useEffect(() => {
    if (visible) {
      setHexInput(currentColor);
    }
  }, [visible, currentColor]);

  // 点击预设色板：即时保存并关闭
  const handlePresetSelect = useCallback(
    (color: string) => {
      onConfirm(color);
      onClose();
    },
    [onConfirm, onClose]
  );

  // hex 输入框失焦：如果有效则即时保存并关闭
  const handleHexSubmit = useCallback(() => {
    const trimmed = hexInput.trim();
    if (isValidHex(trimmed)) {
      onConfirm(trimmed);
      onClose();
    }
  }, [hexInput, onConfirm, onClose]);

  // 恢复默认：即时恢复并关闭
  const handleReset = useCallback(() => {
    if (onReset) {
      onReset();
      onClose();
    }
  }, [onReset, onClose]);

  const inputValid = isValidHex(hexInput.trim());

  return (
    <ModalSheet visible={visible} onClose={onClose} title={title}>
      <View style={styles.content}>
        {/* 当前颜色预览 */}
        <View style={styles.previewRow}>
          <View style={[styles.previewSwatch, { backgroundColor: currentColor }]} />
          <Text style={styles.previewLabel}>
            {isDefault ? '主题默认' : '自定义'}
          </Text>
        </View>

        {/* 预设色板 — 点击即保存 */}
        <View style={styles.presetGrid}>
          {PRESET_COLORS.map((color) => {
            const selected = currentColor.toUpperCase() === color.toUpperCase();
            return (
              <TouchableOpacity
                key={color}
                style={[
                  styles.presetSwatch,
                  { backgroundColor: color },
                  selected && styles.presetSwatchSelected,
                ]}
                activeOpacity={0.7}
                onPress={() => handlePresetSelect(color)}
              />
            );
          })}
        </View>

        {/* hex 输入 — 失焦时自动保存 */}
        <View style={styles.hexInputRow}>
          <TextInput
            style={[styles.hexInput, !inputValid && styles.hexInputInvalid]}
            value={hexInput}
            onChangeText={setHexInput}
            placeholder="#RRGGBB"
            placeholderTextColor={theme.colors.text.tertiary}
            autoCapitalize="characters"
            autoCorrect={false}
            maxLength={7}
            onBlur={handleHexSubmit}
            returnKeyType="done"
            onSubmitEditing={handleHexSubmit}
          />
        </View>
        {!inputValid && hexInput.length > 0 ? (
          <Text style={styles.hexError}>请输入有效的 hex 颜色，如 #1A1A1A</Text>
        ) : null}

        {/* 恢复默认按钮 */}
        {onReset ? (
          <TouchableOpacity
            style={[styles.resetButton, isDefault && styles.resetButtonDisabled]}
            activeOpacity={0.8}
            disabled={isDefault}
            onPress={handleReset}
          >
            <Text style={[styles.resetButtonText, isDefault && styles.resetButtonDisabled]}>
              恢复默认
            </Text>
          </TouchableOpacity>
        ) : null}
      </View>
    </ModalSheet>
  );
}