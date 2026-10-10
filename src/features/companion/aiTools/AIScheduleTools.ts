/** 主理 AI 管理自身持久日程的五个正常 Agent-native Tools。 */

import { runAsCurrentHostAuthority } from '@features/assistants';
import type { AgentToolExecutionContext, AgentToolExecutionResult } from '@shared/aiTools';
import { throwIfAbortSignalAborted } from '@shared/runtime/abortSignal';
import {
  cancelAIScheduleWithProjection,
  createAIScheduleWithProjection,
  updateAIScheduleWithProjection,
} from '../application/AIScheduleProjectionOwner';
import type { AIScheduleProjectionOutcome } from '../application/AIScheduleProjectionOwner';
import type { AIScheduleApplicationErrorCode } from '../application/AIScheduleApplication';
import {
  getAIScheduleQuery,
  listAISchedulesQuery,
} from '../application/AIScheduleApplication';
import type { AISchedule, AIScheduleStatus } from '../domain/AISchedule';
import type { AIScheduleListCursor, AIScheduleListPage } from '../domain/AIScheduleRepository';

type ProjectionAwareAISchedule = AISchedule & {
  projectionStatus: AIScheduleProjectionOutcome['status'];
  projectionOperation?: Extract<
    AIScheduleProjectionOutcome,
    { status: 'projection_failed' }
  >['operation'];
};

type ToolResult<T> = Promise<AgentToolExecutionResult<T>>;

export const CreateAIScheduleTool = {
  name: 'create_ai_schedule',
  definition: {
    name: 'create_ai_schedule',
    description: '【主理 AI 专属】主动伴随开启时，安排一次未来自主唤醒；可以自主安排或回应用户要求，到点依据最新聊天上下文决定行动。已有同一安排应修改，不要重复创建；日程不是预写消息',
    parameters: {
      type: 'object',
      properties: {
        remind_at: { type: 'string', description: '带 Z 或 UTC offset 的未来绝对时间' },
        summary: { type: 'string', description: '用于列表浏览的简短事件摘要，最多 160 字符' },
        details: { type: 'string', description: '未来理解事件所需的背景，最多 4000 字符' },
        source_message_ids: {
          type: 'array',
          items: { type: 'string' },
          description: '可选，当前会话中确实与日程有关的 canonical 消息 identity；不要猜测 identity',
          maxItems: 12,
          uniqueItems: true,
        },
      },
      required: ['remind_at', 'summary', 'details'],
      additionalProperties: false,
    },
  },
  execute: executeCreate,
} as const;

export const ListAISchedulesTool = {
  name: 'list_ai_schedules',
  definition: {
    name: 'list_ai_schedules',
    description: '【主理 AI 专属】按 1 天至 3 个月的范围轻量浏览自己的 AI 日程',
    parameters: {
      type: 'object',
      properties: {
        from: { type: 'string', description: '带 Z 或 UTC offset 的范围起点（含）' },
        to: { type: 'string', description: '带 Z 或 UTC offset 的范围终点（不含）' },
        status: {
          type: 'string',
          enum: ['scheduled', 'claimed', 'consumed', 'cancelled', 'all'],
        },
        limit: { type: 'integer', minimum: 1, maximum: 50 },
        cursor: {
          type: 'object',
          properties: {
            remind_at: { type: 'string' },
            schedule_id: { type: 'string' },
          },
          required: ['remind_at', 'schedule_id'],
          additionalProperties: false,
        },
      },
      required: ['from', 'to'],
      additionalProperties: false,
    },
  },
  execute: executeList,
} as const;

export const GetAIScheduleTool = {
  name: 'get_ai_schedule',
  definition: {
    name: 'get_ai_schedule',
    description: '【主理 AI 专属】读取一条 AI 日程的完整详情与 bounded canonical source snapshot',
    parameters: idParameters(),
  },
  execute: executeGet,
} as const;

export const UpdateAIScheduleTool = {
  name: 'update_ai_schedule',
  definition: {
    name: 'update_ai_schedule',
    description: '【主理 AI 专属】修改尚未到期的 scheduled AI 日程，保留原 stable identity 与来源快照',
    parameters: {
      type: 'object',
      properties: {
        schedule_id: { type: 'string' },
        remind_at: { type: 'string', description: '可选，新的未来绝对时间' },
        summary: { type: 'string', description: '可选，新的简短摘要' },
        details: { type: 'string', description: '可选，新的详情' },
      },
      required: ['schedule_id'],
      additionalProperties: false,
    },
  },
  execute: executeUpdate,
} as const;

