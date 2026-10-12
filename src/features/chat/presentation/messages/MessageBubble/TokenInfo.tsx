/** 按交互主题配置渲染消息的 Token 使用量提示。 */

import React, { memo } from 'react';
import { Text } from 'react-native';
import { getChatInteractionProfile, useTheme, useThemedStyles } from '@shared/theme';
import { createMessageBubbleStyles } from './styles';

interface TokenInfoProps {
  tokensUsed?: number;
  promptTokens?: number;
  completionTokens?: number;
  cachedTokens?: number;
  isMe: boolean;
}

export const TokenInfo = memo(function TokenInfo({
  tokensUsed, promptTokens, completionTokens, cachedTokens, isMe,
}: TokenInfoProps) {
  const theme = useTheme();
  const styles = useThemedStyles(createMessageBubbleStyles);
  const interactionProfile = getChatInteractionProfile(theme);

  if (!interactionProfile.showTokenUsage || !tokensUsed || tokensUsed <= 0) return null;

  return (
    <Text style={[styles.tokenInfo, isMe ? styles.myTokenInfo : styles.aiTokenInfo]}>
      {tokensUsed} tokens
      {!isMe && promptTokens !== undefined && completionTokens !== undefined
        && (promptTokens > 0 || completionTokens > 0)
        ? ` · 输入 ${promptTokens} / 输出 ${completionTokens}` : ''}
      {!isMe ? `\n缓存命中 ${cachedTokens === undefined ? '未提供' : `${cachedTokens} tokens`}${
        cachedTokens !== undefined && promptTokens !== undefined && promptTokens > 0
          ? `（${(cachedTokens / promptTokens * 100).toFixed(1)}%）` : ''
      }` : ''}
    </Text>
  );
});
