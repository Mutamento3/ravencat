/** 主动生活页面样式：History-first 时间轴、轻量未来摘要与日程详情弹层。 */

import { StyleSheet } from 'react-native';
import type { PresentationTheme } from '@shared/theme';

const TIMELINE_NODE_SIZE = 9;
const TIMELINE_RUNNING_NODE_SIZE = 11;

export const createStyles = (theme: PresentationTheme) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.colors.background.app },
  list: { flex: 1, backgroundColor: theme.colors.background.screen },
  listContent: { paddingBottom: theme.spacing.xxl },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  muted: { marginTop: theme.spacing.sm, color: theme.colors.text.secondary },

  // 顶部「下一次」轻量摘要
  nextCard: {
    marginHorizontal: theme.spacing.lg,
    marginTop: theme.spacing.lg,
    padding: theme.spacing.lg,
    borderRadius: theme.radius.lg,
    backgroundColor: theme.colors.surface.default,
  },
  nextLabel: { fontSize: 13, color: theme.colors.text.tertiary },
  nextTime: { ...theme.typography.title, marginTop: theme.spacing.xs },
  nextSummary: { ...theme.typography.body, marginTop: theme.spacing.xs, color: theme.colors.text.primary },
  nextSource: { marginTop: theme.spacing.sm, fontSize: 13, color: theme.colors.text.secondary },
  nextEmpty: {
    marginHorizontal: theme.spacing.lg,
    marginTop: theme.spacing.lg,
    fontSize: 14,
    color: theme.colors.text.tertiary,
  },

  // 未来安排展开入口与列表
  futureToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginHorizontal: theme.spacing.lg,
    marginTop: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
    minHeight: 44,
  },
  futureToggleText: { fontSize: 14, fontWeight: '500', color: theme.colors.text.link },
  futureSection: { marginBottom: theme.spacing.sm },
  futureEmpty: {
    marginHorizontal: theme.spacing.lg,
    marginTop: theme.spacing.sm,
    fontSize: 13,
    color: theme.colors.text.tertiary,
  },
  futureMore: {
    marginHorizontal: theme.spacing.lg,
    paddingVertical: theme.spacing.sm,
    minHeight: 44,
    justifyContent: 'center',
  },
  futureMoreText: { fontSize: 13, color: theme.colors.text.link },
  futureLoading: { marginVertical: theme.spacing.md },

  // 时间轴
  dayHeader: {
    marginHorizontal: theme.spacing.lg,
    marginTop: theme.spacing.lg,
    marginBottom: theme.spacing.xs,
    fontSize: 13,
    fontWeight: '600',
    color: theme.colors.text.secondary,
  },
  timelineRow: {
    flexDirection: 'row',
    paddingHorizontal: theme.spacing.lg,
  },
  timelineTime: {
    width: 44,
    paddingTop: 1,
    textAlign: 'right',
    fontSize: 12,
    color: theme.colors.text.tertiary,
  },
  timelineRail: { width: 20, alignItems: 'center' },
  timelineLine: {
    ...StyleSheet.absoluteFillObject,
    left: 10 - StyleSheet.hairlineWidth / 2,
    width: StyleSheet.hairlineWidth,
    backgroundColor: theme.colors.border.light,
  },
  timelineNode: {
    marginTop: 5,
    width: TIMELINE_NODE_SIZE,
    height: TIMELINE_NODE_SIZE,
    borderRadius: theme.radius.round,
    backgroundColor: theme.colors.text.secondary,
  },
  timelineNodeFuture: {
    backgroundColor: theme.colors.background.screen,
    borderWidth: 1.5,
    borderColor: theme.colors.text.tertiary,
  },
  timelineNodeRunning: {
    width: TIMELINE_RUNNING_NODE_SIZE,
    height: TIMELINE_RUNNING_NODE_SIZE,
    marginTop: 4,
    backgroundColor: theme.colors.brand.primary,
  },
  timelineContent: { flex: 1, paddingBottom: theme.spacing.lg },
  timelineSummary: { ...theme.typography.body, color: theme.colors.text.primary, lineHeight: 21 },
  timelineSummaryFuture: { color: theme.colors.text.secondary },
  timelineMeta: { marginTop: 3, fontSize: 12, color: theme.colors.text.tertiary },
  timelineRunningMeta: { color: theme.colors.brand.primary },

  historyEmpty: {
    marginHorizontal: theme.spacing.lg,
    marginTop: theme.spacing.xl,
    fontSize: 14,
    color: theme.colors.text.tertiary,
  },
  historyFooter: {
    marginHorizontal: theme.spacing.lg,
    paddingVertical: theme.spacing.md,
    alignItems: 'center',
    minHeight: 44,
    justifyContent: 'center',
  },
  historyFooterText: { fontSize: 13, color: theme.colors.text.link },

  // inline 错误与日程详情弹层
  errorCard: {
    marginHorizontal: theme.spacing.lg,
    marginTop: theme.spacing.lg,
    padding: theme.spacing.md,
    borderRadius: theme.radius.md,
    backgroundColor: theme.colors.surface.default,
  },
  errorText: { color: theme.colors.feedback.error, lineHeight: 20 },
  detailScroll: { flexShrink: 1 },
  detailBody: { paddingHorizontal: theme.spacing.lg, paddingTop: theme.spacing.md, paddingBottom: theme.spacing.lg },
  detailTime: { fontSize: 13, color: theme.colors.text.tertiary },
  detailSummary: { ...theme.typography.titleSmall, marginTop: theme.spacing.xs, color: theme.colors.text.primary },
  detailDetails: { ...theme.typography.body, marginTop: theme.spacing.md, color: theme.colors.text.secondary, lineHeight: 21 },
  detailSourceLabel: { marginTop: theme.spacing.lg, fontSize: 13, fontWeight: '600', color: theme.colors.text.secondary },
  detailSourceExcerpt: { marginTop: theme.spacing.xs, fontSize: 13, lineHeight: 19, color: theme.colors.text.tertiary },
  detailError: { marginTop: theme.spacing.md, color: theme.colors.feedback.error, lineHeight: 20 },
  detailActions: { marginTop: theme.spacing.lg },
  detailLoading: { paddingVertical: theme.spacing.xl, alignItems: 'center' },
});
