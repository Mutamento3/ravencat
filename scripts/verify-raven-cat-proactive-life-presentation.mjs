/**
 * 主动生活正式 UI 的 presentation verifier。
 *
 * 行为部分直接执行 proactiveLifeViewModel 的纯展示逻辑（formatter / 分组 / 分页合并 /
 * timeline 行模型 / 错误文案）；结构部分只锁定跨文件 wiring contract
 * （路由、设置页入口、projection-aware command 边界），不锁定实现形状。
 */

import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

function loadTypeScriptModule(relativePath, mocks = {}) {
  const sourcePath = path.join(repoRoot, relativePath);
  const compiled = ts.transpileModule(read(relativePath), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: sourcePath,
    reportDiagnostics: true,
  });
  const errors = (compiled.diagnostics ?? []).filter(
    (diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error,
  );
  assert.deepEqual(errors, [], `${relativePath} 无法编译`);
  const module = { exports: {} };
  new Function('exports', 'require', 'module', '__filename', '__dirname', compiled.outputText)(
    module.exports,
    (specifier) => {
      assert.ok(Object.hasOwn(mocks, specifier), `${relativePath} 缺少 mock：${specifier}`);
      return mocks[specifier];
    },
    module,
    sourcePath,
    path.dirname(sourcePath),
  );
  return module.exports;
}

const vm = loadTypeScriptModule('src/features/companion/presentation/proactiveLifeViewModel.ts');

/** 用本地时间构造 Date，保证「今天/明天/昨天」断言与运行机器时区无关。 */
const D = (year, month, day, hour = 0, minute = 0) => new Date(year, month - 1, day, hour, minute);
const iso = (date) => date.toISOString();

const futureItem = (sourceType, sourceId, plannedAt, summary = null) => ({
  sourceType,
  sourceId,
  ownerAIId: 'owner-a',
  plannedAt,
  summary,
});
const historyItem = (sourceType, sourceId, occurredAt, chatAnchor = null, terminalAt = occurredAt) => ({
  sourceType,
  sourceId,
  ownerAIId: 'owner-a',
  plannedAt: occurredAt,
  summary: `summary-${sourceId}`,
  occurredAt,
  terminalAt,
  runId: `run-${sourceId}`,
  completionDisposition: 'completed',
  chatAnchor,
});

// ── source label：self_wake 是「自主醒来」，不允许退化成「联系」语义。
assert.equal(vm.proactiveLifeSourceLabel('ai_schedule'), '日程');
assert.equal(vm.proactiveLifeSourceLabel('ai_schedule'), '日程');
for (const sourceType of ['ai_schedule', 'ai_schedule']) {
  assert.ok(!vm.proactiveLifeSourceLabel(sourceType).includes('联系'));
}

// ── consumed disposition：read model 的 completed / interrupted 显示映射必须稳定。
assert.equal(vm.proactiveLifeCompletionDispositionLabel('completed'), '已执行');
assert.equal(vm.proactiveLifeCompletionDispositionLabel('interrupted'), '执行因故障中断');
assert.equal(vm.proactiveLifeCompletionDispositionLabel('unexecuted'), '未执行');
assert.equal(vm.proactiveLifeCompletionDispositionLabel('failed'), '执行失误');
assert.equal(vm.proactiveLifeCompletionDispositionLabel('interrupted', true), 'AI 已响应 · 执行因故障中断');

// ── 时钟格式：Z 与 +08:00 是绝对时间的等价表达，必须解析出同一本地时钟。
assert.equal(vm.formatProactiveLifeClock(iso(D(2026, 9, 9, 18, 32))), '18:32');
assert.equal(vm.formatProactiveLifeClock(iso(D(2026, 9, 9, 8, 5))), '08:05');
assert.equal(
  vm.formatProactiveLifeClock('2026-09-09T02:32:00.000Z'),
  vm.formatProactiveLifeClock('2026-09-09T10:32:00.000+08:00'),
);

