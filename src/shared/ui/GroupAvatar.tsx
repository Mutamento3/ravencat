/** 统一解析自定义群头像，并在未设置或文件失效时显示内置群头像。 */
import React from 'react';
import type { StyleProp, ViewStyle } from 'react-native';

import {
  AVATAR_SHAPE,
  AVATAR_SIZE_MAP,
  type AvatarShape,
  type AvatarSize,
} from '@shared/avatar/avatarConstants';
import { resolveGroupAvatarSource } from '@shared/avatar/resolveAvatarSource';
import AvatarImage from './AvatarImage';

interface GroupAvatarProps {
  name?: string;
  avatarUrl?: string | null;
  size?: AvatarSize;
  shape?: AvatarShape;
  style?: StyleProp<ViewStyle>;
}

export default function GroupAvatar({
  name,
  avatarUrl,
  size = 'medium',
  shape = AVATAR_SHAPE.square,
  style,
}: GroupAvatarProps) {
  const sizeConfig = AVATAR_SIZE_MAP[size] || AVATAR_SIZE_MAP.medium;
  const resolved = resolveGroupAvatarSource({ name, avatar: avatarUrl });

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
