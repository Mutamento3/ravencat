export const AVATAR_SIZE_MAP = {
  small: { container: 36, fontSize: 14 },
  medium: { container: 56, fontSize: 24 },
  large: { container: 72, fontSize: 32 },
} as const;

export const AVATAR_SHAPE = {
  circle: 'circle',
  rounded: 'rounded',
  square: 'square',      // 轻微圆角，更尖锐
} as const;

export type AvatarSize = keyof typeof AVATAR_SIZE_MAP;
export type AvatarShape = (typeof AVATAR_SHAPE)[keyof typeof AVATAR_SHAPE];