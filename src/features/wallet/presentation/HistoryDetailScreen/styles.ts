/**
 * @fileoverview HistoryDetailScreen 样式
 */

import { StyleSheet } from 'react-native';
import { useThemedStyles } from '@shared/theme';
import type { PresentationTheme } from '@shared/theme';
import { EXPENSE_COLOR, INCOME_COLOR } from '../walletVisualizationColors';

const createStyles = (theme: PresentationTheme) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: theme.colors.background.screen,
    },
    scrollContent: {
      paddingBottom: 40,
    },
    // Header 样式
    header: {
      marginHorizontal: theme.spacing.lg,
      marginTop: theme.spacing.lg,
      borderRadius: theme.radius.lg,
      padding: 20,
      alignItems: 'center',
    },
    headerTitle: {
      fontSize: 14,
      color: theme.colors.text.tertiary,
      marginBottom: 8,
    },
    headerDate: {
      fontSize: 20,
      fontWeight: '600',
      color: theme.colors.text.primary,
      marginBottom: 20,
    },
    summaryRow: {
      flexDirection: 'row',
      justifyContent: 'center',
      gap: 40,
    },
    summaryItem: {
      alignItems: 'center',
    },
    summaryLabel: {
      fontSize: 12,
      color: theme.colors.text.tertiary,
      marginBottom: 4,
    },
    summaryValue: {
      fontSize: 24,
      fontWeight: '600',
    },
    expenseText: {
      color: EXPENSE_COLOR,
    },
    incomeText: {
      color: INCOME_COLOR,
    },
    // 饼图区域
    chartSection: {
      marginHorizontal: theme.spacing.lg,
      borderRadius: theme.radius.lg,
      alignItems: 'center',
      paddingVertical: 20,
    },
    chartContainer: {
      position: 'relative',
      alignItems: 'center',
      justifyContent: 'center',
    },
    chartCenter: {
      position: 'absolute',
      alignItems: 'center',
    },
    chartCenterLabel: {
      fontSize: 12,
      color: theme.colors.text.tertiary,
      marginBottom: 4,
    },
    chartCenterValue: {
      fontSize: 20,
      fontWeight: '600',
      color: theme.colors.text.primary,
    },
    // 图例
    legendContainer: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      justifyContent: 'center',
      paddingHorizontal: 20,
      marginTop: 16,
      gap: 12,
    },
    legendItem: {
      flexDirection: 'row',
      alignItems: 'center',
    },
    legendColor: {
      width: 12,
      height: 12,
      borderRadius: 6,
      marginRight: 6,
    },
    legendText: {
      fontSize: 12,
      color: theme.colors.text.secondary,
    },
    // 分割线
    divider: {
      height: theme.spacing.lg,
    },
    // 分类列表
    listSection: {
      paddingHorizontal: theme.spacing.lg,
    },
    sectionTitle: {
      fontSize: 16,
      fontWeight: '600',
      color: theme.colors.text.primary,
      marginBottom: 12,
    },
    // 分类组
    categoryGroup: {
      marginBottom: 16,
      paddingHorizontal: theme.spacing.lg,
      backgroundColor: theme.colors.surface.default,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.colors.border.default,
      borderRadius: theme.radius.lg,
    },
    categoryHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingVertical: 12,
      borderBottomWidth: 1,
      borderBottomColor: theme.colors.border.light,
    },
    categoryTag: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingHorizontal: 12,
      paddingVertical: 4,
      borderRadius: theme.radius.round,
      backgroundColor: theme.colors.surface.muted,
    },
    categoryDot: {
      width: 8,
      height: 8,
      borderRadius: 4,
    },
    categoryTagText: {
      fontSize: 14,
      fontWeight: '500',
      color: theme.colors.text.primary,
    },
    categoryTotal: {
      fontSize: 16,
      fontWeight: '600',
    },
    // 记录项
    recordItem: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingVertical: 10,
      borderBottomWidth: 0.5,
      borderBottomColor: theme.colors.border.light,
    },
    recordLeft: {
      flex: 1,
    },
    recordDate: {
      fontSize: 12,
      color: theme.colors.text.tertiary,
      marginBottom: 2,
    },
    recordDetail: {
      fontSize: 14,
      color: theme.colors.text.primary,
    },
    recordAmount: {
      fontSize: 14,
      fontWeight: '500',
    },
    // 空状态
    emptyContainer: {
      alignItems: 'center',
      paddingVertical: 60,
    },
    emptyText: {
      fontSize: 14,
      color: theme.colors.text.tertiary,
      marginTop: 8,
    },
    // 加载状态
    loadingContainer: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
    },
  });

export const useStyles = () => useThemedStyles(createStyles);
