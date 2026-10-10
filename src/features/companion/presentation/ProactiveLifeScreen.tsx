/**
 * 「主动生活」页面：主理 AI 留下的生活轨迹。
 *
 * History-first：主体是自主醒来与日程的历史时间轴，顶部只放轻量的下一次摘要；
 * 本页面只消费统一 read model 与 projection-aware 的 AI Schedule command，
 * 不成为任何 wake / schedule 事实的第二 owner。
 */

import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, AppState, FlatList, RefreshControl, ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme, useThemedStyles } from '@shared/theme';
import { Button, EmptyState, ModalSheet, NavigationHeader, showAppDialog } from '@shared/ui';

import {
  cancelAIScheduleWithProjection,
  getAISchedule,
  listProactiveLifeFuture,
  listProactiveLifeHistory,
  loadCompanionProductState,
  loadProactiveLifeOverview,
  type ProactiveLifeFutureCursor,
  type ProactiveLifeFutureItem,
  type ProactiveLifeHistoryCursor,
  type ProactiveLifeHistoryItem,
  type ProactiveLifeOverview,
  type ProactiveLifeRunningItem,
} from '../application';
import type { AISchedule } from '../domain/AISchedule';
import {
  buildProactiveLifeTimelineRows,
  canCancelAISchedule,
  proactiveLifeCompletionDispositionLabel,
  formatProactiveLifeClock,
  formatProactiveLifeFullDateTime,
  formatProactiveLifeFutureTime,
  groupProactiveLifeFuture,
  mergeProactiveLifePage,
  proactiveLifeSourceLabel,
  resolveAIScheduleCommandErrorMessage,
  type ProactiveLifeTimelineRow,
} from './proactiveLifeViewModel';
import { createStyles } from './ProactiveLifeScreen.styles';

const HISTORY_PAGE_SIZE = 25;
const FUTURE_PAGE_SIZE = 20;
/** running 是 transient：仅在页面聚焦且存在 running 时低频刷新，没有 running 即停止。 */
const RUNNING_REFRESH_INTERVAL_MS = 15_000;

type Styles = ReturnType<typeof createStyles>;

interface ProactiveLifeScreenProps {
  onBack: () => void;
}

