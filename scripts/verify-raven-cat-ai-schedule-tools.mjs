import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourcePath = 'src/features/companion/aiTools/AIScheduleTools.ts';
const compiled = ts.transpileModule(
  fs.readFileSync(path.join(repoRoot, sourcePath), 'utf8'),
  {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: sourcePath,
    reportDiagnostics: true,
  },
);
assert.deepEqual(
  (compiled.diagnostics ?? []).filter(({ category }) => category === ts.DiagnosticCategory.Error),
  [],
);

let currentHostAIId = 'host-ai';
const calls = [];
const schedule = {
  scheduleId: 'schedule-a',
  ownerAIId: 'host-ai',
  systemCalendar: true,
  remindAt: '2026-09-10T09:00:00.000Z',
  summary: '考试',
  details: '数据库考试',
  sourceConversationId: null,
  sourceMessageIds: null,
  sourceExcerpt: null,
  status: 'scheduled',
  claimedByRunId: null,
  claimedAt: null,
  consumedAt: null,
  cancelledAt: null,
  createdAt: '2026-09-09T08:00:00.000Z',
  updatedAt: '2026-09-09T08:00:00.000Z',
};
const application = {
  listAISchedulesQuery: async (input) => {
    calls.push(['list', input]);
    return {
      status: 'listed',
      page: {
        items: [{ scheduleId: schedule.scheduleId, remindAt: schedule.remindAt, summary: schedule.summary, status: schedule.status }],
        nextCursor: null,
        hasMore: false,
      },
    };
  },
  getAIScheduleQuery: async (input) => {
    calls.push(['get', input]);
    return { status: 'found', schedule };
  },
};

let projectionMode = 'projected';
let calendarMode = 'synced';
let createError = null;
function projectionFor(operation) {
  return projectionMode === 'failed'
    ? { status: 'projection_failed', operation, error: new Error('native unavailable') }
    : { status: operation === 'cancel' ? 'canceled' : 'projected' };
}

const projectionOwner = {
  createAIScheduleWithProjection: async (input) => {
    calls.push(['create', input]);
    if (createError) return { status: 'error', code: createError, projection: null };
    return { status: 'created', schedule: { ...schedule, systemCalendar: input.systemCalendar }, calendar: calendarMode, projection: projectionFor('schedule') };
  },
  updateAIScheduleWithProjection: async (input) => {
    calls.push(['update', input]);
    return { status: 'updated', schedule: { ...schedule, summary: input.summary ?? schedule.summary }, calendar: 'synced', projection: projectionFor('schedule') };
  },
  cancelAIScheduleWithProjection: async (input) => {
    calls.push(['cancel', input]);
    return { status: 'cancelled', schedule: { ...schedule, status: 'cancelled' }, calendar: 'synced', projection: projectionFor('cancel') };
  },
};

const module = { exports: {} };
new Function('exports', 'require', 'module', compiled.outputText)(
  module.exports,
  (specifier) => {
    if (specifier === '@features/assistants') {
      return {
        runAsCurrentHostAuthority: async (actorAIId, action) => (
          actorAIId === currentHostAIId
            ? { status: 'authorized', value: await action() }
            : { status: 'not_current_host' }
        ),
      };
    }
    if (specifier === '@shared/runtime/abortSignal') {
      return {
        throwIfAbortSignalAborted: (signal) => {
          if (signal.aborted) throw signal.reason;
        },
      };
    }
    if (specifier === '../application/AIScheduleApplication') return application;
    if (specifier === '../application/AIScheduleProjectionOwner') return projectionOwner;
    throw new Error(`未声明的运行时依赖：${specifier}`);
  },
  module,
);

const tools = [
  module.exports.CreateAIScheduleTool,
  module.exports.ListAISchedulesTool,
  module.exports.GetAIScheduleTool,
  module.exports.UpdateAIScheduleTool,
  module.exports.CancelAIScheduleTool,
];
assert.deepEqual(tools.map(({ name }) => name), [
  'create_ai_schedule',
  'list_ai_schedules',
  'get_ai_schedule',
  'update_ai_schedule',
  'cancel_ai_schedule',
]);
assert.ok(tools.every((tool) => tool.definition.parameters.additionalProperties === false));

