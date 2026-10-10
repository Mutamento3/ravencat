/**
 * @fileoverview 图例组件
 */

import React from 'react';
import { View, Text } from 'react-native';
import { useStyles } from '../styles';
import type { CategoryStat } from '../../../domain/WalletRecord';

interface LegendProps {
  data: CategoryStat[];
}

export function Legend({ data }: LegendProps) {
  const styles = useStyles();
  // 只显示有数据的项目，最多显示6个
  const validData = data.filter((item) => item.percentage > 0).slice(0, 6);

  if (validData.length === 0) {
    return null;
  }

  return (
    <View style={styles.legendContainer}>
      {validData.map((item) => (
        <View key={`${item.type}-${item.category}`} style={styles.legendItem}>
          <View style={[styles.legendColor, { backgroundColor: item.color }]} />
          <Text style={styles.legendText}>
            {item.category} {item.percentage}%
          </Text>
        </View>
      ))}
    </View>
  );
}