export default function ProactiveLifeScreen({ onBack }: ProactiveLifeScreenProps) {
  const theme = useTheme();
  const styles = useThemedStyles(createStyles);
  const hasLoadedRef = useRef(false);
  const hasFocusedRef = useRef(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [hostAIId, setHostAIId] = useState<string | null>(null);
  const [companionEnabled, setCompanionEnabled] = useState(false);
  const [overview, setOverview] = useState<ProactiveLifeOverview | null>(null);
  const [historyItems, setHistoryItems] = useState<ProactiveLifeHistoryItem[]>([]);
  const [historyCursor, setHistoryCursor] = useState<ProactiveLifeHistoryCursor | null>(null);
  const [historyHasMore, setHistoryHasMore] = useState(false);
  const [loadingMoreHistory, setLoadingMoreHistory] = useState(false);
  const [futureExpanded, setFutureExpanded] = useState(false);
  const [futureItems, setFutureItems] = useState<ProactiveLifeFutureItem[] | null>(null);
  const [futureCursor, setFutureCursor] = useState<ProactiveLifeFutureCursor | null>(null);
  const [futureHasMore, setFutureHasMore] = useState(false);
  const [loadingFuture, setLoadingFuture] = useState(false);
  const [detailScheduleId, setDetailScheduleId] = useState<string | null>(null);

  const loadFutureFirstPage = useCallback(async (ownerAIId: string) => {
    setLoadingFuture(true);
    try {
      const page = await listProactiveLifeFuture({
        ownerAIId,
        now: new Date().toISOString(),
        limit: FUTURE_PAGE_SIZE,
      });
      setFutureItems(page.items);
      setFutureCursor(page.nextCursor);
      setFutureHasMore(page.hasMore);
    } catch (error) {
      setErrorMessage(toMessage(error, '无法读取未来安排。'));
    } finally {
      setLoadingFuture(false);
    }
  }, []);

  const refresh = useCallback(async () => {
    if (hasLoadedRef.current) setRefreshing(true);
    try {
      const product = await loadCompanionProductState();
      const ownerAIId = product.hostAI?.id ?? null;
      setHostAIId(ownerAIId);
      setCompanionEnabled(product.state.desiredEnabled);
      if (!ownerAIId) {
        setOverview(null);
        setHistoryItems([]);
        setHistoryCursor(null);
        setHistoryHasMore(false);
        setFutureItems(null);
        setErrorMessage(null);
        return;
      }
      const nextOverview = await loadProactiveLifeOverview({
        ownerAIId,
        now: new Date().toISOString(),
        historyLimit: HISTORY_PAGE_SIZE,
      });
      setOverview(nextOverview);
      setHistoryItems(nextOverview.recentHistory);
      setHistoryCursor(nextOverview.historyNextCursor);
      setHistoryHasMore(nextOverview.historyNextCursor !== null);
      setErrorMessage(null);
      // 未来列表已展开时同步重载第一页，避免取消日程等操作后残留旧数据。
      if (futureExpanded) await loadFutureFirstPage(ownerAIId);
    } catch (error) {
      setErrorMessage(toMessage(error, '无法读取主动生活记录。'));
    } finally {
      hasLoadedRef.current = true;
      setLoading(false);
      setRefreshing(false);
    }
  }, [futureExpanded, loadFutureFirstPage]);

  useEffect(() => { void refresh(); }, [refresh]);

  useFocusEffect(useCallback(() => {
    if (!hasFocusedRef.current) {
      hasFocusedRef.current = true;
      return;
    }
    void refresh();
  }, [refresh]));

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active' && hasLoadedRef.current) void refresh();
    });
    return () => subscription.remove();
  }, [refresh]);

  const runningCount = overview?.runningItems.length ?? 0;
  useFocusEffect(useCallback(() => {
    if (runningCount === 0) return undefined;
    const interval = setInterval(() => { void refresh(); }, RUNNING_REFRESH_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [refresh, runningCount]));

  const loadMoreHistory = useCallback(async () => {
    if (!hostAIId || !historyHasMore || !historyCursor || loadingMoreHistory) return;
    setLoadingMoreHistory(true);
    try {
      const page = await listProactiveLifeHistory({
        ownerAIId: hostAIId,
        now: new Date().toISOString(),
        before: historyCursor,
        limit: HISTORY_PAGE_SIZE,
      });
      setHistoryItems((current) => mergeProactiveLifePage(current, page.items));
      setHistoryCursor(page.nextCursor);
      setHistoryHasMore(page.hasMore);
    } catch (error) {
      setErrorMessage(toMessage(error, '无法读取更多历史记录。'));
    } finally {
      setLoadingMoreHistory(false);
    }
  }, [hostAIId, historyCursor, historyHasMore, loadingMoreHistory]);

  const loadMoreFuture = useCallback(async () => {
    if (!hostAIId || !futureHasMore || !futureCursor || loadingFuture) return;
    setLoadingFuture(true);
    try {
      const page = await listProactiveLifeFuture({
        ownerAIId: hostAIId,
        now: new Date().toISOString(),
        after: futureCursor,
        limit: FUTURE_PAGE_SIZE,
      });
      setFutureItems((current) => mergeProactiveLifePage(current ?? [], page.items));
      setFutureCursor(page.nextCursor);
      setFutureHasMore(page.hasMore);
    } catch (error) {
      setErrorMessage(toMessage(error, '无法读取更多未来安排。'));
    } finally {
      setLoadingFuture(false);
    }
  }, [hostAIId, futureCursor, futureHasMore, loadingFuture]);

  const toggleFutureExpanded = useCallback(() => {
    const next = !futureExpanded;
    setFutureExpanded(next);
    if (next && futureItems === null && hostAIId) {
      void loadFutureFirstPage(hostAIId);
    }
  }, [futureExpanded, futureItems, hostAIId, loadFutureFirstPage]);

  const openScheduleDetail = useCallback((scheduleId: string) => {
    setDetailScheduleId(scheduleId);
  }, []);

  const closeScheduleDetail = useCallback(() => {
    setDetailScheduleId(null);
  }, []);

  const timelineRows = useMemo(
    () => buildProactiveLifeTimelineRows({
      runningItems: overview?.runningItems ?? [],
      historyItems,
      now: new Date(),
    }),
    [overview, historyItems],
  );

  if (loading) {
    return (
      <SafeAreaView style={styles.screen} edges={['top', 'left', 'right']}>
        <NavigationHeader title="主动生活" onGoBack={onBack} />
        <View style={styles.loading}>
          <ActivityIndicator color={theme.colors.brand.primary} />
          <Text style={styles.muted}>正在读取主动生活记录…</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (!hostAIId) {
    return (
      <SafeAreaView style={styles.screen} edges={['top', 'left', 'right']}>
        <NavigationHeader title="主动生活" onGoBack={onBack} />
        <EmptyState
          title="还没有主理 AI"
          description="选择主理 AI 后，这里会记录它未来的自主行动机会。"
          actionText="返回设置"
          onAction={onBack}
        />
      </SafeAreaView>
    );
  }

  if (!overview && errorMessage) {
    return (
      <SafeAreaView style={styles.screen} edges={['top', 'left', 'right']}>
        <NavigationHeader title="主动生活" onGoBack={onBack} />
        <EmptyState
          title="加载失败"
          description={errorMessage}
          actionText="重试"
          onAction={() => void refresh()}
        />
      </SafeAreaView>
    );
  }

  const nextFuture = overview?.nextFuture ?? null;
  const futureCount = overview?.futureCount ?? 0;
  const displayNow = new Date();

  const listHeader = (
    <View>
      {!companionEnabled ? (
        <Text style={styles.nextEmpty}>主动伴随已关闭，日程已暂停；错过的安排不会补跑。</Text>
      ) : null}
      {nextFuture ? (
        <View style={styles.nextCard}>
          <Text style={styles.nextLabel}>下一次</Text>
          <Text style={styles.nextTime}>{formatProactiveLifeFutureTime(nextFuture.plannedAt, displayNow)}</Text>
          {nextFuture.summary ? (
            <Text style={styles.nextSummary}>{nextFuture.summary}</Text>
          ) : null}
          <Text style={styles.nextSource}>{proactiveLifeSourceLabel(nextFuture.sourceType)}</Text>
        </View>
      ) : (
        <Text style={styles.nextEmpty}>暂时没有未来安排</Text>
      )}

      {futureCount > 1 ? (
        <TouchableOpacity
          style={styles.futureToggle}
          onPress={toggleFutureExpanded}
          accessibilityRole="button"
        >
          <Text style={styles.futureToggleText}>
            {futureExpanded ? '收起未来安排' : `查看未来安排  ${futureCount}`}
          </Text>
          <Ionicons
            name={futureExpanded ? 'chevron-up' : 'chevron-forward'}
            size={16}
            color={theme.colors.text.link}
          />
        </TouchableOpacity>
      ) : null}

      {futureExpanded ? (
        <View style={styles.futureSection}>
          {futureItems === null || (loadingFuture && futureItems.length === 0) ? (
            <ActivityIndicator style={styles.futureLoading} color={theme.colors.brand.primary} />
          ) : futureItems.length === 0 ? (
            <Text style={styles.futureEmpty}>暂时没有未来安排</Text>
          ) : (
            groupProactiveLifeFuture(futureItems, displayNow).map((group) => (
              <View key={group.key}>
                <Text style={styles.dayHeader}>{group.label}</Text>
                {group.items.map((item) => (
                  <FutureTimelineEntry
                    key={`${item.sourceType}:${item.sourceId}`}
                    item={item}
                    styles={styles}
                    onOpenSchedule={openScheduleDetail}
                  />
                ))}
              </View>
            ))
          )}
          {futureItems !== null && futureHasMore ? (
            <TouchableOpacity
              style={styles.futureMore}
              onPress={() => void loadMoreFuture()}
              disabled={loadingFuture}
              accessibilityRole="button"
            >
              {loadingFuture
                ? <ActivityIndicator size="small" color={theme.colors.brand.primary} />
                : <Text style={styles.futureMoreText}>加载更多未来安排</Text>}
            </TouchableOpacity>
          ) : null}
        </View>
      ) : null}

      {errorMessage ? (
        <View style={styles.errorCard}><Text style={styles.errorText}>{errorMessage}</Text></View>
      ) : null}
    </View>
  );

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'left', 'right']}>
      <NavigationHeader title="主动生活" onGoBack={onBack} />
      <FlatList
        style={styles.list}
        contentContainerStyle={styles.listContent}
        data={timelineRows}
        keyExtractor={(row) => row.key}
        renderItem={({ item }) => (
          <TimelineRowView row={item} styles={styles} />
        )}
        ListHeaderComponent={listHeader}
        ListEmptyComponent={
          <Text style={styles.historyEmpty}>还没有留下活动记录。</Text>
        }
        ListFooterComponent={
          loadingMoreHistory ? (
            <View style={styles.historyFooter}>
              <ActivityIndicator size="small" color={theme.colors.brand.primary} />
            </View>
          ) : historyHasMore ? (
            <TouchableOpacity
              style={styles.historyFooter}
              onPress={() => void loadMoreHistory()}
              accessibilityRole="button"
            >
              <Text style={styles.historyFooterText}>加载更早的记录</Text>
            </TouchableOpacity>
          ) : null
        }
        onEndReached={() => void loadMoreHistory()}
        onEndReachedThreshold={0.4}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} />
        }
      />

      <ModalSheet
        visible={detailScheduleId !== null}
        onClose={closeScheduleDetail}
        title="日程"
      >
        {detailScheduleId ? (
          <AIScheduleDetailContent
            scheduleId={detailScheduleId}
            ownerAIId={hostAIId}
            styles={styles}
            onClose={closeScheduleDetail}
            onCancelled={() => void refresh()}
          />
        ) : null}
      </ModalSheet>
    </SafeAreaView>
  );
}

