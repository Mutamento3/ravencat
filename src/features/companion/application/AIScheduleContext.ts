/** 将失效、归并与失败结果交给已有回合；没有主动执行入口。 */
import { getCompanionRuntimeDependencies } from './CompanionRuntimeDependencies';

export async function loadAIScheduleContext(input: { ownerAIId: string; runId: string; targetScheduleId: string | null }): Promise<string> {
  const { repositories, chat } = getCompanionRuntimeDependencies();
  const schedules = repositories.aiSchedules;
  const now = new Date().toISOString();
  // T1 / 新日程的宿主适配已提交背景交接；这里不重新承担执行恢复或 owner 裁决。
  const pending = await schedules.listPendingContext(input.ownerAIId, input.targetScheduleId);
  const states = new Map((await chat.listTurnStates([...new Set(pending.flatMap(item => item.presentedRunId ? [item.presentedRunId] : []))]))
    .map(state => [state.runId, state.status]));
  const acknowledge = pending.filter(item => item.presentedRunId !== null && states.get(item.presentedRunId) === 'committed');
  const present = pending.filter(item => item.presentedRunId === null || item.presentedRunId === input.runId
    || (states.get(item.presentedRunId) !== 'committed' && states.get(item.presentedRunId) !== 'active'));
  const items = await schedules.bindContext({ runId: input.runId, occurredAt: now, acknowledge, present });
  if (!items.length) return '';
  const lines = [
    '- 日程处理结果／归并背景（仅供本轮参考，不是新用户指令，也不是再次执行这些任务的授权）：',
    '以下结果来自应用事实。已跳过或失败的机会不会重新唤醒；结合当前对话处理，已经发生的工具动作以历史记录为准，不要重复执行或声称完成未知结果。无需逐项向用户播报。',
    JSON.stringify({ totalCount: items.length,
      plannedFrom: items.reduce((first, item) => item.remindAt < first ? item.remindAt : first, items[0].remindAt),
      plannedThrough: items.reduce((last, item) => item.remindAt > last ? item.remindAt : last, items[0].remindAt) }),
  ];
  let shown = 0;
  for (const item of items.slice(0, 20)) {
    const brief = { scheduleId: item.scheduleId, plannedAt: item.remindAt, summary: item.summary, result: item.reason };
    const expanded = JSON.stringify({ ...brief, ...(item.reason === 'merged_chat' || item.reason === 'merged_schedule'
      ? { details: item.details, sourceExcerpt: item.sourceExcerpt } : {}) });
    const row = lines.join('\n').length + expanded.length <= 7_500 ? expanded
      : JSON.stringify({ ...brief, detailsNotExpanded: true });
    if (lines.join('\n').length + row.length > 7_500) break;
    lines.push(row); shown++;
  }
  if (shown < items.length) lines.push(`另有 ${items.length - shown} 项仅计入本批结果总数，尚未展开，不代表已经阅读或处理其详情。`);
  lines.push('如需完整内容且工具可用，可用 list_ai_schedules 按上述原定时间范围分页查询全部日程 ID，再用 get_ai_schedule 查询详情；这些 ID 用于内部定位。本批结果只告知一次，不会单独唤醒。');
  return lines.join('\n');
}