export const CancelAIScheduleTool = {
  name: 'cancel_ai_schedule',
  definition: {
    name: 'cancel_ai_schedule',
    description: '【主理 AI 专属】取消尚未到期的 scheduled AI 日程；历史记录会永久保留',
    parameters: idParameters(),
  },
  execute: executeCancel,
} as const;

interface CreateArgs {
  remind_at: string;
  summary: string;
  details: string;
  source_message_ids?: string[];
}

async function executeCreate(
  args: CreateArgs,
  context: AgentToolExecutionContext,
): ToolResult<ProjectionAwareAISchedule> {
  const sourceConversationId = args.source_message_ids ? context.task.sessionId : undefined;
  if (args.source_message_ids && !sourceConversationId) return error('invalid_source');
  const authority = await authorized(context, () => createAIScheduleWithProjection({
    ownerAIId: context.task.assistantId,
    remindAt: args.remind_at,
    summary: args.summary,
    details: args.details,
    sourceConversationId: sourceConversationId ?? undefined,
    sourceMessageIds: args.source_message_ids,
  }));
  if (authority.status === 'not_current_host') return notCurrentHost();
  const outcome = authority.value;
  if (outcome.status === 'error') return error(outcome.code);
  return mapProjectionAwareSuccess(outcome.schedule, outcome.projection, 'saved');
}

interface ListArgs {
  from: string;
  to: string;
  status?: AIScheduleStatus | 'all';
  limit?: number;
  cursor?: { remind_at: string; schedule_id: string };
}

async function executeList(
  args: ListArgs,
  context: AgentToolExecutionContext,
): ToolResult<AIScheduleListPage> {
  const after: AIScheduleListCursor | null = args.cursor
    ? { remindAt: args.cursor.remind_at, scheduleId: args.cursor.schedule_id }
    : null;
  const authority = await authorized(context, () => listAISchedulesQuery({
    ownerAIId: context.task.assistantId,
    from: args.from,
    to: args.to,
    status: args.status === 'all' ? undefined : args.status,
    limit: args.limit,
    after,
  }));
  if (authority.status === 'not_current_host') return notCurrentHost();
  const outcome = authority.value;
  if (outcome.status === 'error') return error(outcome.code);
  return {
    status: 'success',
    data: outcome.page,
    modelContent: JSON.stringify(outcome.page),
  };
}

async function executeGet(
  args: { schedule_id: string },
  context: AgentToolExecutionContext,
): ToolResult<AISchedule> {
  const authority = await authorized(context, () => getAIScheduleQuery({
    scheduleId: args.schedule_id,
    ownerAIId: context.task.assistantId,
  }));
  if (authority.status === 'not_current_host') return notCurrentHost();
  const outcome = authority.value;
  if (outcome.status === 'error') return error(outcome.code);
  return { status: 'success', data: outcome.schedule, modelContent: JSON.stringify(outcome.schedule) };
}

interface UpdateArgs {
  schedule_id: string;
  remind_at?: string;
  summary?: string;
  details?: string;
}

async function executeUpdate(
  args: UpdateArgs,
  context: AgentToolExecutionContext,
): ToolResult<ProjectionAwareAISchedule> {
  const authority = await authorized(context, () => updateAIScheduleWithProjection({
    scheduleId: args.schedule_id,
    ownerAIId: context.task.assistantId,
    remindAt: args.remind_at,
    summary: args.summary,
    details: args.details,
  }));
  if (authority.status === 'not_current_host') return notCurrentHost();
  const outcome = authority.value;
  if (outcome.status === 'error') return error(outcome.code);
  return mapProjectionAwareSuccess(outcome.schedule, outcome.projection, 'updated');
}

