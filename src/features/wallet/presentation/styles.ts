import { StyleSheet } from 'react-native';
import type { PresentationTheme } from '@shared/theme';
import { EXPENSE_COLOR } from './walletVisualizationColors';

export const createAddRecordModalStyles = (theme: PresentationTheme) =>
  StyleSheet.create({
    scrollView: {
      width: '100%',
    },
    scrollContent: {
      flexGrow: 1,
    },
    content: {
      backgroundColor: theme.colors.background.app,
      padding: theme.spacing.xl,
    },
    header: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: theme.spacing.xl,
    },
    cancel: {
      fontSize: 15,
      color: theme.colors.text.secondary,
    },
    title: {
      fontSize: 17,
      fontWeight: '600',
      color: theme.colors.text.primary,
    },
    save: {
      fontSize: 15,
      color: theme.colors.text.link,
      fontWeight: '500',
    },
    typeSwitch: {
      flexDirection: 'row',
      backgroundColor: theme.colors.background.screen,
      borderRadius: theme.radius.md,
      marginBottom: theme.spacing.xl,
    },
    typeBtn: {
      flex: 1,
      paddingVertical: 10,
      alignItems: 'center',
      borderRadius: theme.radius.md,
    },
    typeBtnActive: {
      backgroundColor: theme.colors.background.app,
    },
    typeBtnText: {
      fontSize: 15,
      color: theme.colors.text.secondary,
    },
    typeBtnTextActive: {
      color: theme.colors.text.primary,
      fontWeight: '500',
    },
    amountWrap: {
      flexDirection: 'row',
      alignItems: 'center',
      alignSelf: 'center',
      marginBottom: theme.spacing.xxl,
    },
    currency: {
      fontSize: 32,
      color: theme.colors.text.primary,
      marginRight: 4,
    },
    amountInput: {
      fontSize: 40,
      lineHeight: 48,
      includeFontPadding: false,
      textAlignVertical: 'center',
      minWidth: 120,
      textAlign: 'left',
      padding: 0,
      margin: 0,
      color: theme.colors.text.primary,
    },
    label: {
      fontSize: 14,
      color: theme.colors.text.secondary,
      marginBottom: 10,
    },
    categoryGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      marginHorizontal: -4,
      marginBottom: theme.spacing.xl,
    },
    categoryBtn: {
      paddingHorizontal: 14,
      paddingVertical: 8,
      margin: 4,
      backgroundColor: theme.colors.background.screen,
      borderRadius: 16,
    },
    categoryBtnActive: {
      backgroundColor: theme.colors.brand.primary,
    },
    categoryText: {
      fontSize: 14,
      color: theme.colors.text.primary,
    },
    categoryTextActive: {
      color: theme.colors.brand.onPrimary,
    },
    detailInput: {
      height: 44,
      paddingHorizontal: 12,
      backgroundColor: theme.colors.background.screen,
      borderRadius: theme.radius.md,
      fontSize: 15,
      color: theme.colors.text.primary,
      marginBottom: 300,
    },
  });

export const createQuickActionModalStyles = (theme: PresentationTheme) =>
  StyleSheet.create({
    content: {
      backgroundColor: theme.colors.background.app,
      padding: theme.spacing.xl,
    },
    header: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: theme.spacing.xl,
    },
    close: {
      fontSize: 15,
      color: theme.colors.text.secondary,
    },
    title: {
      fontSize: 17,
      fontWeight: '600',
      color: theme.colors.text.primary,
    },
    add: {
      fontSize: 15,
      color: theme.colors.text.link,
      fontWeight: '500',
    },
    form: {
      backgroundColor: theme.colors.background.screen,
      padding: theme.spacing.lg,
      borderRadius: theme.radius.lg,
      marginBottom: theme.spacing.lg,
    },
    formRow: {
      flexDirection: 'row',
      marginBottom: theme.spacing.md,
    },
    formInput: {
      flex: 1,
      height: 40,
      backgroundColor: theme.colors.background.app,
      borderRadius: theme.radius.md,
      paddingHorizontal: 12,
      marginRight: 8,
      fontSize: 15,
    },
    typeSwitch: {
      flexDirection: 'row',
      marginBottom: theme.spacing.md,
    },
    typeBtn: {
      flex: 1,
      paddingVertical: 8,
      alignItems: 'center',
      backgroundColor: theme.colors.background.app,
      borderRadius: theme.radius.md,
      marginHorizontal: 4,
    },
    typeBtnActive: {
      backgroundColor: theme.colors.brand.primary,
    },
    typeText: {
      fontSize: 14,
      color: theme.colors.text.secondary,
    },
    typeTextActive: {
      color: theme.colors.brand.onPrimary,
    },
    categoryGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      marginHorizontal: -4,
      marginBottom: theme.spacing.md,
    },
    catBtn: {
      paddingHorizontal: 12,
      paddingVertical: 6,
      margin: 4,
      backgroundColor: theme.colors.background.app,
      borderRadius: 12,
    },
    catBtnActive: {
      backgroundColor: theme.colors.surface.muted,
    },
    catText: {
      fontSize: 13,
      color: theme.colors.text.secondary,
    },
    catTextActive: {
      color: theme.colors.text.link,
    },
    addBtn: {
      backgroundColor: theme.colors.brand.primary,
      paddingVertical: 10,
      borderRadius: theme.radius.md,
      alignItems: 'center',
    },
    addBtnText: {
      color: theme.colors.brand.onPrimary,
      fontSize: 15,
      fontWeight: '500',
    },
    list: {
      maxHeight: 300,
    },
    empty: {
      textAlign: 'center',
      color: theme.colors.text.secondary,
      padding: theme.spacing.xl,
    },
    item: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingVertical: 14,
      borderBottomWidth: 0.5,
      borderBottomColor: theme.colors.border.light,
    },
    itemName: {
      fontSize: 15,
      color: theme.colors.text.primary,
    },
    itemSub: {
      fontSize: 12,
      color: theme.colors.text.secondary,
      marginTop: 2,
    },
    itemRight: {
      alignItems: 'flex-end',
    },
    itemAmount: {
      fontSize: 15,
      color: theme.colors.text.primary,
      marginBottom: 4,
    },
    delete: {
      fontSize: 12,
      color: EXPENSE_COLOR,
    },
  });
