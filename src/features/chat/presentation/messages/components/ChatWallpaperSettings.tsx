/** 管理聊天会话壁纸的选择、持久化与清除；预览与按钮视觉统一走 shared BackgroundPickerCard。 */

import React, { useCallback, useState } from 'react';
import { StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { pickCroppedImage } from '@platform/device/DeviceMediaService';
import {
  useTheme,
  useThemedStyles,
  useWallpaper,
  type PresentationTheme,
} from '@shared/theme';
import { BackgroundPickerCard, showAppDialog } from '@shared/ui';


interface ChatWallpaperSettingsProps {
  chatKey?: string | null;
  /** 允许宿主页面覆盖分区间距，避免与页面自身节奏叠加出过大的缝隙 */
  style?: StyleProp<ViewStyle>;
}

const createStyles = (theme: PresentationTheme) =>
  StyleSheet.create({
    section: {
      backgroundColor: theme.colors.surface.default,
      marginTop: theme.spacing.md,
      paddingHorizontal: theme.spacing.lg,
      paddingVertical: theme.spacing.lg,
      borderTopWidth: 8,
      borderBottomWidth: 8,
      borderColor: theme.colors.background.screen,
      borderRadius: 0,
    },
  });

export default function ChatWallpaperSettings({ chatKey, style }: ChatWallpaperSettingsProps) {
  const theme = useTheme();
  const styles = useThemedStyles(createStyles);
  const {
    chatWallpaperOverrides,
    getChatWallpaper,
    setCustomChatWallpaperOverride,
    setDefaultChatWallpaperOverride,
  } = useWallpaper();
  const [isPicking, setIsPicking] = useState(false);

  const overrideSelection = chatKey ? chatWallpaperOverrides[chatKey] : undefined;
  const activeSelection = getChatWallpaper(chatKey);
  const isOverridden = Boolean(overrideSelection);

  const handlePickWallpaper = useCallback(async () => {
    if (!chatKey) {
      showAppDialog({ title: '暂不可用', message: '当前对话还没有可保存的背景配置。', tone: 'warning' });
      return;
    }

    try {
      setIsPicking(true);
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        showAppDialog({ title: '需要权限', message: '请允许访问相册以选择聊天背景', tone: 'warning' });
        return;
      }

      const asset = await pickCroppedImage({ aspect: 'screen' });
      if (!asset) return;

      await setCustomChatWallpaperOverride(chatKey, asset.uri);

    } catch (error) {
      console.error('[ChatWallpaperSettings] Failed to update chat wallpaper:', error);
      showAppDialog({ title: '错误', message: '更换聊天背景失败，请稍后重试', tone: 'error' });
    } finally {
      setIsPicking(false);
    }
  }, [chatKey, setCustomChatWallpaperOverride]);

  const handleRestoreDefault = useCallback(() => {
    if (!chatKey || !overrideSelection) {
      return;
    }

    showAppDialog({ title: '恢复默认聊天背景', message: '该对话将恢复当前主题的默认背景。', buttons: [
      { text: '取消', style: 'cancel' },
      {
        text: '恢复',
        onPress: async () => {
          try {
            await setDefaultChatWallpaperOverride(chatKey);
          } catch (error) {
            console.error('[Wallpaper] 恢复默认背景失败：', error);
            showAppDialog({ title: '错误', message: '恢复默认背景失败，请稍后重试', tone: 'error' });
          }
        },
      },
    ] });
  }, [chatKey, overrideSelection, setDefaultChatWallpaperOverride]);

  return (
    <BackgroundPickerCard
      style={[styles.section, style]}
      title="聊天背景"
      description="只影响当前对话；恢复默认后使用当前主题的聊天背景。"
      previewSource={activeSelection.mode === 'custom' && activeSelection.uri ? { uri: activeSelection.uri } : null}
      previewFallbackColor={theme.colors.chat.screen}
      previewTitle={isOverridden ? '当前对话自定义' : '跟随主题默认'}
      previewSubtitle={activeSelection.mode === 'custom' ? '自定义图片背景' : (theme.mode === 'dark' ? '深色默认背景' : '浅色默认背景')}
      isPicking={isPicking}
      resetDimmed={!isOverridden}
      onPick={handlePickWallpaper}
      onReset={handleRestoreDefault}
    />
  );
}
