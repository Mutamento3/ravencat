/** 保持 ChatDetail 注入的 Together Listening capability，不让输入区 wrapper 复活缺失能力。 */

export function resolveTogetherListeningToolPanelHandler(
  capability: (() => Promise<unknown> | unknown) | undefined,
  wrappedHandler: () => void,
): (() => void) | undefined {
  return capability ? wrappedHandler : undefined;
}

/**
 * ChatToolPanel 的入口可见性只反映真实 capability callback：
 * handler 为 undefined 时对应入口不存在，而不是 disabled/no-op。
 */
export function resolveChatToolPanelTools<T>(params: {
  defaultTools: readonly T[];
  videoCallTool: T;
  videoCallHandler: (() => void) | undefined;
  togetherListeningTool: T;
  togetherListeningHandler: (() => void) | undefined;
}): readonly T[] {
  const tools = [...params.defaultTools];
  if (params.videoCallHandler) tools.push(params.videoCallTool);
  if (params.togetherListeningHandler) tools.push(params.togetherListeningTool);
  return tools;
}
