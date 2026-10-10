/** 统一解析资源与回退内容的 AI 头像组件。 */

import type { StyleProp, ViewStyle } from 'react-native';
import React from 'react';
import { AVATAR_SHAPE, AVATAR_SIZE_MAP, type AvatarShape, type AvatarSize } from '@shared/avatar/avatarConstants';
import { resolveAIAvatarSource } from '@shared/avatar/resolveAvatarSource';
import AvatarImage from './AvatarImage';

export interface AIAvatarProps {
  name?: string;
  avatarUrl?: string | null;
  size?: AvatarSize;
  shape?: AvatarShape;
  style?: StyleProp<ViewStyle>;
}

/**
 * AI 头像组件
 * @param name - AI 名称，用于取首字母
 * @param avatarUrl - 头像图片 URL / 本地持久化 URI
 * @param size - 尺寸
 * @param shape - 形状
 * @param style - 额外样式
 */
export default function AIAvatar({
  name,
  avatarUrl,
  size = 'medium',
  shape = AVATAR_SHAPE.square,
  style,
}: AIAvatarProps) {
  const sizeConfig = AVATAR_SIZE_MAP[size] || AVATAR_SIZE_MAP.medium;
  const resolved = resolveAIAvatarSource({
    name,
    avatar: avatarUrl,
  });

  return (
    <AvatarImage
      source={resolved.source}
      fallbackSource={resolved.fallbackSource}
      fallbackText={resolved.fallbackText}
      size={sizeConfig.container}
      shape={shape}
      style={style}
      textStyle={{ fontSize: sizeConfig.fontSize }}
    />
  );
}
