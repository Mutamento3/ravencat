/** 按交互主题配置渲染消息的 Token 使用量提示。 */

import React, { memo } from 'react';
import { Text } from 'react-native';
import { getChatInteractionProfile, useTheme, useThemedStyles } from '@shared/theme';
import { createMessageBubbleStyles } from './styles';

interface TokenInfoProps {
  tokensUsed?: number;
  isMe: boolean;
}

export const TokenInfo = memo(function TokenInfo({ tokensUsed, isMe }: TokenInfoProps) {
  const theme = useTheme();
  const styles = useThemedStyles(createMessageBubbleStyles);
  const interactionProfile = getChatInteractionProfile(theme);

  if (!interactionProfile.showTokenUsage || !tokensUsed || tokensUsed <= 0) return null;

  return (
    <Text style={[styles.tokenInfo, isMe ? styles.myTokenInfo : styles.aiTokenInfo]}>
      {tokensUsed} tokens
    </Text>
  );
});
