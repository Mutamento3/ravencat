/** 保持 ChatDetail 注入的 Together Listening capability，不让输入区 wrapper 复活缺失能力。 */

export function resolveTogetherListeningToolPanelHandler(
  capability: (() => Promise<unknown> | unknown) | undefined,
  wrappedHandler: () => void,
): (() => void) | undefined {
  return capability ? wrappedHandler : undefined;
}

/**
 * ChatToolPanel 的入口可见性只反映真实 capability callback：
 * handler 为 undefined 时「一起听」入口不存在，而不是 disabled/no-op。
 */
export function resolveChatToolPanelTools<T>(params: {
  defaultTools: readonly T[];
  togetherListeningTool: T;
  togetherListeningHandler: (() => void) | undefined;
}): readonly T[] {
  return params.togetherListeningHandler
    ? [...params.defaultTools, params.togetherListeningTool]
    : params.defaultTools;
}
