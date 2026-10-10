/**
 * autonomous Agent run 终态诊断摘要。
 *
 * 只读取 AgentRunResult，不写入任何状态、不触发任何副作用、不改变 terminal result。
 * 用途是回答"AI 有没有调用工具、调用结果如何"，并辅助识别只有内部 completion
 * 而没有外部动作的 run。completion 不是用户可见消息，也不是 delivery evidence。
 * 摘要只携带 tool name、outcome status、error code、retryable、stepIndex，
 * 以及有长度上限的 DEV-only internal completion preview。
 *
 * 刻意不记录：tool arguments、outcome.modelContent、outcome.data、prompt / history。
 * 这些内容可能包含用户内容、文件内容和设备信息。
 */

import type { AgentRunResult } from '@platform/agentRuntime';

/** DEV-only 内部 completion 预览；不是用户可见消息，也不是 delivery evidence。 */
const INTERNAL_COMPLETION_PREVIEW_MAX_LENGTH = 240;

type AutonomousRunStep = AgentRunResult['steps'][number];
type AutonomousRunToolCallRecord = AutonomousRunStep['toolCalls'][number];

export type AutonomousRunToolCallSummary =
  | { stepIndex: number; name: string; status: 'success' }
  | {
      stepIndex: number;
      name: string;
      status: 'error';
      code: string;
      retryable: boolean;
    };

export interface AutonomousRunDiagnosticSummary {
  status: AgentRunResult['status'];
  terminalCode: AgentRunResult['terminalCode'];
  stepCount: number;
  toolCallCount: number;
  toolCalls: AutonomousRunToolCallSummary[];
  hasInternalCompletion: boolean;
  internalCompletionPreview?: string;
}

export function summarizeAutonomousAgentRun(
  result: AgentRunResult,
): AutonomousRunDiagnosticSummary {
  const summary: AutonomousRunDiagnosticSummary = {
    status: result.status,
    terminalCode: result.terminalCode,
    stepCount: result.stepCount,
    toolCallCount: result.toolCallCount,
    toolCalls: result.steps.flatMap((step) => step.toolCalls.map(
      (record) => toToolCallSummary(record, step.stepIndex),
    )),
    hasInternalCompletion: result.finalText.trim().length > 0,
  };
  if (isDevelopmentEnvironment()) {
    const preview = buildInternalCompletionPreview(result.finalText);
    if (preview !== undefined) summary.internalCompletionPreview = preview;
  }
  return summary;
}

/** 纯函数：截断后台 run 的内部 completion；不推断任何用户可见或交付事实。 */
export function buildInternalCompletionPreview(text: string): string | undefined {
  const preview = text.trim();
  if (preview.length === 0) return undefined;
  return preview.length > INTERNAL_COMPLETION_PREVIEW_MAX_LENGTH
    ? `${preview.slice(0, INTERNAL_COMPLETION_PREVIEW_MAX_LENGTH)}...`
    : preview;
}

function toToolCallSummary(
  record: AutonomousRunToolCallRecord,
  stepIndex: number,
): AutonomousRunToolCallSummary {
  const { outcome } = record;
  if (outcome.status === 'error') {
    return {
      stepIndex,
      name: record.toolCall.name,
      status: 'error',
      code: outcome.code,
      retryable: outcome.retryable,
    };
  }
  return { stepIndex, name: record.toolCall.name, status: 'success' };
}

function isDevelopmentEnvironment(): boolean {
  return typeof __DEV__ !== 'undefined' && __DEV__ === true;
}