async function executeCancel(
  args: { schedule_id: string },
  context: AgentToolExecutionContext,
): ToolResult<ProjectionAwareAISchedule> {
  const authority = await authorized(context, () => cancelAIScheduleWithProjection({
    scheduleId: args.schedule_id,
    ownerAIId: context.task.assistantId,
  }));
  if (authority.status === 'not_current_host') return notCurrentHost();
  const outcome = authority.value;
  if (outcome.status === 'error') return error(outcome.code);
  return mapProjectionAwareSuccess(outcome.schedule, outcome.projection, 'cancelled');
}

function mapProjectionAwareSuccess(
  schedule: AISchedule,
  projection: AIScheduleProjectionOutcome,
  operation: 'saved' | 'updated' | 'cancelled',
): AgentToolExecutionResult<ProjectionAwareAISchedule> {
  const projectionOperation = projection.status === 'projection_failed'
    ? projection.operation
    : undefined;
  const data: ProjectionAwareAISchedule = {
    ...schedule,
    projectionStatus: projection.status,
    ...(projectionOperation ? { projectionOperation } : {}),
  };
  const durableFact = operation === 'cancelled'
    ? `AI 日程已取消，历史记录仍保留。\nscheduleId = ${schedule.scheduleId}`
    : `AI 日程已${operation === 'saved' ? '保存' : '更新'}。\nscheduleId = ${schedule.scheduleId}\nremindAt = ${schedule.remindAt}`;
  if (projection.status === 'projection_failed') {
    return {
      status: 'success',
      data,
      modelContent: `${durableFact}\n业务事实已持久化，但 native projection 暂时失败，后台会自动恢复；不要重复${operation === 'saved' ? '创建' : operation === 'updated' ? '更新' : '取消'}这条日程。`,
    };
  }
  return {
    status: 'success',
    data,
    modelContent: `${durableFact}\nnative projection = ${projection.status}`,
  };
}

function authorized<T>(context: AgentToolExecutionContext, action: () => Promise<T>) {
  return runAsCurrentHostAuthority(context.task.assistantId, async () => {
    throwIfAbortSignalAborted(context.abortSignal);
    return action();
  });
}

function idParameters() {
  return {
    type: 'object',
    properties: { schedule_id: { type: 'string' } },
    required: ['schedule_id'],
    additionalProperties: false,
  } as const;
}

function notCurrentHost<T>(): AgentToolExecutionResult<T> {
  return {
    status: 'error',
    code: 'NOT_CURRENT_HOST',
    retryable: false,
    modelContent: '当前 AI 已不再是主理 AI，不能访问或修改 AI Schedule。',
  };
}

function error<T>(code: AIScheduleApplicationErrorCode): AgentToolExecutionResult<T> {
  const messages: Record<AIScheduleApplicationErrorCode, string> = {
    companion_disabled: '主动伴随当前已关闭，不能新建、修改或执行 AI 日程；已有计划暂停保留。',
    not_found: '没有找到这条 AI 日程。',
    not_owner: '这条 AI 日程不属于当前主理 AI。',
    not_scheduled: '这条 AI 日程已进入不可修改的历史状态。',
    not_claimed: '这条 AI 日程当前未被 claim，不能 consume。',
    already_past: '这条日程的原 remindAt 已经到达，过去的时间事实不能再更新或取消。',
    invalid_time: '时间必须是带 Z 或 UTC offset 的有效未来绝对时间。',
    invalid_range: '查询范围必须至少 1 天、最多 3 个月，且分页参数必须有效。',
    invalid_source: '来源消息不存在、不属于当前会话，或不是可保存的 canonical user/assistant 消息。',
    invalid_content: 'summary/details 为空、超出长度上限，或 update 没有提供任何修改。',
    already_claimed: '这条 AI 日程已经被另一个 run claim，本次没有取得执行权。',
    already_terminal: '这条 AI 日程已经完成或进入终态，本次不会重复收口。',
    run_mismatch: '当前 run 不是这条 AI 日程的 claim owner。',
    not_due: '这条 AI 日程的 remindAt 尚未到达，本次 callback 过早，不执行。',
    stale_projection: '本次 callback 对应的是已被更新/取消的旧版本日程，不执行。',
  };
  return {
    status: 'error',
    code: code.toUpperCase(),
    retryable: code === 'invalid_time' || code === 'invalid_range' || code === 'invalid_content',
    modelContent: messages[code],
  };
}
