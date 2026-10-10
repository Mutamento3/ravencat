import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Keyboard,
  Modal,
  Pressable,
  TextInput,
  TouchableOpacity,
  View,
  type KeyboardEvent,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useTheme, useThemedStyles } from '@shared/theme';
import { createCallStyles } from '../styles';

interface CallTextInputModalProps {
  visible: boolean;
  onClose: () => void;
  onSend: (text: string) => Promise<void> | void;
  disabled?: boolean;
  title?: string;
}

export default function CallTextInputModal({
  visible,
  onClose,
  onSend,
  disabled = false,
  title = '发消息',
}: CallTextInputModalProps) {
  const theme = useTheme();
  const styles = useThemedStyles(createCallStyles);
  const insets = useSafeAreaInsets();
  const inputRef = useRef<TextInput>(null);
  const visibleRef = useRef(visible);
  const focusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const keyboardVisibleRef = useRef(false);
  const [text, setText] = useState('');
  const [keyboardHeight, setKeyboardHeight] = useState(0);

  const focusInput = useCallback(() => {
    if (focusTimerRef.current) {
      clearTimeout(focusTimerRef.current);
    }

    focusTimerRef.current = setTimeout(() => {
      inputRef.current?.focus();
      focusTimerRef.current = null;
    }, 80);
  }, []);

  useEffect(() => {
    visibleRef.current = visible;

    if (visible) {
      setText('');
      setKeyboardHeight(0);
      return undefined;
    }

    setText('');
    setKeyboardHeight(0);
    keyboardVisibleRef.current = false;
    if (focusTimerRef.current) {
      clearTimeout(focusTimerRef.current);
      focusTimerRef.current = null;
    }
    inputRef.current?.blur();
    Keyboard.dismiss();
    return undefined;
  }, [visible]);

  useEffect(() => {
    const showSubscription = Keyboard.addListener('keyboardDidShow', (event: KeyboardEvent) => {
      keyboardVisibleRef.current = true;
      setKeyboardHeight(event.endCoordinates.height);
    });
    const hideSubscription = Keyboard.addListener('keyboardDidHide', () => {
      keyboardVisibleRef.current = false;
      setKeyboardHeight(0);

      if (visibleRef.current) {
        onClose();
      }
    });

    return () => {
      showSubscription.remove();
      hideSubscription.remove();
      if (focusTimerRef.current) {
        clearTimeout(focusTimerRef.current);
      }
    };
  }, [onClose]);

  const canSend = !disabled && text.trim().length > 0;

  const handleClose = useCallback(() => {
    inputRef.current?.blur();

    if (keyboardVisibleRef.current) {
      Keyboard.dismiss();
      return;
    }

    setKeyboardHeight(0);
    onClose();
  }, [onClose]);

  const handleSend = useCallback(async () => {
    if (!canSend) {
      return;
    }

    const nextText = text.trim();
    setText('');

    handleClose();

    await onSend(nextText);
  }, [canSend, handleClose, onSend, text]);

  const dynamicPaddingBottom = Math.max(insets.bottom, 12) + keyboardHeight;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onShow={focusInput}
      onRequestClose={handleClose}
    >
      <View style={styles.textInputModalOverlay}>
        <Pressable style={styles.textInputModalBackdrop} onPress={handleClose} />
        <View style={[styles.textInputModalDock, { paddingBottom: dynamicPaddingBottom }]}>
          <View style={styles.textInputModalRow}>
            <TextInput
              ref={inputRef}
              style={styles.textInputModalInput}
              value={text}
              onChangeText={setText}
              placeholder="输入消息..."
              placeholderTextColor={theme.colors.text.tertiary}
              accessibilityLabel={title}
              editable={!disabled}
              multiline={false}
              blurOnSubmit={false}
              textAlignVertical="center"
              returnKeyType="send"
              onSubmitEditing={() => {
                void handleSend();
              }}
            />
            <TouchableOpacity
              style={[
                styles.textInputModalSendButton,
                !canSend ? styles.textInputModalSendButtonDisabled : null,
              ]}
              onPress={() => {
                void handleSend();
              }}
              disabled={!canSend}
              activeOpacity={0.76}
            >
              <Ionicons
                name="send"
                size={18}
                color={canSend ? theme.colors.brand.onPrimary : theme.colors.icon.disabled}
              />
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}
