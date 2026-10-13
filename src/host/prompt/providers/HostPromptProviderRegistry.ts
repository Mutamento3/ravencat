/** 通过目录定义解析 Host 动态 Prompt Provider，避免组装器直接绑定业务实现。 */

import type {
  AssemblePromptPackParams, PromptPackBlock, PromptPackScenario,
} from '@shared/prompt';
import { promptCatalog } from '../catalog';
import { promptPackBlockFactory } from '../PromptPackBlockFactory';
import {
  promptBlockProviderRegistry,
  type PromptBlockProvider,
} from '../compiler/PromptBlockProviderRegistry';

export interface HostPromptProviderContext {
  scenario: PromptPackScenario;
  params: AssemblePromptPackParams;
}

const PROVIDERS: Record<string, PromptBlockProvider<HostPromptProviderContext, PromptPackBlock>> = {
  'protocol.prompt': ({ params }) => promptPackBlockFactory.createProtocolPromptBlock(params.aiConfig.id, params.toolContext),
  'tools.context_explanation': ({ params }) => promptPackBlockFactory.createToolContextBlock(params.toolContext),
  'assistants.agent_registry': ({ params }) => promptPackBlockFactory.createAgentRegistrySummaryBlock(params.aiConfig),
  'assistants.moment_audience_candidates': ({ params }) => promptPackBlockFactory.createMomentAudienceCandidatesBlock(params.aiConfig),
  'moments.social_inbox': ({ params }) => promptPackBlockFactory.createMomentSocialInboxBlock(params.aiConfig, params.toolContext),
  'assistants.nickname': ({ params, scenario }) => promptPackBlockFactory.createAssistantNicknameBlock(
    params.aiConfig.id, params.runtimeContext!.userDisplayName!, scenario === 'chat.private_reply',
  ),
  'chat.group_context': ({ params }) => promptPackBlockFactory.createGroupChatContextBlock(params.runtimeContext || {}),
  'tools.description': ({ params }) => promptPackBlockFactory.createToolsDescriptionBlock(
    params.toolsDescription || '',
    params.mcpServices || [],
  ),
  'memory.passive': ({ params }) => promptPackBlockFactory.createPassiveMemoryBlock({
    currentInput: params.currentInput, aiAssistantId: params.aiConfig.id, runtimeContext: params.runtimeContext,
  }),
};

export const REGISTERED_HOST_PROMPT_PROVIDER_IDS = Object.freeze(Object.keys(PROVIDERS));

export function registerHostPromptProviders(): void {
  for (const [providerId, provider] of Object.entries(PROVIDERS)) {
    if (!promptBlockProviderRegistry.has(providerId)) {
      promptBlockProviderRegistry.register(providerId, provider);
    }
  }
}

export async function renderHostPromptProviderBlock(
  definitionId: string,
  context: HostPromptProviderContext
): Promise<PromptPackBlock> {
  const definition = promptCatalog.getById(definitionId);
  if (!definition?.providerId || definition.contentKind !== 'provider') {
    throw new Error(`提示词定义不是动态 Provider：${definitionId}`);
  }
  registerHostPromptProviders();
  return await promptBlockProviderRegistry.resolve(definition.providerId)(context) as PromptPackBlock;
}
