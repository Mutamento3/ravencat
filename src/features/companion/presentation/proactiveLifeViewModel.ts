/**
 * 主动生活页面的纯展示逻辑：时间格式化、日期分组、分页合并与 timeline 行模型。
 *
 * 本文件只做展示推导，不拥有任何业务事实；所有 durable timestamp 原样来自统一 read model，
 * 仅在这里转换为设备本地 locale/timezone 的显示文本。
 */

import type {
  ProactiveLifeFutureItem,
  ProactiveLifeHistoryItem,
  ProactiveLifeRunningItem,
  ProactiveLifeSourceType,
} from '../application/ProactiveLifeReadQueries';
import type { ProactiveLifeCompletionDisposition } from '../domain/ProactiveLifeReadRepository';
import type { AIScheduleApplicationErrorCode } from '../application/AIScheduleApplication';
import type { AISchedule } from '../domain/AISchedule';

export function proactiveLifeSourceLabel(_sourceType: ProactiveLifeSourceType): string {
  return '日程';
}

/** 将 read model 的稳定终态映射为用户可理解的历史状态。 */
export function proactiveLifeCompletionDispositionLabel(
  disposition: ProactiveLifeCompletionDisposition,
  modelResponded = false,
): string {
  const label = disposition === 'completed' ? '已执行'
    : disposition === 'unexecuted' ? '未执行'
    : disposition === 'interrupted' ? '执行因故障中断' : '执行失误';
  return modelResponded && disposition !== 'completed' ? `AI 已响应 · ${label}` : label;
}

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

/** 本地时钟时间，例如 18:32。 */
export function formatProactiveLifeClock(isoTime: string): string {
  const date = new Date(isoTime);
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

function isSameLocalDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear()
    && a.getMonth() === b.getMonth()
    && a.getDate() === b.getDate();
}

function formatLocalDate(date: Date, now: Date): string {
  const monthDay = `${date.getMonth() + 1}月${date.getDate()}日`;
  return date.getFullYear() === now.getFullYear()
    ? monthDay
    : `${date.getFullYear()}年${monthDay}`;
}

/** 日期分组标题：今天/明天/昨天附带具体日期，其余直接显示日期（跨年补全年份）。 */
export function formatProactiveLifeDayLabel(isoTime: string, now: Date): string {
  const date = new Date(isoTime);
  const dateText = formatLocalDate(date, now);
  if (isSameLocalDay(date, now)) return `今天 · ${dateText}`;
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  if (isSameLocalDay(date, tomorrow)) return `明天 · ${dateText}`;
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  if (isSameLocalDay(date, yesterday)) return `昨天 · ${dateText}`;
  return dateText;
}

/** 顶部「下一次」的未来时间摘要：今天 22:00 / 明天 09:30 / 9月12日 20:00。 */
export function formatProactiveLifeFutureTime(isoTime: string, now: Date): string {
  const date = new Date(isoTime);
  const clock = formatProactiveLifeClock(isoTime);
  if (isSameLocalDay(date, now)) return `今天 ${clock}`;
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  if (isSameLocalDay(date, tomorrow)) return `明天 ${clock}`;
  return `${formatLocalDate(date, now)} ${clock}`;
}

