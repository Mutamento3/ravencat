/** 解析并渲染聊天消息气泡中的用户或助手头像及其回退内容。 */

import React, { memo } from 'react';
import AvatarImage from '@shared/ui/AvatarImage';
import { AVATAR_SHAPE } from '@shared/avatar/avatarConstants';
import { resolveAIAvatarSource, resolveUserAvatarSource } from '@shared/avatar/resolveAvatarSource';
import { useThemedStyles } from '@shared/theme';
import { createMessageBubbleStyles } from './styles';

interface AvatarProps {
  avatarContent?: string | null;
  isUser: boolean;
  userName?: string;
  aiName?: string;
}

export const Avatar = memo(function Avatar({ avatarContent, isUser, userName, aiName }: AvatarProps) {
  const styles = useThemedStyles(createMessageBubbleStyles);
  const resolved = isUser
    ? resolveUserAvatarSource({
        name: userName || null,
        avatar: avatarContent || null,
      })
    : resolveAIAvatarSource({
        name: aiName || null,
        avatar: avatarContent || null,
      });

  return (
    <AvatarImage
      source={resolved.source}
      fallbackSource={resolved.fallbackSource}
      fallbackText={resolved.fallbackText}
      size={36}
      shape={AVATAR_SHAPE.square}
      backgroundColor="transparent"
      imageStyle={styles.avatarImage}
      textStyle={styles.avatarText}
    />
  );
});
