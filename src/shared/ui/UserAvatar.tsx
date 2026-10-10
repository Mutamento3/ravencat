import React from 'react';
import type { StyleProp, ViewStyle } from 'react-native';

import { AVATAR_SHAPE, AVATAR_SIZE_MAP, type AvatarShape, type AvatarSize } from '@shared/avatar/avatarConstants';
import { resolveUserAvatarSource } from '@shared/avatar/resolveAvatarSource';
import AvatarImage from './AvatarImage';

export interface UserAvatarProps {
  name?: string | null;
  avatarUrl?: string | null;
  size?: AvatarSize;
  shape?: AvatarShape;
  style?: StyleProp<ViewStyle>;
}

export default function UserAvatar({
  name,
  avatarUrl,
  size = 'medium',
  shape = AVATAR_SHAPE.square,
  style,
}: UserAvatarProps) {
  const sizeConfig = AVATAR_SIZE_MAP[size] || AVATAR_SIZE_MAP.medium;
  const resolved = resolveUserAvatarSource({
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