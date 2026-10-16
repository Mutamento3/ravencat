import { StyleSheet } from 'react-native';
import type { PresentationTheme } from '@shared/theme';

export const createCallStyles = (theme: PresentationTheme) =>
  StyleSheet.create({
    screen: {
      flex: 1,
      backgroundColor: theme.colors.background.app,
    },
    background: {
      flex: 1,
      backgroundColor: theme.mode === 'dark' ? '#101418' : '#EAF3F8',
    },
    backgroundImage: {
      flex: 1,
    },
    scrim: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: theme.mode === 'dark' ? 'rgba(0,0,0,0.48)' : 'rgba(16,24,32,0.22)',
    },
    content: {
      flex: 1,
      paddingHorizontal: 24,
      paddingBottom: 28,
    },
    topBar: {
      minHeight: 44,
      flexDirection: 'row',
      alignItems: 'center',
    },
    topBarButton: {
      padding: 8,
    },
    transcriptArea: {
      flex: 1,
      justifyContent: 'center',
      paddingVertical: theme.spacing.md,
    },
    hangupRow: {
      alignItems: 'center',
      marginTop: theme.spacing.lg,
    },
    hangupButton: {
      width: 56,
      height: 56,
      alignItems: 'center',
      justifyContent: 'center',
    },
    hangupLabel: {
      ...theme.typography.label,
      marginTop: theme.spacing.xs,
      color: 'rgba(255,255,255,0.86)',
    },
    errorText: {
      minHeight: 24,
      fontSize: 13,
      textAlign: 'center',
      color: theme.colors.feedback.warning,
    },
    loadingText: {
      marginTop: 12,
      color: theme.colors.text.inverse,
    },
    textInputModalOverlay: {
      flex: 1,
      justifyContent: 'flex-end',
    },
    textInputModalBackdrop: {
      ...StyleSheet.absoluteFillObject,
    },
    textInputModalDock: {
      paddingTop: theme.spacing.md,
    },
    textInputModalRow: {
      flexDirection: 'row',
      alignItems: 'center',
      marginHorizontal: theme.spacing.md,
      marginBottom: theme.spacing.md,
      paddingHorizontal: theme.spacing.md,
      paddingVertical: 6,
      borderRadius: theme.radius.round,
      backgroundColor: theme.colors.chat.inputBar,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.colors.border.light,
    },
    textInputModalInput: {
      flex: 1,
      minHeight: 40,
      maxHeight: 120,
      paddingHorizontal: 0,
      paddingVertical: 0,
      color: theme.colors.text.primary,
      fontSize: 15,
      lineHeight: 20,
    },
    textInputModalSendButton: {
      width: 36,
      height: 36,
      borderRadius: 18,
      marginLeft: theme.spacing.sm,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: theme.colors.brand.primary,
    },
    textInputModalSendButtonDisabled: {
      backgroundColor: theme.colors.surface.muted,
      opacity: 1,
    },
  });