// ── 下一次未来时间摘要：今天 / 明天 / 具体日期 / 跨年。
{
  const now = D(2026, 9, 9, 12, 0);
  assert.equal(vm.formatProactiveLifeFutureTime(iso(D(2026, 9, 9, 22, 0)), now), '今天 22:00');
  assert.equal(vm.formatProactiveLifeFutureTime(iso(D(2026, 9, 10, 9, 30)), now), '明天 09:30');
  assert.equal(vm.formatProactiveLifeFutureTime(iso(D(2026, 9, 12, 20, 0)), now), '9月12日 20:00');
  assert.equal(vm.formatProactiveLifeFutureTime(iso(D(2027, 1, 5, 8, 5)), now), '2027年1月5日 08:05');
}

// ── 日期分组标题：今天/明天/昨天附带日期，其余纯日期，跨年补全年份。
{
  const now = D(2026, 9, 9, 12, 0);
  assert.equal(vm.formatProactiveLifeDayLabel(iso(D(2026, 9, 9, 8, 0)), now), '今天 · 9月9日');
  assert.equal(vm.formatProactiveLifeDayLabel(iso(D(2026, 9, 10, 8, 0)), now), '明天 · 9月10日');
  assert.equal(vm.formatProactiveLifeDayLabel(iso(D(2026, 9, 8, 23, 59)), now), '昨天 · 9月8日');
  assert.equal(vm.formatProactiveLifeDayLabel(iso(D(2026, 9, 1, 8, 0)), now), '9月1日');
  assert.equal(vm.formatProactiveLifeDayLabel(iso(D(2025, 12, 31, 8, 0)), now), '2025年12月31日');
}

// ── History 分组：按 occurredAt 的本地日期分组，组内与组间都保持 read model 顺序。
{
  const now = D(2026, 9, 9, 12, 0);
  const items = [
    // terminalAt 跨到次日也不能改变按 occurredAt 的本地日期分组。
    historyItem('ai_schedule', 'wake-2', iso(D(2026, 9, 9, 18, 32)), null, iso(D(2026, 9, 10, 0, 32))),
    historyItem('ai_schedule', 'schedule-1', iso(D(2026, 9, 9, 14, 5))),
    historyItem('ai_schedule', 'wake-1', iso(D(2026, 9, 8, 9, 0))),
  ];
  const groups = vm.groupProactiveLifeHistory(items, now);
  assert.equal(groups.length, 2);
  assert.equal(groups[0].label, '今天 · 9月9日');
  assert.deepEqual(groups[0].items.map((item) => item.sourceId), ['wake-2', 'schedule-1']);
  assert.equal(groups[1].label, '昨天 · 9月8日');
  assert.deepEqual(groups[1].items.map((item) => item.sourceId), ['wake-1']);
}

// ── Future 分组：按 plannedAt 分组，保持 read model 的升序。
{
  const now = D(2026, 9, 9, 12, 0);
  const items = [
    futureItem('ai_schedule', 'wake-f1', iso(D(2026, 9, 9, 22, 0))),
    futureItem('ai_schedule', 'schedule-f1', iso(D(2026, 9, 10, 9, 30))),
  ];
  const groups = vm.groupProactiveLifeFuture(items, now);
  assert.equal(groups.length, 2);
  assert.equal(groups[0].label, '今天 · 9月9日');
  assert.equal(groups[1].label, '明天 · 9月10日');
}

// ── 分页合并：keyset 页之间重叠时不重复、顺序稳定。
{
  const existing = [
    historyItem('ai_schedule', 'wake-a', iso(D(2026, 9, 9, 10, 0))),
    historyItem('ai_schedule', 'wake-b', iso(D(2026, 9, 9, 9, 0))),
  ];
  const page = [
    historyItem('ai_schedule', 'wake-b', iso(D(2026, 9, 9, 9, 0))),
    historyItem('ai_schedule', 'schedule-c', iso(D(2026, 9, 8, 8, 0))),
  ];
  const merged = vm.mergeProactiveLifePage(existing, page);
  assert.deepEqual(
    merged.map((item) => item.sourceId),
    ['wake-a', 'wake-b', 'schedule-c'],
  );
}