function TimelineRowView({
  row,
  styles,
}: {
  row: ProactiveLifeTimelineRow;
  styles: Styles;
}) {
  if (row.kind === 'day-header') {
    return <Text style={styles.dayHeader}>{row.label}</Text>;
  }
  if (row.kind === 'running') {
    return <RunningTimelineEntry item={row.item} styles={styles} />;
  }
  const item = row.item;
  return (
    <View style={styles.timelineRow}>
      <Text style={styles.timelineTime}>{formatProactiveLifeClock(item.occurredAt)}</Text>
      <TimelineRail nodeStyle={styles.timelineNode} styles={styles} />
      <View style={styles.timelineContent}>
        <Text style={styles.timelineSummary}>{item.summary ?? ''}</Text>
        <Text style={styles.timelineMeta}>
          {proactiveLifeSourceLabel(item.sourceType)}
          <Text>{` · ${proactiveLifeCompletionDispositionLabel(item.completionDisposition, item.modelResponded)}`}</Text>
        </Text>
      </View>
    </View>
  );
}

function RunningTimelineEntry({ item, styles }: { item: ProactiveLifeRunningItem; styles: Styles }) {
  return (
    <View style={styles.timelineRow}>
      <Text style={styles.timelineTime}>{formatProactiveLifeClock(item.startedAt)}</Text>
      <TimelineRail nodeStyle={styles.timelineNodeRunning} styles={styles} />
      <View style={styles.timelineContent}>
        <Text style={styles.timelineSummary}>{item.summary ?? ''}</Text>
        <Text style={styles.timelineMeta}>
          {proactiveLifeSourceLabel(item.sourceType)}
          <Text style={styles.timelineRunningMeta}>{item.modelResponded ? ' · 唤醒成功，AI 已响应 · 正在行动' : ' · 等待 AI 响应'}</Text>
        </Text>
      </View>
    </View>
  );
}

