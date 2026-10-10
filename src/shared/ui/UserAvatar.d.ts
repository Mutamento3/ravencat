import type { ComponentType } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';

export interface UserAvatarProps {
  name?: string | null;
  avatarUrl?: string | null;
  size?: 'small' | 'medium' | 'large';
  shape?: 'circle' | 'rounded' | 'square';
  style?: StyleProp<ViewStyle>;
}

declare const UserAvatar: ComponentType<UserAvatarProps>;

export default UserAvatar;