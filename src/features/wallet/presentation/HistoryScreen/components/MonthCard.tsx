/**
 * @fileoverview 月卡片组件
 */

import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { useHistoryStyles } from '../styles';
import type { MonthInfo, SummaryData } from '../types';

interface MonthCardProps {
  data: MonthInfo;
  summary?: SummaryData;
  onPress: (data: MonthInfo) => void;
}

export function MonthCard({ data, summary, onPress }: MonthCardProps) {
  const styles = useHistoryStyles();
  const hasData = summary && (summary.totalExpense > 0 || summary.totalIncome > 0);
  const subtitle = data.isYearSummary ? '全年' : `${data.year}年`;

  return (
    <TouchableOpacity style={styles.card} onPress={() => onPress(data)}>
      <View style={styles.cardHeader}>
        <Text style={styles.cardTitle}>{data.monthName}</Text>
        <Text style={styles.cardSubtitle}>{subtitle}</Text>
      </View>

      <View style={styles.cardBody}>
        {hasData ? (
          <>
            <View>
              {summary.totalExpense > 0 && (
                <Text style={[styles.cardAmount, styles.expenseText]}>
                  -¥{summary.totalExpense.toFixed(2)}
                </Text>
              )}
              {summary.totalIncome > 0 && (
                <Text style={[styles.cardAmount, styles.incomeText]}>
                  +¥{summary.totalIncome.toFixed(2)}
                </Text>
              )}
            </View>
            <Text style={styles.cardSubtitle}>
              {summary.records.length} 笔
            </Text>
          </>
        ) : (
          <Text style={styles.emptyText}>无记录</Text>
        )}
      </View>
    </TouchableOpacity>
  );
}
