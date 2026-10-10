import React from 'react';
import { Text, useWindowDimensions, View } from 'react-native';

import type { AIProfile } from '@features/assistants';
import { useThemedStyles } from '@shared/theme';
import { AVATAR_SHAPE } from '@shared/avatar/avatarConstants';
import { resolveAIAvatarSource } from '@shared/avatar/resolveAvatarSource';
import { AvatarImage } from '@shared/ui';
import { createCallAvatarHeaderStyles } from './CallAvatarHeader.styles';

interface CallAvatarHeaderProps {
  aiProfile: AIProfile | null;
  stateText: string;
}

/** 通话页上方头像区：约屏宽 1/4 的圆形 AI 头像 + 名字 + 状态文案。 */
export default function CallAvatarHeader({ aiProfile, stateText }: CallAvatarHeaderProps) {
  const styles = useThemedStyles(createCallAvatarHeaderStyles);
  const { width } = useWindowDimensions();
  const avatarSize = Math.round(width / 4);
  const aiAvatar = resolveAIAvatarSource(aiProfile);

  return (
    <View style={styles.container}>
      <AvatarImage
        source={aiAvatar.source}
        fallbackSource={aiAvatar.fallbackSource}
        fallbackText={aiAvatar.fallbackText}
        size={avatarSize}
        shape={AVATAR_SHAPE.circle}
        style={[
          styles.avatar,
          { width: avatarSize, height: avatarSize, borderRadius: avatarSize / 2 },
        ]}
        imageStyle={styles.avatarImage}
        textStyle={[styles.avatarText, { fontSize: Math.round(avatarSize * 0.38) }]}
      />
      <Text style={styles.aiName} numberOfLines={1}>
        {aiProfile?.name || 'AI'}
      </Text>
      <Text style={styles.stateText} numberOfLines={1}>
        {stateText}
      </Text>
    </View>
  );
}