// ── Timeline 行模型：running 是时间轴顶端的普通行（不是独立大卡），多条 running 全部保留；
//    history 以 day-header 分隔，顺序 newest-first 原样来自 read model。
{
  const now = D(2026, 9, 9, 20, 0);
  const rows = vm.buildProactiveLifeTimelineRows({
    runningItems: [
      { ...futureItem('ai_schedule', 'wake-r1', iso(D(2026, 9, 9, 18, 0))), startedAt: iso(D(2026, 9, 9, 18, 32)), runId: 'run-1' },
      { ...futureItem('ai_schedule', 'schedule-r1', iso(D(2026, 9, 9, 18, 5))), startedAt: iso(D(2026, 9, 9, 18, 40)), runId: 'run-2' },
    ],
    historyItems: [
      historyItem('ai_schedule', 'wake-h1', iso(D(2026, 9, 9, 14, 5))),
      historyItem('ai_schedule', 'wake-h0', iso(D(2026, 9, 8, 9, 0))),
    ],
    now,
  });
  assert.deepEqual(rows.map((row) => row.kind), [
    'running', 'running', 'day-header', 'history', 'day-header', 'history',
  ]);
  assert.equal(rows[0].item.sourceId, 'wake-r1');
  assert.equal(rows[1].item.sourceId, 'schedule-r1');
  assert.equal(rows[2].label, '今天 · 9月9日');
  assert.equal(rows[4].label, '昨天 · 9月8日');
}

// ── AI Schedule 业务错误文案：已知 code 有明确中文反馈，未知 code 有兜底。
for (const code of ['not_found', 'not_owner', 'not_scheduled', 'already_past', 'invalid_time']) {
  const message = vm.resolveAIScheduleCommandErrorMessage(code);
  assert.ok(typeof message === 'string' && message.length > 0, `缺少错误文案：${code}`);
}
assert.notEqual(
  vm.resolveAIScheduleCommandErrorMessage('not_found'),
  vm.resolveAIScheduleCommandErrorMessage('already_past'),
);
assert.ok(vm.resolveAIScheduleCommandErrorMessage('something_else').length > 0);

// ── 取消按钮可见性预判：只有 scheduled 且未到点的日程可以取消。
{
  const now = D(2026, 9, 9, 12, 0);
  assert.equal(vm.canCancelAISchedule({ status: 'scheduled', remindAt: iso(D(2026, 9, 9, 22, 0)) }, now), true);
  assert.equal(vm.canCancelAISchedule({ status: 'scheduled', remindAt: iso(D(2026, 9, 9, 8, 0)) }, now), false);
  assert.equal(vm.canCancelAISchedule({ status: 'consumed', remindAt: iso(D(2026, 9, 9, 22, 0)) }, now), false);
}

// ── 跨文件 wiring contract（只锁定连接面，不锁定实现形状）。
const screenSource = read('src/features/companion/presentation/ProactiveLifeScreen.tsx');
for (const required of [
  'loadProactiveLifeOverview',
  'listProactiveLifeFuture',
  'listProactiveLifeHistory',
  'cancelAIScheduleWithProjection',
]) {
  assert.ok(screenSource.includes(required), `主动生活页面缺少能力：${required}`);
}
assert.ok(
  !screenSource.includes('cancelAIScheduleCommand'),
  '取消日程必须走 projection-aware command，不允许绕过 ProjectionOwner',
);
const settingsSource = read('src/features/companion/presentation/CompanionSettingsScreen.tsx');
assert.ok(settingsSource.includes("'proactive-life'"), '设置页子路由缺少 proactive-life');
assert.ok(settingsSource.includes('主动生活'), '设置页缺少主动生活入口');

const ravenCatIndexSource = read('src/app/raven-cat/index.tsx');
assert.ok(ravenCatIndexSource.includes('/raven-cat/proactive-life'), 'RavenCat 路由缺少 proactive-life 映射');

const proactiveLifeRouteSource = read('src/app/raven-cat/proactive-life.tsx');
assert.ok(proactiveLifeRouteSource.includes('ProactiveLifeScreen'), 'proactive-life 路由未挂载页面');

console.log('RavenCat proactive life presentation checks passed.');
