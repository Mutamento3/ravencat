/** 通用底部弹窗组件。 */

import type { ReactNode } from 'react';
import type { ViewStyle } from 'react-native';
import React, { useEffect, useRef, useState } from 'react';
import {
  Modal,
  Keyboard,
  KeyboardAvoidingView,
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Animated,
  TouchableWithoutFeedback,
  Dimensions,
} from 'react-native';
import { useTheme, useThemedStyles, ThemedSurface } from '@shared/theme';
import type { PresentationTheme } from '@shared/theme';

const SCREEN_HEIGHT = Dimensions.get('window').height;

export interface ModalSheetProps {
  visible: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  style?: ViewStyle;
  /** 表单弹窗的避让必须发生在 Modal 窗口内；调用方已有避让时无需开启。 */
  avoidKeyboard?: boolean;
}

const createStyles = (theme: PresentationTheme) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: theme.colors.surface.overlay,
    },
    keyboardContainer: {
      flex: 1,
      justifyContent: 'flex-end',
    },
    sheet: {
      borderTopLeftRadius: theme.components.modalSheet.radius,
      borderTopRightRadius: theme.components.modalSheet.radius,
      paddingBottom: 32,
      maxHeight: theme.components.modalSheet.maxHeight,
      overflow: 'hidden',
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: theme.spacing.lg,
      paddingVertical: theme.spacing.lg,
      borderBottomWidth: 0.5,
      borderBottomColor: theme.colors.border.light,
    },
    title: {
      ...theme.typography.title,
    },
    closeBtn: {
      padding: theme.spacing.sm,
      marginRight: -theme.spacing.sm,
    },
    closeText: {
      ...theme.typography.body,
      color: theme.colors.text.secondary,
    },
  });

export default function ModalSheet({
  visible,
  onClose,
  title,
  children,
  style,
  avoidKeyboard = false,
}: ModalSheetProps) {
  const [internalVisible, setInternalVisible] = useState(visible);
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(SCREEN_HEIGHT)).current;
  const theme = useTheme();
  const styles = useThemedStyles(createStyles);

  useEffect(() => {
    if (!avoidKeyboard || !internalVisible) return;
    setKeyboardVisible(Keyboard.isVisible());
    const showSubscription = Keyboard.addListener('keyboardDidShow', () => setKeyboardVisible(true));
    const hideSubscription = Keyboard.addListener('keyboardDidHide', () => setKeyboardVisible(false));
    return () => {
      showSubscription.remove();
      hideSubscription.remove();
    };
  }, [avoidKeyboard, internalVisible]);

  useEffect(() => {
    if (visible) {
      setInternalVisible(true);
      fadeAnim.stopAnimation();
      slideAnim.stopAnimation();
      Animated.parallel([
        Animated.timing(fadeAnim, {
          toValue: 1,
          duration: 250,
          useNativeDriver: true,
        }),
        Animated.timing(slideAnim, {
          toValue: 0,
          duration: 300,
          useNativeDriver: true,
        }),
      ]).start();
    } else {
      fadeAnim.stopAnimation();
      slideAnim.stopAnimation();
      Animated.parallel([
        Animated.timing(fadeAnim, {
          toValue: 0,
          duration: 200,
          useNativeDriver: true,
        }),
        Animated.timing(slideAnim, {
          toValue: SCREEN_HEIGHT,
          duration: 250,
          useNativeDriver: true,
        }),
      ]).start(({ finished }) => {
        if (finished) {
          setInternalVisible(false);
        }
      });
    }
  }, [fadeAnim, slideAnim, visible]);

  if (!internalVisible) {
    return null;
  }

  return (
    <Modal
      visible={internalVisible}
      transparent
      animationType="none"
      onRequestClose={onClose}
    >
      <Animated.View style={[styles.container, { opacity: fadeAnim }]}>
        {/* Android 隐藏事件的 screenY 不一定等于 Modal 高度；隐藏后禁用避让，避免残留留白。 */}
        <KeyboardAvoidingView
          style={styles.keyboardContainer}
          behavior="padding"
          enabled={avoidKeyboard && keyboardVisible}
        >
          <TouchableWithoutFeedback onPress={onClose}>
            <View style={StyleSheet.absoluteFill} />
          </TouchableWithoutFeedback>

          <Animated.View
            style={[
              styles.sheet,
              style,
              { transform: [{ translateY: slideAnim }] },
            ]}
          >
            <ThemedSurface
              nativeGlass
              variant="modal"
              backgroundColor={theme.components.modalSheet.backgroundColor}
              style={StyleSheet.absoluteFill}
            />
            {title ? (
              <View style={styles.header}>
                <Text style={styles.title}>{title}</Text>
                <TouchableOpacity
                  onPress={onClose}
                  style={styles.closeBtn}
                  activeOpacity={0.7}
                >
                  <Text style={styles.closeText}>关闭</Text>
                </TouchableOpacity>
              </View>
            ) : null}
            {children}
          </Animated.View>
        </KeyboardAvoidingView>
      </Animated.View>
    </Modal>
  );
}
