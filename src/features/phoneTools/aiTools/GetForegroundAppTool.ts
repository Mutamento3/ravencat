/** 主理 AI 获取 Device Observer 可靠识别到的前台应用身份。 */

import { runAsCurrentHostAuthority } from '@features/assistants';
import type { ToolContext, ToolExecuteResult } from '@shared/aiTools';
import { throwIfAbortSignalAborted } from '@shared/runtime/abortSignal';
import { loadCurrentProtectedPackages } from '../application/CurrentProtectedAppsPolicy';
import { getForegroundAppRuntimeDependencies } from '../application/ForegroundAppRuntimeDependencies';
import { isProtectedPackage } from '../application/ProtectedAppsPolicy';

export interface ForegroundAppResultData {
  packageName: string;
  protected: boolean;
}

export const definition = {
  name: 'get_foreground_app',
  description: '【主理 AI 专属】获取当前可靠识别到的前台 Android 应用及其受保护状态，不读取页面内容',
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
    return { success: false, error: 'missing_actor_ai_id: 未识别到当前 AI 身份' };
  }

  const authorityResult = await runAsCurrentHostAuthority(actorAiId, async () => {
    throwIfAbortSignalAborted(context.abortSignal);

    const windowState = await getForegroundAppRuntimeDependencies().getCurrentWindowState();
    if (!windowState.detectionReliable || !windowState.packageName) {
      return {
        success: false,
        error: 'foreground_app_unavailable: 当前无法可靠识别前台应用',
      } satisfies ToolExecuteResult;
    }

    const protectedPackages = await loadCurrentProtectedPackages();
    const data: ForegroundAppResultData = {
      packageName: windowState.packageName,
      protected: isProtectedPackage(windowState.packageName, protectedPackages),
    };
    return {
      success: true,
      message: `当前前台应用为 ${data.packageName}，受保护状态：${data.protected ? '是' : '否'}。`,
      data,
    } satisfies ToolExecuteResult;
  });

  if (authorityResult.status === 'not_current_host') {
    return { success: false, error: 'not_current_host: 当前 AI 已不再是主理 AI' };
  }

  return authorityResult.value;
}

export const GetForegroundAppTool = {
  name: definition.name,
  definition,
  execute,
};