const context = {
  runId: 'run-a',
  toolCallId: 'call-a',
  abortSignal: new AbortController().signal,
  task: {
    id: 'task-a',
    type: 'chat',
    source: 'chat',
    goal: 'test',
    assistantId: 'host-ai',
    sessionId: 'session-a',
    allowedToolNames: tools.map(({ name }) => name),
    modelTransport: 'complete',
    maxSteps: 4,
    maxToolCalls: 8,
    maxToolCallsPerStep: 4,
    createdAt: '2026-09-09T08:00:00.000Z',
  },
};

assert.equal((await tools[0].execute({
  remind_at: schedule.remindAt,
  summary: schedule.summary,
  details: schedule.details,
  source_message_ids: ['11'],
}, context)).status, 'success');
const listResult = await tools[1].execute({
  from: '2026-09-09T00:00:00.000Z',
  to: '2026-09-12T00:00:00.000Z',
  status: 'all',
}, context);
assert.equal(listResult.status, 'success');
assert.deepEqual(Object.keys(listResult.data.items[0]).sort(), ['remindAt', 'scheduleId', 'status', 'summary']);
assert.equal((await tools[2].execute({ schedule_id: 'schedule-a' }, context)).status, 'success');
assert.equal((await tools[3].execute({ schedule_id: 'schedule-a', summary: '改期考试' }, context)).status, 'success');
assert.equal((await tools[4].execute({ schedule_id: 'schedule-a' }, context)).status, 'success');
assert.deepEqual(calls.map(([name]) => name), ['create', 'list', 'get', 'update', 'cancel']);
assert.equal(calls[0][1].sourceConversationId, 'session-a');
assert.equal(calls[0][1].systemCalendar, true);
await tools[0].execute({ remind_at: schedule.remindAt, summary: schedule.summary, details: schedule.details, system_calendar: false }, context);
assert.equal(calls.at(-1)[1].systemCalendar, false);

// native projection 失败仍返回 durable degraded success；模型必须知道不要重复业务操作。
projectionMode = 'failed';
const degradedCreate = await tools[0].execute({
  remind_at: schedule.remindAt,
  summary: schedule.summary,
  details: schedule.details,
}, context);
assert.equal(degradedCreate.status, 'success');
assert.equal(degradedCreate.data.projectionStatus, 'projection_failed');
assert.equal(degradedCreate.data.projectionOperation, 'schedule');
assert.match(degradedCreate.modelContent, /不要重复创建/);

const degradedUpdate = await tools[3].execute({
  schedule_id: schedule.scheduleId,
  summary: '暂时更新',
}, context);
assert.equal(degradedUpdate.status, 'success');
assert.equal(degradedUpdate.data.projectionStatus, 'projection_failed');
assert.equal(degradedUpdate.data.projectionOperation, 'schedule');
assert.match(degradedUpdate.modelContent, /不要重复更新/);

const degradedCancel = await tools[4].execute({ schedule_id: schedule.scheduleId }, context);
assert.equal(degradedCancel.status, 'success');
assert.equal(degradedCancel.data.projectionStatus, 'projection_failed');
assert.equal(degradedCancel.data.projectionOperation, 'cancel');
assert.match(degradedCancel.modelContent, /不要重复取消/);
projectionMode = 'projected';

// 模型可明确区分提交前拒绝与提交后系统提醒未同步，避免生成重复日程。
createError = 'calendar_permission_required';
const missingCalendarPermission = await tools[0].execute({
  remind_at: schedule.remindAt, summary: schedule.summary, details: schedule.details,
}, context);
assert.equal(missingCalendarPermission.status, 'error');
assert.equal(missingCalendarPermission.code, 'CALENDAR_PERMISSION_REQUIRED');
assert.match(missingCalendarPermission.modelContent, /system_calendar=false/);
createError = null;
calendarMode = 'failed';
const calendarPartialSuccess = await tools[0].execute({
  remind_at: schedule.remindAt, summary: schedule.summary, details: schedule.details,
}, context);
assert.equal(calendarPartialSuccess.status, 'success');
assert.equal(calendarPartialSuccess.data.scheduleId, schedule.scheduleId);
assert.equal(calendarPartialSuccess.data.calendarStatus, 'failed');
assert.match(calendarPartialSuccess.modelContent, /不要重复创建/);

currentHostAIId = 'other-ai';
const denied = await tools[1].execute({
  from: '2026-09-09T00:00:00.000Z',
  to: '2026-09-12T00:00:00.000Z',
}, context);
assert.equal(denied.status, 'error');
assert.equal(denied.code, 'NOT_CURRENT_HOST');

console.log('AI Schedule 五个 Host Tool 行为检查通过。');
