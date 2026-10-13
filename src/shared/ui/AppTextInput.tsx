/** 输入基础控件；换行与内容测量交给原生 TextInput，业务值和提交由调用方拥有。 */
import React, { forwardRef } from 'react';
import { TextInput, StyleSheet, type TextInputProps } from 'react-native';
import { useTheme } from '@shared/theme';

export interface AppTextInputProps extends TextInputProps {
  /** 从单行高度随内容增长；可通过 style 的 minHeight / maxHeight 调整范围。 */
  autoGrow?: boolean;
}

const styles = StyleSheet.create({
  growing: { minHeight: 36, maxHeight: 160 },
});

const AppTextInput = forwardRef<TextInput, AppTextInputProps>(function AppTextInput({
  autoGrow = false,
  multiline = false,
  style,
  placeholderTextColor,
  textAlignVertical,
  underlineColorAndroid = 'transparent',
  ...props
}, ref) {
  const theme = useTheme();
  return (
    <TextInput
      {...props}
      ref={ref}
      multiline={multiline || autoGrow}
      style={[{ color: theme.colors.text.primary }, autoGrow && styles.growing, style]}
      placeholderTextColor={placeholderTextColor ?? theme.colors.text.tertiary}
      textAlignVertical={textAlignVertical ?? (multiline || autoGrow ? 'top' : 'center')}
      underlineColorAndroid={underlineColorAndroid}
    />
  );
});

export default AppTextInput;
