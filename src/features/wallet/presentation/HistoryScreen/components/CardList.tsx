/**
 * @fileoverview 卡片列表容器组件
 */

import React, { useRef } from 'react';
import { FlatList, ActivityIndicator, View } from 'react-native';
import { useTheme } from '@shared/theme';
import { DayCard } from './DayCard';
import { WeekCard } from './WeekCard';
import { MonthCard } from './MonthCard';
import { EmptyState } from './EmptyState';
import { useHistoryStyles } from '../styles';
import { getTimeRangeKey } from '../../utils/timeUtils';
import type {
  ViewType,
  TimeRange,
  DayInfo,
  WeekInfo,
  MonthInfo,
  SummaryData
} from '../types';

interface CardListProps {
  viewType: ViewType;
  timeRanges: TimeRange[];
  summaries: Map<string, SummaryData>;
  loading: boolean;
  onSelect: (timeRange: TimeRange) => void;
  onLoadMore: () => void;
}

export function CardList({
  viewType,
  timeRanges,
  summaries,
  loading,
  onSelect,
  onLoadMore,
}: CardListProps) {
  const styles = useHistoryStyles();
  const theme = useTheme();
  const onEndReachedCalledDuringMomentum = useRef(true);

  const renderItem = ({ item }: { item: TimeRange }) => {
    const summary = summaries.get(getTimeRangeKey(item));

    switch (viewType) {
      case 'week':
        return (
          <DayCard
            data={item as DayInfo}
            summary={summary}
            onPress={onSelect}
          />
        );
      case 'month':
        return (
          <WeekCard
            data={item as WeekInfo}
            summary={summary}
            onPress={onSelect}
          />
        );
      case 'year':
        return (
          <MonthCard
            data={item as MonthInfo}
            summary={summary}
            onPress={onSelect}
          />
        );
      default:
        return null;
    }
  };

  const renderFooter = () => {
    if (!loading) return null;
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="small" color={theme.colors.brand.primary} />
      </View>
    );
  };

  const renderEmpty = () => {
    if (loading) return null;
    return <EmptyState />;
  };

  return (
    <FlatList
      data={timeRanges}
      renderItem={renderItem}
      keyExtractor={(item) => getTimeRangeKey(item)}
      contentContainerStyle={styles.listContainer}
      ListFooterComponent={renderFooter}
      ListEmptyComponent={renderEmpty}
      onMomentumScrollBegin={() => {
        onEndReachedCalledDuringMomentum.current = false;
      }}
      onEndReached={() => {
        if (loading || onEndReachedCalledDuringMomentum.current) {
          return;
        }
        onEndReachedCalledDuringMomentum.current = true;
        onLoadMore();
      }}
      onEndReachedThreshold={0.2}
    />
  );
}
