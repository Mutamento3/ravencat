/** 按 MIME 渲染本地图片：SVG 走 SvgUri，其余走 Image；uri 为空时显示兜底图。 */
import React from 'react';
import { Image, type ImageResizeMode, type ImageSourcePropType, type StyleProp, type ImageStyle } from 'react-native';
import { SvgUri } from 'react-native-svg';

export interface MimeAwareImageProps {
  /** 本地 file/content URI；null 表示使用 fallbackSource。 */
  uri: string | null;
  /** 决定 SVG 与光栅图的渲染分支；未知类型按光栅处理。 */
  mimeType?: string | null;
  /** uri 为空时显示的本地兜底图（例如内置的 yaya.png require 结果）。 */
  fallbackSource?: ImageSourcePropType;
  width: number;
  height: number;
  resizeMode?: ImageResizeMode;
  style?: StyleProp<ImageStyle>;
}

export default function MimeAwareImage({
  uri,
  mimeType,
  fallbackSource,
  width,
  height,
  resizeMode = 'contain',
  style,
}: MimeAwareImageProps) {
  if (!uri) {
    if (!fallbackSource) return null;
    return (
      <Image
        source={fallbackSource}
        style={[{ width, height }, style]}
        resizeMode={resizeMode}
      />
    );
  }

  if (mimeType === 'image/svg+xml') {
    return <SvgUri width={width} height={height} uri={uri} style={style} />;
  }

  return (
    <Image
      source={{ uri }}
      style={[{ width, height }, style]}
      resizeMode={resizeMode}
    />
  );
}
