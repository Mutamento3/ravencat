/** 主理 AI 读取当前窗口的有界 Accessibility 语义。 */

import { runAsCurrentHostAuthority } from '@features/assistants';
import type { ToolContext, ToolExecuteResult } from '@shared/aiTools';
import { throwIfAbortSignalAborted } from '@shared/runtime/abortSignal';
import {
  readAccessibilitySemanticsForCurrentWindow,
  type ScreenSemanticNode,
  type ScreenSemanticSnapshot,
} from '../application/ScreenSemanticObservation';
import { ScreenSemanticObservationError } from '../application/ScreenSemanticObservationPolicy';

const MAX_STRUCTURE_LINES = 64;
const MAX_STRUCTURE_LABEL_CHARACTERS = 160;

export const definition = {
  name: 'read_screen_accessibility',
  description: '读取当前 Android 页面通过 Accessibility 暴露的文字和必要界面结构，不进行 OCR，也不代表可看到全部视觉内容',
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
      const snapshot = await readAccessibilitySemanticsForCurrentWindow();
      return {
        success: true,
        message: formatScreenSemanticSnapshotForModel(snapshot),
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
    if (!(error instanceof ScreenSemanticObservationError)) throw error;
    return {
      success: false,
      errorCode: error.reason,
      error: `${error.reason}: ${error.message}`,
    };
  }
}

export function formatScreenSemanticSnapshotForModel(
  snapshot: ScreenSemanticSnapshot,
): string {
  const structuralNodes = snapshot.nodes.filter(isStructuralNode);
  const structureLines = structuralNodes
    .slice(0, MAX_STRUCTURE_LINES)
    .map(formatStructuralNode);
  const structureWasLimited = structuralNodes.length > structureLines.length;

  return [
    `当前应用：${snapshot.packageName}`,
    '',
    '页面文字：',
    snapshot.plainText || 'no_text: 当前页面 Accessibility 未暴露可读取文字',
    '',
    '交互与输入结构：',
    ...(structureLines.length > 0 ? structureLines : ['无']),
    ...(structureWasLimited
      ? [`- 其余 ${structuralNodes.length - structureLines.length} 个交互节点未在结构区重复展开`]
      : []),
    '',
    `结果完整性：${formatTruncation(snapshot)}`,
  ].join('\n');
}

function isStructuralNode(node: ScreenSemanticNode): boolean {
  return Boolean(node.clickable || node.editable || node.password);
}

function formatStructuralNode(node: ScreenSemanticNode): string {
  const properties = [
    `depth=${node.depth}`,
    ...(node.className ? [`class=${quoteAndLimit(node.className)}`] : []),
    ...(node.clickable ? ['clickable'] : []),
    ...(node.editable ? ['editable'] : []),
    ...(node.password ? ['password'] : []),
  ];

  if (!node.password) {
    const label = node.contentDescription ?? node.text;
    if (label) properties.push(`label=${quoteAndLimit(label)}`);
  }

  return `- ${properties.join(' ')}`;
}

function quoteAndLimit(value: string): string {
  const limited = value.length > MAX_STRUCTURE_LABEL_CHARACTERS
    ? `${value.slice(0, MAX_STRUCTURE_LABEL_CHARACTERS)}…`
    : value;
  return JSON.stringify(limited);
}

function formatTruncation(snapshot: ScreenSemanticSnapshot): string {
  if (!snapshot.truncated) return '未裁剪';
  const { nodeLimitReached, depthLimitReached, characterLimitReached } = snapshot.truncation;
  return [
    '部分内容已裁剪：',
    `nodeLimitReached=${nodeLimitReached}`,
    `depthLimitReached=${depthLimitReached}`,
    `characterLimitReached=${characterLimitReached}`,
  ].join(', ');
}

export const ReadScreenAccessibilityTool = {
  name: definition.name,
  definition,
  execute,
};
