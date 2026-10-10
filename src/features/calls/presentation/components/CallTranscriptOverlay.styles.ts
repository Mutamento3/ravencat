import { StyleSheet } from 'react-native';
import type { PresentationTheme } from '@shared/theme';

export const createCallTranscriptOverlayStyles = (theme: PresentationTheme) =>
  StyleSheet.create({
    container: {
      flex: 1,
      width: '100%',
    },
    collapsedPlaceholder: {
      flex: 1,
    },
    lyrics: {
      flex: 1,
    },
    lyricsContent: {
      paddingHorizontal: 32,
      gap: theme.spacing.sm,
    },
    lyricLine: {
      maxWidth: '100%',
      textAlign: 'center',
      color: theme.colors.text.inverse,
      // 字号行高固定：聚焦变化只走 transform scale，行高永不变，滑动时不重排。
      fontSize: 16,
      lineHeight: 24,
    },
    lyricLineUser: {
      color: theme.colors.brand.primary,
    },
    lyricLineInterrupted: {
      fontStyle: 'italic',
    },
    emptyWrap: {
      flex: 1,
      justifyContent: 'center',
    },
    emptyText: {
      ...theme.typography.bodySmall,
      paddingVertical: theme.spacing.md,
      textAlign: 'center',
      color: 'rgba(255,255,255,0.5)',
    },
  });
