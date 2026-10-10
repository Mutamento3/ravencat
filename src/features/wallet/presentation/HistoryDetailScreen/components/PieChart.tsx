/**
 * @fileoverview SVG 饼图组件
 * 
 * 使用 react-native-svg 绘制圆环图
 */

import React from 'react';
import { View, Text } from 'react-native';
import Svg, { Circle, G } from 'react-native-svg';
import { useStyles } from '../styles';
import { useTheme } from '@shared/theme';
import type { CategoryStat } from '../../../domain/WalletRecord';

interface PieChartProps {
  data: CategoryStat[];
  total: number;
  size?: number;
  strokeWidth?: number;
}

export function PieChart({
  data,
  total,
  size = 180,
  strokeWidth = 40,
}: PieChartProps) {
  const styles = useStyles();
  const theme = useTheme();
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const center = size / 2;

  // 过滤掉百分比为0的数据
  const validData = data.filter((item) => item.percentage > 0);

  // 计算每个扇形的偏移
  let currentOffset = 0;

  if (validData.length === 0) {
    return (
      <View style={[styles.chartContainer, { width: size, height: size }]}>
        <Svg width={size} height={size}>
          <Circle
            cx={center}
            cy={center}
            r={radius}
            fill="none"
            stroke={theme.colors.border.default}
            strokeWidth={strokeWidth}
          />
        </Svg>
        <View style={styles.chartCenter}>
          <Text style={styles.chartCenterLabel}>总支出</Text>
          <Text style={styles.chartCenterValue}>¥0</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.chartContainer, { width: size, height: size }]}>
      <Svg width={size} height={size}>
        <G rotation="-90" origin={`${center}, ${center}`}>
          {validData.map((item) => {
            const percentage = item.percentage / 100;
            const dashArray = circumference * percentage;
            const gapArray = circumference - dashArray;
            const offset = currentOffset;
            currentOffset -= dashArray;

            return (
              <Circle
                key={`${item.type}-${item.category}`}
                cx={center}
                cy={center}
                r={radius}
                fill="none"
                stroke={item.color}
                strokeWidth={strokeWidth}
                strokeDasharray={`${dashArray} ${gapArray}`}
                strokeDashoffset={offset}
                strokeLinecap="butt"
              />
            );
          })}
        </G>
      </Svg>

      {/* 中心文字 */}
      <View style={styles.chartCenter}>
        <Text style={styles.chartCenterLabel}>
          {data[0]?.type === 'income' ? '总收入' : '总支出'}
        </Text>
        <Text style={styles.chartCenterValue}>¥{total.toFixed(0)}</Text>
      </View>
    </View>
  );
}
