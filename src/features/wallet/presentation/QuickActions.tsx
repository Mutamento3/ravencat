/** Renders the Wallet quick-action shortcuts. */
// 快捷记账组件

import React from 'react';
import { ActivityIndicator, View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useTheme, useThemedStyles } from '@shared/theme';
import type { PresentationTheme } from '@shared/theme';
import type { QuickAction } from '../domain/WalletRecord';

interface QuickActionsProps {
  actions: QuickAction[];
  onAction: (action: QuickAction) => void;
  onManage: () => void;
  mutatingActionId?: string | null;
}

const formatAmount = (amount: number): string => amount.toFixed(2);

const createStyles = (theme: PresentationTheme) =>
  StyleSheet.create({
    container: {
      marginHorizontal: theme.spacing.lg,
      marginBottom: theme.spacing.xl,
    },
    header: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: theme.spacing.md,
    },
    title: {
      fontSize: 16,
      fontWeight: '600',
      color: theme.colors.text.primary,
    },
    manageBtn: {
      paddingHorizontal: theme.spacing.md,
      paddingVertical: theme.spacing.xs,
    },
    manageText: {
      fontSize: 14,
      color: theme.colors.text.link,
    },
    grid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      marginHorizontal: -6,
    },
    item: {
      width: '25%',
      padding: 6,
      alignItems: 'center',
    },
    name: {
      fontSize: 13,
      color: theme.colors.text.primary,
      marginBottom: 2,
    },
    amount: {
      fontSize: 11,
      color: theme.colors.text.secondary,
    },
    empty: {
      padding: theme.spacing.xl,
      backgroundColor: theme.colors.background.screen,
      borderRadius: theme.radius.md,
      alignItems: 'center',
    },
    emptyText: {
      fontSize: 14,
      color: theme.colors.text.secondary,
    },
  });

const QuickActions: React.FC<QuickActionsProps> = ({
  actions,
  onAction,
  onManage,
  mutatingActionId = null,
}) => {
  const theme = useTheme();
  const styles = useThemedStyles(createStyles);

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>快捷记账</Text>
        <TouchableOpacity onPress={onManage} style={styles.manageBtn}>
          <Text style={styles.manageText}>管理</Text>
        </TouchableOpacity>
      </View>

      {actions.length > 0 ? (
        <View style={styles.grid}>
          {actions.map((action) => (
            <TouchableOpacity
              key={action.id}
              style={styles.item}
              onPress={() => onAction(action)}
              disabled={mutatingActionId !== null}
            >
              <Text style={styles.name}>{action.name}</Text>
              {mutatingActionId === action.id ? (
                <ActivityIndicator size="small" color={theme.colors.brand.primary} />
              ) : (
                <Text style={styles.amount}>¥{formatAmount(action.amount)}</Text>
              )}
            </TouchableOpacity>
          ))}
        </View>
      ) : (
        <TouchableOpacity style={styles.empty} onPress={onManage}>
          <Text style={styles.emptyText}>添加快捷记账</Text>
        </TouchableOpacity>
      )}
    </View>
  );
};

export default QuickActions;
