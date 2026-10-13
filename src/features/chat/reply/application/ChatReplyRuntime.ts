/** 组装 Chat 回复运行时的工具上下文、Prompt 包和工具配置，并按触发场景选择 Prompt。 */
import type { IMessageRepository } from '../../messages/domain/MessageRepository';
import type { AIToolsConfig, ToolContext } from '@shared/aiTools';
import { getChatReplyRuntimeDependencies } from './ChatReplyRuntimeDependencies';
import { saveErrorMessage } from './ChatReplyErrors';
import { deriveRuntimeCapabilities } from './ChatReplyMetadata';
import type {
  AIReplyConfig,
  AIReplyRuntimeContext,
  ProcessAIReplyCallbacks,
} from './ChatReplyTypes';
import { DEFAULT_PRIVATE_CONTEXT_PRIMARY_LIMIT } from '@shared/prompt';
import { canUseToolsInRuntimeContext } from './ReplyPolicy';

export function createRuntimeToolContext(
  sessionId: string,
  aiConfig: AIReplyConfig,
  repo: IMessageRepository,
  callbacks: ProcessAIReplyCallbacks,
  runtimeContext: AIReplyRuntimeContext,
  abortSignal: AbortSignal | undefined = runtimeContext.abortSignal,
): ToolContext {
  return getChatReplyRuntimeDependencies().tools.createContext({
    aiConfig,
    sessionId,
    triggerSource: runtimeContext.triggerSource,
    triggerReason: runtimeContext.triggerReason,
    relatedEntityType: runtimeContext.relatedEntityType,
    relatedEntityId: runtimeContext.relatedEntityId,
    capabilities: runtimeContext.capabilities || deriveRuntimeCapabilities(aiConfig, runtimeContext),
    callbacks: {
      onError: (msg: string) =>
        saveErrorMessage(sessionId, msg, repo, callbacks.notifyUI, {
          agentId: aiConfig.agentId,
          displayName: aiConfig.name,
          runtimeContext,
        }),
      notifyUI: callbacks.notifyUI,
    },
    sharedState: runtimeContext,
    abortSignal,
  });
}

export async function assemblePromptPackForRuntimeContext(
  sessionId: string,
  userText: string,
  aiConfig: AIReplyConfig,
  repo: IMessageRepository,
  toolContext: ToolContext,
  runtimeContext: AIReplyRuntimeContext
) {
  const toolsDescription = canUseToolsInRuntimeContext(aiConfig, runtimeContext)
    ? getChatReplyRuntimeDependencies().tools.buildDescription(buildRuntimeAIToolsConfig(aiConfig, runtimeContext))
    : undefined;
  const mcpServices = canUseToolsInRuntimeContext(aiConfig, runtimeContext)
    ? runtimeContext.mcpServices
    : undefined;
  const scenario = resolvePromptPackScenario(runtimeContext.triggerSource);

  const params = {
    sessionId,
    currentInput: userText,
    aiConfig,
    toolContext,
    repository: repo,
    runtimeContext,
    // 主窗口由来源场景决定；自动摘要交接之前，历史owner仍保留未处理原文。
    recentWindowLimit: runtimeContext.recentWindowLimit
      || aiConfig.privateContextPrimaryLimit
      || DEFAULT_PRIVATE_CONTEXT_PRIMARY_LIMIT,
    toolsDescription,
    allowedToolNames: runtimeContext.allowedToolNames || [],
    mcpServices,
    additionalBlocks: runtimeContext.promptBlocks,
  };

  if (scenario === 'ledger') {
    return getChatReplyRuntimeDependencies().prompt.assembleLedger(params);
  }

  return getChatReplyRuntimeDependencies().prompt.assembleChat(params);
}

export function buildRuntimeAIToolsConfig(
  aiConfig: AIReplyConfig,
  runtimeContext: AIReplyRuntimeContext
): AIToolsConfig {
  return {
    isHostAI: aiConfig.isHostAI,
    enableTools: aiConfig.enableTools,
    triggerSource: runtimeContext.triggerSource,
    capabilities: runtimeContext.capabilities,
    memoryParticipation: runtimeContext.memoryParticipation,
    allowedToolNames: runtimeContext.allowedToolNames || [],
    companionScheduleRevision: runtimeContext.companionScheduleRevision,
  };
}

function resolvePromptPackScenario(triggerSource?: string): 'chat' | 'ledger' {
  if (triggerSource === 'ledger') {
    return 'ledger';
  }

  return 'chat';
}