function FutureTimelineEntry({
  item,
  styles,
  onOpenSchedule,
}: {
  item: ProactiveLifeFutureItem;
  styles: Styles;
  onOpenSchedule: ((scheduleId: string) => void) | null;
}) {
  const theme = useTheme();
  const content = (
    <View style={styles.timelineRow}>
      <Text style={styles.timelineTime}>{formatProactiveLifeClock(item.plannedAt)}</Text>
      <TimelineRail nodeStyle={[styles.timelineNode, styles.timelineNodeFuture]} styles={styles} />
      <View style={styles.timelineContent}>
        <Text
          style={[styles.timelineSummary, styles.timelineSummaryFuture]}
        >
          {item.summary ?? ''}
        </Text>
        <Text style={styles.timelineMeta}>{proactiveLifeSourceLabel(item.sourceType)}</Text>
      </View>
      {onOpenSchedule ? (
        <Ionicons name="chevron-forward" size={16} color={theme.colors.text.tertiary} />
      ) : null}
    </View>
  );
  if (!onOpenSchedule) return content;
  return (
    <TouchableOpacity onPress={() => onOpenSchedule(item.sourceId)} accessibilityRole="button">
      {content}
    </TouchableOpacity>
  );
}

function TimelineRail({
  nodeStyle,
  styles,
}: {
  nodeStyle: object | object[];
  styles: Styles;
}) {
  return (
    <View style={styles.timelineRail}>
      <View style={styles.timelineLine} pointerEvents="none" />
      <View style={nodeStyle} />
    </View>
  );
}

