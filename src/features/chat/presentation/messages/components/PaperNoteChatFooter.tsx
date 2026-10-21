/** 纸条主题聊天列表底部的静态尾栏：图标 + 一句话，跟随列表滚动，永远位于最后一条消息之后。 */
import React, { memo, useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { persistentImageStore } from '@platform/device';
import type { PresentationTheme } from '@shared/theme';
import { useThemeContext, useThemedStyles } from '@shared/theme';
import { MimeAwareImage } from '@shared/ui';

const FOOTER_ICON_SIZE = 65;

const createPaperNoteFooterStyles = (theme: PresentationTheme) =>
  StyleSheet.create({
    footer: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.md,
      paddingHorizontal: theme.spacing.lg,
      paddingTop: theme.spacing.lg,
      // 底部留白明显大于顶部：尾栏的存在感来自"把最后一条消息和输入区隔开"。
      paddingBottom: theme.spacing.xxl + 12,
    },
    text: {
      flex: 1,
      fontSize: 13,
      lineHeight: 20,
      color: theme.colors.text.secondary,
      textAlign: 'right',
      includeFontPadding: false,
    },
  });

interface PaperNoteChatFooterProps {
  /** 当前会话的 AI 显示名，用于默认文案；null 时使用内置名字。 */
  aiName?: string | null;
}

function PaperNoteChatFooter({ aiName }: PaperNoteChatFooterProps) {
  const styles = useThemedStyles(createPaperNoteFooterStyles);
  const { chatFooter } = useThemeContext();
  const imageRef = chatFooter.image;
  const [imageUri, setImageUri] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    if (!imageRef) {
      setImageUri(null);
      return;
    }
    persistentImageStore
      .resolveAssetStorageKey(imageRef.storageKey)
      .then((uri) => {
        if (active) setImageUri(uri);
      })
      .catch((error) => {
        console.warn('[PaperNoteChatFooter] 底栏图标读取失败，回退内置图标：', error);
        if (active) setImageUri(null);
      });
    return () => {
      active = false;
    };
  }, [imageRef]);

  const text = chatFooter.text?.trim() || `${aiName?.trim() || 'Yaya'} is always here`;

  return (
    <View style={styles.footer} pointerEvents="none">
      <MimeAwareImage
        uri={imageUri}
        mimeType={imageRef?.mimeType}
        fallbackSource={require('../../../../../../assets/yaya.png')}
        width={FOOTER_ICON_SIZE}
        height={FOOTER_ICON_SIZE}
      />
      <Text style={styles.text}>
        {text}
      </Text>
    </View>
  );
}

export default memo(PaperNoteChatFooter);
