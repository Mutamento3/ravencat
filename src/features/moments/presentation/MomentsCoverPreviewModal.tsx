// 朋友圈封面预览弹窗。
// 朋友圈封面预览与更换弹窗

import React, { useMemo } from 'react';
import {
  Image,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  Dimensions,
} from 'react-native';
import type { ImageSourcePropType } from 'react-native';

import { useTheme } from '@shared/theme';
import type { PresentationTheme } from '@shared/theme';

// 暗色媒体预览界面的局部语义常量（非模块私有主题，仅用于此特殊预览视觉）
const PREVIEW_PALETTE = {
  overlay: 'rgba(0, 0, 0, 0.92)',
  imagePlaceholder: 'rgba(255, 255, 255, 0.08)',
  buttonBg: 'rgba(255, 255, 255, 0.14)',
  buttonBgDanger: 'rgba(255, 59, 48, 0.18)',
  buttonBgCancel: 'rgba(255, 255, 255, 0.08)',
  textPrimary: '#FFFFFF',
  textDanger: '#FF453A',
  textSecondary: 'rgba(255, 255, 255, 0.7)',
};

interface MomentsCoverPreviewModalProps {
  visible: boolean;
  coverSource: ImageSourcePropType;
  hasCustomCover: boolean;
  isUpdating: boolean;
  onClose: () => void;
  onPickCover: () => void;
  onResetCover: () => void;
}

const SCREEN_WIDTH = Dimensions.get('window').width;

function createPreviewStyles(theme: PresentationTheme) {
  return StyleSheet.create({
    overlay: {
      flex: 1,
      backgroundColor: PREVIEW_PALETTE.overlay,
      justifyContent: 'center',
      alignItems: 'center',
    },
    backdrop: {
      ...StyleSheet.absoluteFillObject,
    },
    content: {
      width: '100%',
      alignItems: 'center',
      paddingHorizontal: theme.spacing.lg,
    },
    imageContainer: {
      width: SCREEN_WIDTH - theme.spacing.lg * 2,
      height: (SCREEN_WIDTH - theme.spacing.lg * 2) * 0.5625,
      borderRadius: theme.radius.md,
      overflow: 'hidden',
      backgroundColor: PREVIEW_PALETTE.imagePlaceholder,
    },
    image: {
      width: '100%',
      height: '100%',
    },
    actions: {
      width: '100%',
      marginTop: theme.spacing.xl,
      gap: theme.spacing.md,
    },
    actionButton: {
      backgroundColor: PREVIEW_PALETTE.buttonBg,
      paddingVertical: 14,
      borderRadius: theme.radius.md,
      alignItems: 'center',
    },
    actionButtonDanger: {
      backgroundColor: PREVIEW_PALETTE.buttonBgDanger,
    },
    actionButtonCancel: {
      backgroundColor: PREVIEW_PALETTE.buttonBgCancel,
    },
    actionButtonText: {
      color: PREVIEW_PALETTE.textPrimary,
      fontSize: 16,
      fontWeight: '600',
    },
    actionButtonTextDanger: {
      color: PREVIEW_PALETTE.textDanger,
    },
    actionButtonTextCancel: {
      color: PREVIEW_PALETTE.textSecondary,
    },
    updatingText: {
      color: PREVIEW_PALETTE.textSecondary,
      fontSize: 16,
      textAlign: 'center',
      paddingVertical: 14,
    },
  });
}

export default function MomentsCoverPreviewModal({
  visible,
  coverSource,
  hasCustomCover,
  isUpdating,
  onClose,
  onPickCover,
  onResetCover,
}: MomentsCoverPreviewModalProps) {
  const theme = useTheme();
  const styles = useMemo(() => createPreviewStyles(theme), [theme]);

  return (
    <Modal
      visible={visible}
      animationType="fade"
      transparent
      onRequestClose={onClose}
    >
      <View style={styles.overlay}>
        <Pressable style={styles.backdrop} onPress={onClose} />

        <View style={styles.content}>
          <View style={styles.imageContainer}>
            <Image
              source={coverSource}
              style={styles.image}
              resizeMode="cover"
            />
          </View>

          <View style={styles.actions}>
            {isUpdating ? (
              <Text style={styles.updatingText}>正在更新封面...</Text>
            ) : (
              <>
                <TouchableOpacity
                  style={styles.actionButton}
                  onPress={onPickCover}
                  activeOpacity={0.7}
                >
                  <Text style={styles.actionButtonText}>从相册选择</Text>
                </TouchableOpacity>

                {hasCustomCover ? (
                  <TouchableOpacity
                    style={[styles.actionButton, styles.actionButtonDanger]}
                    onPress={onResetCover}
                    activeOpacity={0.7}
                  >
                    <Text style={[styles.actionButtonText, styles.actionButtonTextDanger]}>
                      恢复默认封面
                    </Text>
                  </TouchableOpacity>
                ) : null}

                <TouchableOpacity
                  style={[styles.actionButton, styles.actionButtonCancel]}
                  onPress={onClose}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.actionButtonText, styles.actionButtonTextCancel]}>
                    关闭
                  </Text>
                </TouchableOpacity>
              </>
            )}
          </View>
        </View>
      </View>
    </Modal>
  );
}
