/** Chat 拥有摘要任务；Host 复用聊天静态前缀与同一模型，只提供固定来源。 */
import { aiAssistantRepository } from '@features/assistants';
import { callRepository } from '@features/calls/composition';
import { userProfileRepository } from '@features/profile';
import { protocolRepository } from '@features/protocol';
import { configureChatSummaryRuntime, SQLiteChatSummaryRepository, sessionRepository, createChatSummaryPromptBlock,
  createSecondaryChatSummaryPromptBlock, buildChatSummaryModelInput, type ChatSummaryModelInput,
  type SecondaryChatSummaryClaim, ChatSummaryGenerationError, type ChatSummaryCallDiagnostics,
  type ChatSummaryRequestSettings } from '@features/chat/composition';
import { assembleResolvedSummaryPromptPack } from '@host/prompt';
import { createAIClient } from '@platform/ai';
import { ToolContext } from '@shared/aiTools';
import { configureChatSummaryQueue } from '../runtime/ChatSummaryQueueCoordinator';
import { buildToolsDescription, resolveAllowedToolNames, getRuntimeAllowedToolNamesForAI,
  createAgentToolRegistry, getToolPackageRuntimeBindings, readDirectToolNamesForHostRun } from './agent/createAgentToolRegistry';
import { registerToolPackagesForHostRun } from './agent/ToolPackageExposure';
import { resolveMcpExposure } from './agent/registerMcpToolsForHostRun';
let configured = false;
export function configureChatSummary(): void {
  if (configured) return;
  configured = true;
  configureChatSummaryRuntime({
    repository: new SQLiteChatSummaryRepository((tx, conversationId, boundary) => callRepository.readSummarySources(tx, {
      chatSessionId: conversationId, excludedCallIds: boundary.processedCallIds, after: boundary.historyStartsAfter,
    })),
    async getBatchSize(conversationId) {
      const session = await sessionRepository.getSession(conversationId);
      if (!session) return null;
      const assistant = await aiAssistantRepository.getById(session.aiAssistantId);
      if (!assistant || !assistant.apiKey || !assistant.apiBaseUrl || !assistant.model) return null;
      return assistant.privateContextPrimaryLimit;
    },
    generateAddition: (input, signal, report, settings) => generateSummary(input, signal, report, settings),
    generateSecondary: (input, signal, report, settings) => generateSummary(input, signal, report, settings),
  });
  configureChatSummaryQueue();
}
async function generateSummary(input: ChatSummaryModelInput | SecondaryChatSummaryClaim, signal: AbortSignal,
  report: (diagnostics: ChatSummaryCallDiagnostics) => Promise<void>, settings: ChatSummaryRequestSettings) {
  const session = await sessionRepository.getSession(input.conversationId);
  if (!session) throw new Error('摘要会话已删除');
  const assistant = await aiAssistantRepository.getById(session.aiAssistantId);
  if (!assistant) throw new Error('摘要所属 AI 已删除');
  const controller = new AbortController();
  const forward = () => controller.abort();
  signal.addEventListener('abort', forward, { once: true });
  if (signal.aborted) controller.abort();
  let timedOut = false;
  const startedAt = Date.now();
  const maxTokens = settings.maxOutputTokens ?? assistant.maxTokens;
  const diagnostics: ChatSummaryCallDiagnostics = { model: assistant.model, requestedMaxTokens: maxTokens,
    timeoutSeconds: settings.requestTimeoutSeconds, durationMs: 0, promptTokens: null, completionTokens: null,
    totalTokens: null, cachedTokens: null, finishReason: null, contentCharacters: 0, reasoningCharacters: 0, serverError: null };
  const redact = (text: string) => text.replaceAll(assistant.apiKey!, '[凭据已隐藏]');
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, settings.requestTimeoutSeconds * 1000);
  try {
    const aiConfig = { ...assistant, systemPrompt: assistant.systemPrompt ?? undefined };
    const toolContext = new ToolContext({ aiConfig, sessionId: input.conversationId, triggerSource: 'chat',
      repositories: { protocol: protocolRepository, profile: userProfileRepository, moment: null, ledger: null } });
    const persistentNames = await resolveAllowedToolNames(assistant.id);
    const toolPolicy = { isHostAI: assistant.isHostAI, enableTools: assistant.enableTools, triggerSource: 'chat',
      memoryParticipation: 'read_write' as const, allowedToolNames: persistentNames };
    const allowedToolNames = getRuntimeAllowedToolNamesForAI(toolPolicy);
    const toolsDescription = buildToolsDescription(toolPolicy);
    const mcp = assistant.enableTools ? await resolveMcpExposure(assistant.id) : { services: [] };
    const secondary = 'segments' in input;
    const currentInput = secondary ? JSON.stringify({
      summaries: input.segments.map((segment) => ({ content: segment.content,
        discussionStart: segment.sourceStartAt, discussionEnd: segment.sourceEndAt, timeZone: segment.timeZone })),
    }) : buildChatSummaryModelInput(input, assistant.agentId);
    const pack = await assembleResolvedSummaryPromptPack({ sessionId: input.conversationId, aiConfig, toolContext,
      currentInput, allowedToolNames, toolsDescription, mcpServices: mcp.services },
    secondary ? createSecondaryChatSummaryPromptBlock() : createChatSummaryPromptBlock());
    // 工具目录沿用同一注册与分包规则，只复用稳定说明，不建立 Agent run 或执行工具。
    const registry = createAgentToolRegistry({ createLegacyContext: () => toolContext });
    const packages = registerToolPackagesForHostRun({ registry, allowedToolNames,
      bindings: getToolPackageRuntimeBindings(registry), openPackageIds: [],
      directToolNames: await readDirectToolNamesForHostRun(assistant.id) });
    const slot = pack.toolInstructionsSlot;
    const systemPrompt = slot ? [slot.before, packages.instructions().catalog, slot.after].filter(Boolean).join('\n\n') : pack.systemPrompt;
    const response = await createAIClient({ baseURL: assistant.apiBaseUrl!, apiKey: assistant.apiKey!, model: assistant.model,
      temperature: assistant.temperature, topP: assistant.topP, disableThinking: assistant.disableThinking,
      maxTokens }).chat([
      { role: 'system', content: systemPrompt }, ...pack.modelMessages,
    ], { signal: controller.signal, includeSystemPrompt: false, allowReasoningLengthRetry: false });
    diagnostics.finishReason = response.finishReason ?? null;
    diagnostics.httpStatus = response.httpStatus ?? null;
    diagnostics.contentCharacters = Array.from(response.text).length;
    diagnostics.reasoningCharacters = Array.from(response.reasoningText ?? '').length;
    if (response.success && response.usageReported) {
      diagnostics.promptTokens = response.promptTokens; diagnostics.completionTokens = response.completionTokens;
      diagnostics.totalTokens = response.totalTokens; diagnostics.cachedTokens = response.cachedTokens ?? null;
    }
    if (!response.success) {
      diagnostics.serverError = redact(response.error ?? '服务端未提供错误信息');
      const status = response.httpStatus;
      throw new ChatSummaryGenerationError({ kind: 'request', message: diagnostics.serverError,
        retryable: status == null || status === 408 || status === 429 || status >= 500 });
    }
    if (response.finishReason === 'length') throw new ChatSummaryGenerationError({ kind: 'output_limit',
      message: '模型因输出 token 上限停止，摘要可能被截断。请在摘要设置中提高输出额度后重试。', retryable: false });
    if (!response.text.trim()) throw new ChatSummaryGenerationError({ kind: 'empty_output',
      message: diagnostics.reasoningCharacters > 0 ? '模型只返回思考内容，没有摘要正文。请检查输出额度与模型配置。' : '模型没有返回摘要正文。', retryable: true });
    return response.text;
  } catch (error) {
    if (signal.aborted) throw error;
    if (timedOut) throw new ChatSummaryGenerationError({ kind: 'timeout', message: `摘要请求超过 ${settings.requestTimeoutSeconds} 秒，已中止。`, retryable: true });
    // AIClient 已分类网络失败；提示词读取与装配的本地故障应暴露给其 owner，不能进入模型重试。
    throw error;
  } finally {
    clearTimeout(timer); signal.removeEventListener('abort', forward);
    diagnostics.durationMs = Date.now() - startedAt;
    await report(diagnostics);
  }
}
