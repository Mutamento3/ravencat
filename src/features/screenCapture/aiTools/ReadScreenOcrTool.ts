/** 主理 AI 读取当前窗口一次安全冻结截图的 OCR 文字。 */

import { runAsCurrentHostAuthority } from '@features/assistants';
import type { ToolContext, ToolExecuteResult } from '@shared/aiTools';
import { throwIfAbortSignalAborted } from '@shared/runtime/abortSignal';
import {
  readOcrForCurrentWindow,
  type ScreenOcrSnapshot,
} from '../application/ScreenOcrObservation';
import { ScreenOcrObservationError } from '../application/ScreenOcrObservationPolicy';

export const definition = {
  name: 'read_screen_ocr',
  description: '对当前 Android 页面做一次安全屏幕截图快照，并通过本地 OCR 读取其中的可见文字；不理解非文字视觉内容。',
  parameters: {
    type: 'object',
    properties: {},
    additionalProperties: false,
  },
} as const;

export async function execute(
  _args: Record<string, never>,
  context: ToolContext,
): Promise<ToolExecuteResult> {
  const actorAiId = context.getAIId();
  if (!actorAiId) {
    return {
      success: false,
      errorCode: 'missing_actor_ai_id',
      error: 'missing_actor_ai_id: 未识别到当前 AI 身份',
    };
  }

  try {
    const authorityResult = await runAsCurrentHostAuthority(actorAiId, async () => {
      throwIfAbortSignalAborted(context.abortSignal);
      const snapshot = await readOcrForCurrentWindow();
      return {
        success: true,
        message: formatScreenOcrSnapshotForModel(snapshot),
        data: snapshot,
      } satisfies ToolExecuteResult;
    });

    if (authorityResult.status === 'not_current_host') {
      return {
        success: false,
        errorCode: 'not_current_host',
        error: 'not_current_host: 当前 AI 已不再是主理 AI',
      };
    }

    return authorityResult.value;
  } catch (error) {
    if (!(error instanceof ScreenOcrObservationError)) throw error;
    return {
      success: false,
      errorCode: error.reason,
      error: `${error.reason}: ${error.message}`,
    };
  }
}

/**
 * 模型正文优先直接使用 bounded snapshot 的 plainText，不再重复展开 blocks / lines。
 *
 * 截图身份（packageName / capturedAtEpochMs）来自 PHONE-5A 已经冻结的截图，OCR 期间窗口变化
 * 不影响本次结果。no_text 是成功，明确写出而不触发 fallback。truncation 只描述结果完整性，
 * 不额外制造第二套展示上限。
 */
export function formatScreenOcrSnapshotForModel(snapshot: ScreenOcrSnapshot): string {
  return [
    `当前应用：${snapshot.packageName}`,
    `截图时间：${snapshot.capturedAtEpochMs}`,
    '',
    'OCR 文字：',
    snapshot.plainText || 'no_text: 当前屏幕快照中未识别到可读取文字',
    '',
    `结果完整性：${formatTruncation(snapshot)}`,
  ].join('\n');
}

function formatTruncation(snapshot: ScreenOcrSnapshot): string {
  if (!snapshot.truncated) return '未裁剪';
  const { blockLimitReached, lineLimitReached, characterLimitReached } = snapshot.truncation;
  return [
    '部分 OCR 内容已裁剪：',
    `blockLimitReached=${blockLimitReached}`,
    `lineLimitReached=${lineLimitReached}`,
    `characterLimitReached=${characterLimitReached}`,
  ].join(', ');
}

export const ReadScreenOcrTool = {
  name: definition.name,
  definition,
  execute,
};