/**
 * AI Schedule 轻量详情：读取完整 durable detail；
 * 取消必须走 projection-aware command，业务失败（如已到点）原样展示 Domain 错误。
 */
function AIScheduleDetailContent({
  scheduleId,
  ownerAIId,
  styles,
  onClose,
  onCancelled,
}: {
  scheduleId: string;
  ownerAIId: string;
  styles: Styles;
  onClose: () => void;
  onCancelled: () => void;
}) {
  const theme = useTheme();
  const [schedule, setSchedule] = useState<AISchedule | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);

  useEffect(() => {
    let active = true;
    void getAISchedule({ scheduleId, ownerAIId }).then((outcome) => {
      if (!active) return;
      if (outcome.status === 'found') {
        setSchedule(outcome.schedule);
      } else {
        setLoadError(resolveAIScheduleCommandErrorMessage(outcome.code));
      }
    }).catch((error: unknown) => {
      if (active) setLoadError(toMessage(error, '无法读取日程详情。'));
    });
    return () => { active = false; };
  }, [scheduleId, ownerAIId]);

  const confirmCancel = useCallback((scheduleToCancel: AISchedule) => {
    showAppDialog({ title: '取消这条日程？', message: scheduleToCancel.summary, buttons: [
      { text: '再想想', style: 'cancel' },
      {
        text: '取消日程',
        style: 'destructive',
        onPress: () => void (async () => {
          setCancelling(true);
          setActionError(null);
          try {
            const outcome = await cancelAIScheduleWithProjection({ scheduleId, ownerAIId });
            if (outcome.status === 'cancelled') {
              onCancelled();
              onClose();
            } else {
              setActionError(resolveAIScheduleCommandErrorMessage(outcome.code));
            }
          } catch (error) {
            setActionError(toMessage(error, '操作失败，请稍后重试。'));
          } finally {
            setCancelling(false);
          }
        })(),
      },
    ] });
  }, [scheduleId, ownerAIId, onCancelled, onClose]);

  if (loadError) {
    return (
      <View style={styles.detailBody}>
        <Text style={styles.detailError}>{loadError}</Text>
      </View>
    );
  }
  if (!schedule) {
    return (
      <View style={styles.detailLoading}>
        <ActivityIndicator color={theme.colors.brand.primary} />
      </View>
    );
  }

  return (
    <ScrollView style={styles.detailScroll} contentContainerStyle={styles.detailBody}>
      <Text style={styles.detailTime}>{formatProactiveLifeFullDateTime(schedule.remindAt)}</Text>
      <Text style={styles.detailSummary}>{schedule.summary}</Text>
      {schedule.details && schedule.details !== schedule.summary ? (
        <Text style={styles.detailDetails}>{schedule.details}</Text>
      ) : null}
      {schedule.sourceExcerpt ? (
        <>
          <Text style={styles.detailSourceLabel}>来源对话</Text>
          <Text style={styles.detailSourceExcerpt}>{schedule.sourceExcerpt}</Text>
        </>
      ) : null}
      {schedule.status !== 'scheduled' ? (
        <Text style={styles.detailDetails}>这条日程已在执行或已结束。</Text>
      ) : null}
      {actionError ? <Text style={styles.detailError}>{actionError}</Text> : null}
      {canCancelAISchedule(schedule, new Date()) ? (
        <View style={styles.detailActions}>
          <Button
            title={cancelling ? '正在取消…' : '取消日程'}
            variant="danger"
            onPress={() => confirmCancel(schedule)}
            disabled={cancelling}
          />
        </View>
      ) : null}
    </ScrollView>
  );
}

function toMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}
