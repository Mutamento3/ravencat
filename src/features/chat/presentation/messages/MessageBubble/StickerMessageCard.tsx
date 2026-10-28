/** 渲染独立 Sticker 消息卡；媒体通过 MediaAsset resolver 解析，不走普通图片附件链。 */

import React, { useEffect, useMemo } from 'react';
import {
  ActivityIndicator,
  Image,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRecyclingState } from '@shopify/flash-list';

import { resolveMediaAsset } from '@features/media';
import type { StickerMessageSnapshot } from '@features/chat/messages/domain';
import { useTheme, useThemedStyles } from '@shared/theme';
import type { PresentationTheme } from '@shared/theme';

interface StickerMessageCardProps {
  sticker: StickerMessageSnapshot;
}

const CARD_WIDTH = 130;
const DEFAULT_CARD_HEIGHT = 104;

function clampHeight(height: number): number {
  return Math.max(72, Math.min(height, 130));
}

type StickerResolutionState =
  | { status: 'loading' | 'unavailable' }
  | { status: 'ready'; localUri: string };

export default function StickerMessageCard({ sticker }: StickerMessageCardProps) {
  const theme = useTheme();
  const styles = useThemedStyles(createStyles);
  const [resolution, setResolution] = useRecyclingState<StickerResolutionState>(
    { status: 'loading' },
    [sticker.mediaAssetId],
  );

  useEffect(() => {
    let isMounted = true;

    void resolveMediaAsset(sticker.mediaAssetId)
      .then((resolved) => {
        if (isMounted) {
          setResolution({ status: 'ready', localUri: resolved.localUri });
        }
      })
      .catch(() => {
        // backing 缺失是可展示的历史消息状态，卡片保留占位而不改写消息事实。
        if (isMounted) {
          setResolution({ status: 'unavailable' });
        }
      });

    return () => {
      isMounted = false;
    };
  }, [sticker.mediaAssetId, setResolution]);

  const imageStyle = useMemo(() => {
    const width = sticker.width || 0;
    const height = sticker.height || 0;
    if (!width || !height) {
      return styles.imageFixed;
    }

    return {
      ...styles.imageFixed,
      height: clampHeight((CARD_WIDTH * height) / width),
    };
  }, [sticker.height, sticker.width, styles.imageFixed]);

  return (
    <View style={styles.container}>
      {resolution.status === 'ready' ? (
        <Image
          source={{ uri: resolution.localUri }}
          style={imageStyle}
          resizeMode="contain"
        />
      ) : (
        <View style={[imageStyle, styles.placeholder]}>
          {resolution.status === 'loading' ? (
            <ActivityIndicator color={theme.colors.icon.secondary} accessibilityLabel="表情包加载中" />
          ) : (
            <>
              <Ionicons name="happy-outline" size={28} color={theme.colors.icon.secondary} />
              <Text style={styles.placeholderText}>表情包不可用</Text>
            </>
          )}
        </View>
      )}
    </View>
  );
}

const createStyles = (theme: PresentationTheme) => StyleSheet.create({
  container: {
    width: CARD_WIDTH,
    alignItems: 'flex-start',
  },
  imageFixed: {
    width: CARD_WIDTH,
    height: DEFAULT_CARD_HEIGHT,
    borderRadius: theme.radius.sm,
    backgroundColor: 'transparent',
  },
  placeholder: {
    justifyContent: 'center',
    alignItems: 'center',
    gap: 6,
    backgroundColor: theme.colors.border.light + '55',
  },
  placeholderText: {
    fontSize: 12,
    color: theme.colors.text.secondary,
  },
});
