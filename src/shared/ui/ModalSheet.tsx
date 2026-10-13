/** 通用底部弹窗组件。 */

import type { ReactNode } from 'react';
import type { ViewStyle } from 'react-native';
import React, { useEffect, useRef, useState } from 'react';
import {
  Modal,
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
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import KeyboardAvoidingContainer from './KeyboardAvoidingContainer';

const SCREEN_HEIGHT = Dimensions.get('window').height;

export interface ModalSheetProps {
  visible: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  style?: ViewStyle;
  /** 表单弹窗在自己的 Modal 窗口内避让，内容无需再包避让容器。 */
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
      color: theme.colors.text.primary,
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
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(SCREEN_HEIGHT)).current;
  const theme = useTheme();
  const styles = useThemedStyles(createStyles);
  const insets = useSafeAreaInsets();

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
      statusBarTranslucent
      navigationBarTranslucent
      animationType="none"
      onRequestClose={onClose}
    >
      <Animated.View style={[styles.container, { opacity: fadeAnim }]}>
        <KeyboardAvoidingContainer
          style={styles.keyboardContainer}
          enabled={avoidKeyboard}
        >
          <TouchableWithoutFeedback onPress={onClose}>
            <View style={StyleSheet.absoluteFill} />
          </TouchableWithoutFeedback>

          <Animated.View
            style={[
              styles.sheet,
              { paddingBottom: Math.max(32, insets.bottom) },
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
        </KeyboardAvoidingContainer>
      </Animated.View>
    </Modal>
  );
}
