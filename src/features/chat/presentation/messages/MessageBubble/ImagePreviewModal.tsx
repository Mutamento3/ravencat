/** 普通图片的全屏预览；弹窗内单独建立手势根，关闭后销毁缩放状态。 */
import React from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { X } from 'lucide-react-native';
import { getThemeById, useTheme } from '@shared/theme';
import ZoomableImage from './ZoomableImage';

interface ImagePreviewModalProps {
  visible: boolean;
  imageUri: string | null;
  onClose: () => void;
}

function PreviewContent({ imageUri, onClose }: { imageUri: string; onClose: () => void }) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <GestureHandlerRootView style={styles.root}>
      <ZoomableImage imageUri={imageUri} onSingleTap={onClose} />
      <View pointerEvents="box-none" style={[styles.controls, {
        top: insets.top + theme.spacing.sm,
        right: insets.right + theme.spacing.md,
      }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="关闭图片预览"
          hitSlop={8}
          style={styles.closeButton}
          onPress={onClose}
        >
          <X size={24} color={viewerTheme.colors.text.primary} />
        </Pressable>
      </View>
    </GestureHandlerRootView>
  );
}

export default function ImagePreviewModal({ visible, imageUri, onClose }: ImagePreviewModalProps) {
  return (
    <Modal
      visible={visible}
      animationType="fade"
      statusBarTranslucent
      navigationBarTranslucent
      hardwareAccelerated
      onRequestClose={onClose}
    >
      {visible && imageUri ? <PreviewContent key={imageUri} imageUri={imageUri} onClose={onClose} /> : null}
    </Modal>
  );
}

// 看图使用共享深色主题的黑底白字，不随聊天气泡配色改变对比度。
const viewerTheme = getThemeById('default-dark');
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: viewerTheme.colors.background.app },
  controls: { position: 'absolute' },
  closeButton: {
    width: 44,
    height: 44,
    borderRadius: viewerTheme.radius.round,
    backgroundColor: viewerTheme.effects.overlay.dim,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
