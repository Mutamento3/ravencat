import { StyleSheet } from 'react-native';
import type { PresentationTheme } from '@shared/theme';

export function createModelSettingsStyles(theme: PresentationTheme) {
  return StyleSheet.create({
    contentContainer: {
      paddingBottom: theme.spacing.xl,
    },

    section: {
      padding: theme.spacing.lg,
      borderBottomWidth: 0.5,
      borderBottomColor: theme.colors.border.default,
    },
    sectionLightBorder: {
      borderBottomColor: theme.colors.border.light,
    },

    sectionLabel: {
      fontSize: 16,
      fontWeight: '600',
      color: theme.colors.text.primary,
      marginBottom: theme.spacing.md,
    },

    borderedInput: {
      backgroundColor: theme.colors.surface.input,
      borderRadius: theme.radius.md,
      paddingHorizontal: theme.spacing.md,
      paddingVertical: 12,
      fontSize: 16,
      color: theme.colors.text.primary,
      borderWidth: 1,
      borderColor: theme.colors.border.default,
    },

    modelSectionHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: theme.spacing.md,
    },

    miniBtn: {
      borderRadius: theme.radius.sm,
      paddingHorizontal: 12,
      paddingVertical: 6,
    },
    miniBtnPrimary: {
      backgroundColor: theme.colors.surface.muted,
    },
    miniBtnText: {
      fontSize: 13,
      color: theme.colors.brand.primary,
      fontWeight: '500',
    },

    modelValueBox: {
      borderRadius: theme.radius.md,
      paddingHorizontal: theme.spacing.md,
      paddingVertical: 12,
      marginBottom: theme.spacing.md,
    },
    modelValueBoxHighlight: {
      backgroundColor: theme.colors.surface.muted,
    },
    modelValueBoxMuted: {
      backgroundColor: theme.colors.background.app,
    },
    modelValueText: {
      fontSize: 15,
      flex: 1,
      marginRight: 10,
    },
    modelValueTextHighlight: {
      color: theme.colors.brand.primary,
      fontWeight: '500',
    },
    modelValueTextMuted: {
      color: theme.colors.text.secondary,
    },

    paramInput: {
      backgroundColor: theme.colors.background.app,
      borderRadius: theme.radius.md,
      borderWidth: 1,
      borderColor: theme.colors.border.default,
      paddingHorizontal: theme.spacing.md,
      paddingVertical: 6,
      fontSize: 16,
      color: theme.colors.brand.primary,
      fontWeight: '600',
      minWidth: 60,
      textAlign: 'center',
    },
    paramDescription: {
      fontSize: 13,
      color: theme.colors.text.secondary,
      lineHeight: 18,
      marginBottom: theme.spacing.md,
    },

    presetContainer: {
      flexDirection: 'row',
      gap: 10,
      flexWrap: 'wrap',
    },
    presetBtn: {
      backgroundColor: theme.colors.background.app,
      paddingHorizontal: 16,
      paddingVertical: 8,
      borderRadius: theme.radius.md,
    },
    presetText: {
      fontSize: 13,
      color: theme.colors.text.primary,
      fontWeight: '500',
    },
  });
}
