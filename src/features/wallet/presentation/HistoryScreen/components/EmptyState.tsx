/**
 * @fileoverview 空状态组件
 */

import React from 'react';
import { View, Text } from 'react-native';
import { useHistoryStyles } from '../styles';

interface EmptyStateProps {
  message?: string;
  subMessage?: string;
}

export function EmptyState({
  message = '暂无数据',
  subMessage = '该时间段内没有记账记录'
}: EmptyStateProps) {
  const styles = useHistoryStyles();

  return (
    <View style={styles.emptyContainer}>
      <Text style={styles.emptyIcon}>📊</Text>
      <Text style={styles.emptyTitle}>{message}</Text>
      <Text style={styles.emptySubtitle}>{subMessage}</Text>
    </View>
  );
}
