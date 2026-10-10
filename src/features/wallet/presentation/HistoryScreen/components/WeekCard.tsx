/**
 * @fileoverview 周卡片组件
 */

import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { useHistoryStyles } from '../styles';
import type { WeekInfo, SummaryData } from '../types';

interface WeekCardProps {
  data: WeekInfo;
  summary?: SummaryData;
  onPress: (data: WeekInfo) => void;
}

export function WeekCard({ data, summary, onPress }: WeekCardProps) {
  const styles = useHistoryStyles();
  const hasData = summary && (summary.totalExpense > 0 || summary.totalIncome > 0);

  return (
    <TouchableOpacity style={styles.card} onPress={() => onPress(data)}>
      <View style={styles.cardHeader}>
        <Text style={styles.cardTitle}>第{data.weekNum}周</Text>
        <Text style={styles.cardSubtitle}>{data.label}</Text>
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
