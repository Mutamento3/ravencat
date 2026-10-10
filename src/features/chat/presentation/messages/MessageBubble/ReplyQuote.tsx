/** 在消息气泡中展示被回复消息的引用文本。 */

import React, { memo } from 'react';
import { View, Text } from 'react-native';
import { useThemedStyles } from '@shared/theme';
import { createMessageBubbleStyles } from './styles';

interface ReplyQuoteProps {
  replyToText?: string | null;
  isMe: boolean;
}

export const ReplyQuote = memo(function ReplyQuote({ replyToText, isMe }: ReplyQuoteProps) {
  const styles = useThemedStyles(createMessageBubbleStyles);

  if (!replyToText) return null;

  return (
    <View style={[styles.replyContainer, isMe ? styles.myReplyContainer : styles.aiReplyContainer]}>
      <Text style={styles.replyText} numberOfLines={2} ellipsizeMode="tail">
        {replyToText}
      </Text>
    </View>
  );
});