/** 详情弹层使用的完整本地时间，例如 2026年9月12日 20:00。 */
export function formatProactiveLifeFullDateTime(isoTime: string): string {
  const date = new Date(isoTime);
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日 ${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

export interface ProactiveLifeDayGroup<TItem> {
  key: string;
  label: string;
  items: TItem[];
}

function groupByLocalDay<TItem>(
  items: TItem[],
  timeOf: (item: TItem) => string,
  now: Date,
): ProactiveLifeDayGroup<TItem>[] {
  const groups: ProactiveLifeDayGroup<TItem>[] = [];
  const byKey = new Map<string, ProactiveLifeDayGroup<TItem>>();
  for (const item of items) {
    const date = new Date(timeOf(item));
    const key = `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
    let group = byKey.get(key);
    if (!group) {
      group = { key, label: formatProactiveLifeDayLabel(timeOf(item), now), items: [] };
      byKey.set(key, group);
      groups.push(group);
    }
    group.items.push(item);
  }
  return groups;
}

/** History 分组的显示时间使用 occurredAt：真正获得执行机会/醒来的时间。 */
export function groupProactiveLifeHistory(
  items: ProactiveLifeHistoryItem[],
  now: Date,
): ProactiveLifeDayGroup<ProactiveLifeHistoryItem>[] {
  return groupByLocalDay(items, (item) => item.occurredAt, now);
}

export function groupProactiveLifeFuture(
  items: ProactiveLifeFutureItem[],
  now: Date,
): ProactiveLifeDayGroup<ProactiveLifeFutureItem>[] {
  return groupByLocalDay(items, (item) => item.plannedAt, now);
}

/** 统一 item 的稳定 identity；history/future 分页合并时用于去重。 */
export function proactiveLifeItemKey(item: {
  sourceType: ProactiveLifeSourceType;
  sourceId: string;
}): string {
  return `${item.sourceType}:${item.sourceId}`;
}

export function mergeProactiveLifePage<TItem extends {
  sourceType: ProactiveLifeSourceType;
  sourceId: string;
}>(existing: TItem[], page: TItem[]): TItem[] {
  const seen = new Set(existing.map(proactiveLifeItemKey));
  const appended = page.filter((item) => {
    const key = proactiveLifeItemKey(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return [...existing, ...appended];
}

export type ProactiveLifeTimelineRow =
  | { kind: 'day-header'; key: string; label: string }
  | { kind: 'running'; key: string; item: ProactiveLifeRunningItem }
  | { kind: 'history'; key: string; item: ProactiveLifeHistoryItem };

/**
 * 主时间轴行模型：running 是当前正在发生的时间轴顶端（可能有多条，全部真实显示），
 * 之后是 newest-first 的历史分组；排序完全沿用 read model，UI 不重新排序。
 */
export function buildProactiveLifeTimelineRows(input: {
  runningItems: ProactiveLifeRunningItem[];
  historyItems: ProactiveLifeHistoryItem[];
  now: Date;
}): ProactiveLifeTimelineRow[] {
  const rows: ProactiveLifeTimelineRow[] = [];
  for (const item of input.runningItems) {
    rows.push({ kind: 'running', key: `running:${proactiveLifeItemKey(item)}`, item });
  }
  for (const group of groupProactiveLifeHistory(input.historyItems, input.now)) {
    rows.push({ kind: 'day-header', key: `day:${group.key}`, label: group.label });
    for (const item of group.items) {
      rows.push({ kind: 'history', key: `history:${proactiveLifeItemKey(item)}`, item });
    }
  }
  return rows;
}

/**
 * AI Schedule 用户可理解的取消/编辑失败文案。
 * Domain 规则是最终裁决者（例如到点即不可取消），UI 只把失败 code 翻译成业务反馈。
 */
export function resolveAIScheduleCommandErrorMessage(
  code: AIScheduleApplicationErrorCode,
): string {
  switch (code) {
    case 'companion_disabled':
      return '主动伴随已关闭，日程已暂停。';
    case 'not_found':
      return '这条日程已经不存在了。';
    case 'not_owner':
      return '这条日程不属于当前主理 AI。';
    case 'not_scheduled':
    case 'already_claimed':
      return '这条日程已经在执行或已结束，无法更改。';
    case 'already_past':
      return '这条日程已经过了执行时间，无法更改。';
    case 'invalid_time':
      return '日程时间无效。';
    case 'invalid_content':
      return '日程内容无效。';
    case 'invalid_source':
      return '日程来源对话无效。';
    case 'invalid_range':
      return '查询时间范围无效。';
    case 'not_claimed':
    case 'run_mismatch':
    case 'not_due':
    case 'stale_projection':
    default:
      return '操作失败，请稍后重试。';
  }
}

/** UI 侧的取消按钮可见性预判；真正裁决仍以 cancel 命令的 Domain 错误为准。 */
export function canCancelAISchedule(
  schedule: Pick<AISchedule, 'status' | 'remindAt'>,
  now: Date,
): boolean {
  return schedule.status === 'scheduled' && Date.parse(schedule.remindAt) > now.getTime();
}
