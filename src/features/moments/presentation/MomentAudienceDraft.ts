/**
 * 发布页「谁可以看」draft 的纯投影。
 *
 * 这里只表达 draft 形状、归一化与文案，**不建立第二份 visibility 规则**：可见性真值始终是
 * Application 的 `normalizeAudience()` 与 Repository SQL 里的 ACL。UI 的职责只有两个：
 * 把用户的三选一表达成 canonical `MomentAudience`，以及在身份失效时拒绝静默发布。
 *
 * audience persistence identity 只能是稳定 `agentId`：`assistant.id`、显示名称、列表下标
 * 都会随改名或重排漂移，不得写进 audience。
 */

import type { MomentAudience, MomentAudienceMode } from '../domain/MomentRepository';

/** 可见范围候选：只有 `agentId` 是身份，名称与头像仅用于展示。 */
export interface MomentAudienceCandidate {
  agentId: string;
  displayName: string;
  avatar: string | null;
}

export interface MomentAudienceDraft {
  mode: MomentAudienceMode;
  /** 与 mode 配套的 agentId 列表；`all` 时恒为空。 */
  viewerAgentIds: readonly string[];
}

export const DEFAULT_MOMENT_AUDIENCE_DRAFT: MomentAudienceDraft = {
  mode: 'all',
  viewerAgentIds: [],
};

/** 三个模式的用户可见文案；对应唯一 Domain 的 all / selected / all_except。 */
export const MOMENT_AUDIENCE_MODE_LABELS: Record<MomentAudienceMode, string> = {
  all: '所有 AI',
  selected: '仅部分 AI',
  all_except: '不给部分 AI 看',
};

/**
 * 切换可见范围模式。
 *
 * 跨模式**不保留**名单：`selected [A]` 与 `all_except [A]` 是含义相反的两件事
 * （「只有 A 能看」vs「唯独 A 不能看」）。这是隐私类 UI，不能为了少点一次而在反转语义时
 * 沿用旧勾选 —— 用户必须在新模式里重新明确选择（`selected` 空名单本来也不可提交）。
 * 同一模式内重复选择保留当前名单，只有「换模式」才清空。
 */
export function selectMomentAudienceMode(
  mode: MomentAudienceMode,
  current: MomentAudienceDraft
): MomentAudienceDraft {
  if (mode === current.mode) return current;
  return { mode, viewerAgentIds: [] };
}

export function toggleMomentAudienceCandidate(
  draft: MomentAudienceDraft,
  agentId: string
): MomentAudienceDraft {
  if (draft.mode === 'all') return draft;
  const selected = new Set(draft.viewerAgentIds);
  if (selected.has(agentId)) selected.delete(agentId);
  else selected.add(agentId);
  return { ...draft, viewerAgentIds: [...selected] };
}

/**
 * 能否确认/发布。
 *
 * `selected` 必须至少勾一个：空 allow list 没有合法语义，Application 也会以
 * `empty_audience` 拒绝。`all_except` 空名单等价于「不排除任何 AI」。
 */
export function isMomentAudienceDraftSubmittable(draft: MomentAudienceDraft): boolean {
  return draft.mode !== 'selected' || draft.viewerAgentIds.length > 0;
}

/**
 * 把 draft 收敛成「与最终发布事实一致」的 canonical draft。
 *
 * - `all_except` + 空名单 ⇔ 不排除任何 AI ⇔ canonical 就是 `all`；
 * - `all` 永远不携带名单；
 * - `selected` + 空名单**不得**收敛成 `all`：非法 restricted 输入必须留在原地交给
 *   Application 拒绝，纯函数层绝不把它扩大成最宽可见范围。
 *
 * Modal 确认时必须提交 canonical draft，否则会出现「发布页显示 `不给部分 AI 看（未选择）`，
 * 而最终持久事实是 `all`」的 UI / 事实不一致。
 */
export function canonicalizeMomentAudienceDraft(
  draft: MomentAudienceDraft
): MomentAudienceDraft {
  if (draft.mode === 'all') return { mode: 'all', viewerAgentIds: [] };
  // 空 deny list 等价于「不排除任何 AI」，canonical 表示就是 all。
  if (draft.mode === 'all_except' && draft.viewerAgentIds.length === 0) {
    return { mode: 'all', viewerAgentIds: [] };
  }
  return { mode: draft.mode, viewerAgentIds: [...draft.viewerAgentIds] };
}

/**
 * draft → Application canonical audience。
 *
 * fail-closed：只有「空 deny list」这一种情况在语义上等价于 `all`。受限模式（`selected`）
 * 即使名单为空也**原样保留**，由 Application 以 `empty_audience` 拒绝——纯函数层不允许把
 * 非法的受限可见输入自动扩大成最宽松权限。
 */
export function toMomentAudience(draft: MomentAudienceDraft): MomentAudience {
  const canonical = canonicalizeMomentAudienceDraft(draft);
  if (canonical.mode === 'all') return { mode: 'all' };
  return { mode: canonical.mode, viewerAgentIds: [...canonical.viewerAgentIds] };
}

/** 发布页上的一行摘要。 */
export function describeMomentAudienceDraft(draft: MomentAudienceDraft): string {
  const label = MOMENT_AUDIENCE_MODE_LABELS[draft.mode];
  if (draft.mode === 'all') return label;
  return draft.viewerAgentIds.length > 0
    ? `${label}（${draft.viewerAgentIds.length}）`
    : `${label}（未选择）`;
}

/**
 * Timeline 上的可见范围提示。
 *
 * 只依赖 Moment 自己的 `audienceMode`，不额外查询名单：要显示精确名单就必须从 Repository
 * 正式读取 stable agentId rows 再解析，不能根据发布时的 UI state 猜。
 */
export function describeMomentVisibility(mode: MomentAudienceMode): string | null {
  if (mode === 'selected') return '部分 AI 可见';
  if (mode === 'all_except') return '部分 AI 不可见';
  return null;
}
