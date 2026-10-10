import type { ComponentType } from 'react';
import type { ImageSourcePropType, ImageStyle, StyleProp, TextStyle, ViewStyle } from 'react-native';

export interface AvatarImageProps {
  source?: ImageSourcePropType | null;
  fallbackSource?: ImageSourcePropType | null;
  fallbackText?: string | null;
  size?: number;
  shape?: 'circle' | 'rounded';
  style?: StyleProp<ViewStyle>;
  imageStyle?: StyleProp<ImageStyle>;
  textStyle?: StyleProp<TextStyle>;
  backgroundColor?: string;
}

declare const AvatarImage: ComponentType<AvatarImageProps>;

export default AvatarImage;