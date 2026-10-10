/**
 * @fileoverview 日卡片组件
 */

import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { useHistoryStyles } from '../styles';
import type { DayInfo, SummaryData } from '../types';

interface DayCardProps {
  data: DayInfo;
  summary?: SummaryData;
  onPress: (data: DayInfo) => void;
}

export function DayCard({ data, summary, onPress }: DayCardProps) {
  const styles = useHistoryStyles();
  const hasData = summary && (summary.totalExpense > 0 || summary.totalIncome > 0);

  // 当是今天时，显示星期几而不是"今天"，避免"今天（今天）"的重复
  const displayWeekday = data.isToday
    ? ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][new Date(data.startDate).getDay()]
    : data.weekday;

  return (
    <TouchableOpacity style={styles.card} onPress={() => onPress(data)}>
      <View style={styles.cardHeader}>
        <Text style={styles.cardTitle}>
          {displayWeekday} {data.isToday && '(今天)'}
        </Text>
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
