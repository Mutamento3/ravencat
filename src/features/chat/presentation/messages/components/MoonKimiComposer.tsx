/** Moon Kimi 主题专属的快捷操作与输入栏。 */

import React from 'react';
import {
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { ArrowUp, CirclePlus, LoaderCircle, WifiHigh, type LucideIcon } from 'lucide-react-native';
import { AppTextInput } from '@shared/ui';

import type { PresentationTheme } from '@shared/theme';
import type { createInputAreaStyles } from './chatInputStyles';
import { CHAT_INPUT_MAX_LENGTH } from './chatInputLimits';

type InputAreaStyles = ReturnType<typeof createInputAreaStyles>;

export interface MoonKimiQuickAction {
  id: string;
  label: string;
  Icon: LucideIcon;
}

interface MoonKimiComposerProps {
  actions: MoonKimiQuickAction[];
  allowDisabledPress: boolean;
  canSend: boolean;
  disabled: boolean;
  disabledPlaceholder: string;
  inputRef: React.RefObject<TextInput | null>;
  isInputSurfaceVisible: boolean;
  isPreparingAttachment: boolean;
  isToolPanelVisible: boolean;
  onChangeText: (text: string) => void;
  onDisabledPress: () => void;
  onFocus: () => void;
  onQuickActionPress?: (action: MoonKimiQuickAction) => void;
  onSend: () => void;
  onToggleToolPanel: () => void;
  onVoiceModePress: () => void;
  paddingBottom: number;
  shouldShowQuickActions: boolean;
  shouldShowSendButton: boolean;
  styles: InputAreaStyles;
  theme: PresentationTheme;
  value: string;
}

export function MoonKimiComposer({
  actions,
  allowDisabledPress,
  canSend,
  disabled,
  disabledPlaceholder,
  inputRef,
  isInputSurfaceVisible,
  isPreparingAttachment,
  isToolPanelVisible,
  onChangeText,
  onDisabledPress,
  onFocus,
  onQuickActionPress,
  onSend,
  onToggleToolPanel,
  onVoiceModePress,
  paddingBottom,
  shouldShowQuickActions,
  shouldShowSendButton,
  styles,
  theme,
  value,
}: MoonKimiComposerProps) {
  return (
    <>
      {shouldShowQuickActions ? (
        <View style={styles.moonKimiQuickActionsContainer}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.moonKimiQuickActionsContent}
          >
            {actions.map((action) => (
              <TouchableOpacity
                key={action.id}
                style={styles.moonKimiQuickAction}
                onPress={() => onQuickActionPress?.(action)}
                disabled={!onQuickActionPress}
                activeOpacity={0.78}
              >
                <action.Icon size={17} strokeWidth={1.65} color={theme.colors.icon.primary} />
                <Text style={styles.moonKimiQuickActionText}>{action.label}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      ) : null}

      <View style={[styles.inputContainer, styles.moonKimiInputContainer, { paddingBottom }]}>
        <View style={styles.moonKimiInputBar}>
          <TouchableOpacity style={styles.moonKimiVoiceButton} onPress={onVoiceModePress}>
            <WifiHigh
              size={20}
              strokeWidth={2}
              color={theme.colors.icon.primary}
              // 字形墨量在画布里偏上，旋转后变成水平偏移；rotate 后的 translateY 即屏幕左右方向
              style={{ transform: [{ rotate: '90deg' }, { translateY: -1 }] }}
            />
          </TouchableOpacity>
          <AppTextInput
            ref={inputRef}
            style={styles.moonKimiInput}
            value={value}
            onChangeText={onChangeText}
            placeholder={disabled ? disabledPlaceholder : '尽管问，带图也行'}
            placeholderTextColor={theme.colors.text.tertiary}
            maxLength={CHAT_INPUT_MAX_LENGTH}
            autoGrow
            textAlignVertical="center"
            scrollEnabled
            editable={!disabled}
            blurOnSubmit={false}
            onPressIn={disabled ? onDisabledPress : undefined}
            onFocus={onFocus}
          />
          <TouchableOpacity
            style={[
              styles.moonKimiInputIconButton,
              isToolPanelVisible && styles.iconButtonActive,
              { marginRight: theme.spacing.xs },
            ]}
            onPress={onToggleToolPanel}
          >
            <CirclePlus
              size={26}
              strokeWidth={1.65}
              color={isToolPanelVisible ? theme.colors.text.primary : theme.colors.icon.primary}
            />
          </TouchableOpacity>
          {shouldShowSendButton ? (
            <TouchableOpacity
              style={[styles.moonKimiSendButton, !canSend && styles.moonKimiSendButtonDisabled]}
              onPress={onSend}
              disabled={!canSend && !allowDisabledPress}
            >
              {isPreparingAttachment ? (
                <LoaderCircle size={16} strokeWidth={2} color={theme.colors.icon.inverse} />
              ) : (
                <ArrowUp size={16} strokeWidth={2} color={theme.colors.icon.inverse} />
              )}
            </TouchableOpacity>
          ) : null}
        </View>
        {!isInputSurfaceVisible ? (
          <Text style={styles.moonKimiDisclaimer}>内容由 AI 生成</Text>
        ) : null}
      </View>
    </>
  );
}
