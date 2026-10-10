/** 集中定义不同聊天主题下的消息正文排版。 */
import { StyleSheet } from 'react-native';

import { isMoonKimiTheme, isPaperNoteTheme, type PresentationTheme } from '@shared/theme';

export function createMessageTextStyles(theme: PresentationTheme) {
  const isMoonKimi = isMoonKimiTheme(theme);
  const isPaperNote = isPaperNoteTheme(theme);

  return StyleSheet.create({
    myText: isPaperNote ? {
      color: theme.colors.chat.userText,
      fontSize: 16,
      lineHeight: 30,
    } : isMoonKimi ? {
      color: theme.colors.chat.userText,
      fontSize: 16,
      lineHeight: 26,
    } : {
      color: theme.colors.chat.userText,
      fontSize: 15,
      lineHeight: 21,
    },
    aiText: isPaperNote ? {
      color: theme.colors.chat.aiText,
      fontSize: 16,
      lineHeight: 30,
    } : isMoonKimi ? {
      color: theme.colors.chat.aiText,
      fontSize: 16,
      lineHeight: 30,
    } : {
      color: theme.colors.chat.aiText,
      fontSize: 15,
      lineHeight: 21,
    },
    reasoningText: isPaperNote ? {
      color: theme.colors.text.secondary,
      fontSize: 15,
      lineHeight: 30,
    } : isMoonKimi ? {
      color: theme.colors.text.secondary,
      fontSize: 15,
      lineHeight: 24,
    } : {
      color: theme.colors.text.secondary,
      fontSize: 12,
      lineHeight: 17,
    },
    systemText: {
      color: theme.colors.text.secondary,
      fontSize: 12,
      lineHeight: 18,
      textAlign: 'center',
    },
  });
}