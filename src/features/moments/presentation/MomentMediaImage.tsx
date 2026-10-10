/** 可见图片拥有资源解析与解码状态；刷新社交事实不会重新加载同一份图片。 */
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator, Image, StyleSheet, Text, View,
  type StyleProp, type ViewStyle,
} from 'react-native';
import { resolveMediaAsset } from '@features/media';
import { useTheme } from '@shared/theme';

interface Props {
  mediaAssetId: string;
  style: StyleProp<ViewStyle>;
  resizeMode: 'cover' | 'contain';
  color?: string;
}

const styles = StyleSheet.create({
  container: { alignItems: 'center', justifyContent: 'center' },
  placeholder: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
});

function ResolvedMomentMediaImage({ mediaAssetId, style, resizeMode, color }: Props) {
  const theme = useTheme();
  const [uri, setUri] = useState<string | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'unavailable'>('loading');

  useEffect(() => {
    let active = true;
    void resolveMediaAsset(mediaAssetId).then(({ localUri }) => {
      if (active) setUri(localUri);
    }).catch((error: unknown) => {
      if (!active) return;
      console.warn('[Moments] 图片资产解析失败：', { mediaAssetId, error });
      setStatus('unavailable');
    });
    return () => { active = false; };
  }, [mediaAssetId]);

  return (
    <View style={[styles.container, style]}>
      {uri !== null && status !== 'unavailable' ? (
        <Image
          source={{ uri }}
          style={StyleSheet.absoluteFillObject}
          resizeMode={resizeMode}
          onLoad={() => setStatus('ready')}
          onError={() => setStatus('unavailable')}
        />
      ) : null}
      {status === 'loading' ? (
        <View style={styles.placeholder} pointerEvents="none">
          <ActivityIndicator color={color ?? theme.colors.brand.primary} accessibilityLabel="图片加载中" />
        </View>
      ) : null}
      {status === 'unavailable' ? (
        <Text style={{ color: color ?? theme.colors.text.secondary }}>图片不可用</Text>
      ) : null}
    </View>
  );
}

export default function MomentMediaImage(props: Props) {
  // 资产身份变化时同时重置原生 Image 与异步状态，旧资源的回调不能覆盖新图片。
  return <ResolvedMomentMediaImage key={props.mediaAssetId} {...props} />;
}
