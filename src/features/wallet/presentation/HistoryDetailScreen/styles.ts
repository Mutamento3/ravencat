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
      height: 8,
      backgroundColor: theme.colors.surface.muted,
      marginVertical: 16,
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
      paddingHorizontal: 12,
      paddingVertical: 4,
      borderRadius: theme.radius.round,
    },
    categoryTagText: {
      fontSize: 14,
      fontWeight: '500',
      color: theme.colors.brand.onPrimary,
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
