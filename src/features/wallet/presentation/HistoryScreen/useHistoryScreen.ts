/**
 * @fileoverview HistoryScreen 状态逻辑 Hook
 */

import { useState, useCallback, useMemo } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { getLedgerRangeSummary } from '../../composition';
import {
  getWeekDays,
  getMonday,
  getMonthWeeks,
  getYearMonths,
  getTimeRangeKey,
  addDays,
  addMonths,
  addYears,
} from '../utils/timeUtils';
import type {
  ViewType,
  TimeRange,
  SummaryData,
} from './types';

interface UseHistoryScreenOptions {
  initialView: ViewType;
  initialDate: Date;
  onSelectTimeRange: (timeRange: TimeRange, summary: SummaryData) => void;
}

export function useHistoryScreen({
  initialView,
  initialDate,
  onSelectTimeRange,
}: UseHistoryScreenOptions) {
  const [currentView, setCurrentView] = useState<ViewType>(initialView);
  const [currentDate, setCurrentDate] = useState<Date>(initialDate);
  const [loading, setLoading] = useState(false);
  const [summaries, setSummaries] = useState<Map<string, SummaryData>>(new Map());
  
  // 根据视图计算时间范围列表
  const timeRanges = useMemo(() => {
    switch (currentView) {
      case 'week': {
        const ranges: TimeRange[] = [];
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const target = new Date(currentDate);
        target.setHours(0, 0, 0, 0);

        let cursor = new Date(today);
        while (getMonday(cursor).getTime() >= getMonday(target).getTime()) {
          ranges.push(...getWeekDays(cursor));
          cursor = addDays(getMonday(cursor), -1);
          cursor.setHours(0, 0, 0, 0);
        }

        return ranges;
      }
      case 'month': {
        const ranges: TimeRange[] = [];
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const target = new Date(currentDate);
        target.setHours(0, 0, 0, 0);

        let cursor = new Date(today.getFullYear(), today.getMonth(), 1);
        const targetMonthStart = new Date(target.getFullYear(), target.getMonth(), 1);

        while (cursor.getTime() >= targetMonthStart.getTime()) {
          ranges.push(...getMonthWeeks(cursor.getFullYear(), cursor.getMonth() + 1));
          cursor = addMonths(cursor, -1);
          cursor = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
        }

        return ranges;
      }
      case 'year':
        return getYearMonths(currentDate.getFullYear());
      default:
        return [];
    }
  }, [currentView, currentDate]);

  // 加载数据
  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const newDataArray = [];
      for (const range of timeRanges) {
          const data = await getLedgerRangeSummary(
            range.startDate,
            range.endDate
          );
          newDataArray.push({
            key: getTimeRangeKey(range),
            value: {
              timeRange: range,
              ...data,
            },
          });
      }
      
      setSummaries(new Map(newDataArray.map(({ key, value }) => [key, value])));
    } finally {
      setLoading(false);
    }
  }, [timeRanges]);

  // 从详情编辑或 AI 聊天返回后重新查询，不能继续使用旧统计缓存。
  useFocusEffect(useCallback(() => {
    void loadData();
  }, [loadData]));

  // 切换视图
  const handleViewChange = useCallback((view: ViewType) => {
    setCurrentView(view);
    setCurrentDate(new Date());
  }, []);

  // 加载更多（上一周/月/年）
  const handleLoadMore = useCallback(() => {
    let newDate = new Date(currentDate);
    switch (currentView) {
      case 'week':
        newDate = addDays(newDate, -7);
        break;
      case 'month':
        newDate = addMonths(newDate, -1);
        break;
      case 'year':
        newDate = addYears(newDate, -1);
        break;
    }
    setCurrentDate(newDate);
  }, [currentView, currentDate]);

  // 加载更新（下一周/月/年）
  const handleLoadNewer = useCallback(() => {
    let newDate = new Date(currentDate);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    switch (currentView) {
      case 'week':
        newDate = addDays(newDate, 7);
        break;
      case 'month':
        newDate = addMonths(newDate, 1);
        break;
      case 'year':
        newDate = addYears(newDate, 1);
        break;
    }

    newDate.setHours(0, 0, 0, 0);
    
    // 不允许超过今天
    if (newDate <= today) {
      setCurrentDate(newDate);
    }
  }, [currentView, currentDate]);

  // 选择卡片
  const handleSelectCard = useCallback((timeRange: TimeRange) => {
    const summary = summaries.get(getTimeRangeKey(timeRange));
    if (summary) {
      onSelectTimeRange(timeRange, summary);
    }
  }, [summaries, onSelectTimeRange]);

  // 获取卡片数据
  const getCardData = useCallback((range: TimeRange) => {
    return summaries.get(getTimeRangeKey(range));
  }, [summaries]);

  return {
    currentView,
    currentDate,
    timeRanges,
    loading,
    summaries,
    handleViewChange,
    handleLoadMore,
    handleLoadNewer,
    handleSelectCard,
    getCardData,
  };
}
