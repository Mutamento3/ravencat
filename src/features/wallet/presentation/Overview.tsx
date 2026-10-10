/** Displays the current month's Wallet income and expense totals. */
// 月度概览组件

import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme, useThemedStyles } from '@shared/theme';
import type { PresentationTheme } from '@shared/theme';
import { EXPENSE_COLOR, INCOME_COLOR } from './walletVisualizationColors';

interface OverviewProps {
  expense: number;
  income: number;
  onPress?: () => void;
}

const formatAmount = (amount: number): string => amount.toFixed(2);

const createStyles = (theme: PresentationTheme) =>
  StyleSheet.create({
    container: {
      margin: theme.spacing.lg,
      padding: theme.spacing.xl,
      backgroundColor: theme.colors.background.screen,
      borderRadius: theme.radius.lg,
    },
    headerRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: theme.spacing.md,
    },
    month: {
      fontSize: 14,
      color: theme.colors.text.secondary,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
    },
    item: {
      flex: 1,
      alignItems: 'center',
    },
    divider: {
      width: 1,
      height: 40,
      backgroundColor: theme.colors.border.default,
    },
    label: {
      fontSize: 12,
      color: theme.colors.text.secondary,
      marginBottom: theme.spacing.xs,
    },
    value: {
      fontSize: 20,
      fontWeight: '600',
    },
    expense: {
      color: EXPENSE_COLOR,
    },
    income: {
      color: INCOME_COLOR,
    },
  });

const Overview: React.FC<OverviewProps> = ({ expense, income, onPress }) => {
  const theme = useTheme();
  const styles = useThemedStyles(createStyles);
  const balance = income - expense;

  const content = (
    <>
      <View style={styles.headerRow}>
        <Text style={styles.month}>{new Date().getMonth() + 1}月</Text>
        {onPress && (
          <Ionicons name="chevron-forward" size={16} color={theme.colors.text.tertiary} />
        )}
      </View>
      <View style={styles.row}>
        <View style={styles.item}>
          <Text style={styles.label}>支出</Text>
          <Text style={[styles.value, styles.expense]}>¥{formatAmount(expense)}</Text>
        </View>
        <View style={styles.divider} />
        <View style={styles.item}>
          <Text style={styles.label}>收入</Text>
          <Text style={[styles.value, styles.income]}>¥{formatAmount(income)}</Text>
        </View>
        <View style={styles.divider} />
        <View style={styles.item}>
          <Text style={styles.label}>结余</Text>
          <Text style={[styles.value, balance >= 0 ? styles.income : styles.expense]}>
            ¥{formatAmount(Math.abs(balance))}
          </Text>
        </View>
      </View>
    </>
  );

  if (onPress) {
    return (
      <TouchableOpacity style={styles.container} onPress={onPress} activeOpacity={0.8}>
        {content}
      </TouchableOpacity>
    );
  }

  return <View style={styles.container}>{content}</View>;
};

export default Overview;
