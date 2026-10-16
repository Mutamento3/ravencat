/** 将 Host 聚合的只读目录注入 Prompting Feature。 */

import {
  configurePromptingRuntimeDependencies,
  sqlitePromptingRepository,
  sqlitePromptDefaultsRepository,
} from '@features/prompting/composition';
import { getAssistantDisplayName,
  getHostAICooldownStatus,
  aiAssistantRepository,
  assistantToolPermissionRepository,
} from '@features/assistants';
import {
  listMcpServersWithEnabledToolCounts,
  setMcpServerEnabled,
  type McpServerConfig,
  type McpServerListItemWithEnabledToolCount,
} from '@features/mcpTools';
import { groupChatRepository } from '@features/chat/composition';
import {
  getSystemPromptPreset,
  promptCatalog,
  validateBuiltInPromptArchitecture,
} from '../prompt';
import { promptPreviewService } from '../prompt/preview';
import {
  getToolPermissionDescriptors,
} from './agent';

export function configurePromptingRuntime(): void {
  validateBuiltInPromptArchitecture();
  configurePromptingRuntimeDependencies({
    defaults: sqlitePromptDefaultsRepository,
    catalog: promptCatalog,
    systemPresets: { get: getSystemPromptPreset },
    customBlocks: sqlitePromptingRepository,
    presets: sqlitePromptingRepository,
    bindings: sqlitePromptingRepository,
    assistantPrompts: sqlitePromptingRepository,
    assistants: {
      async listOptions() {
        const { appointment } = await getHostAICooldownStatus();
        return (await aiAssistantRepository.listSummaries()).map((assistant) => ({ id: assistant.id, name: getAssistantDisplayName(assistant), isHostAI: assistant.isHostAI,
          isInHostCooldown: appointment.isInCooldown && appointment.revokedAIId === assistant.id }));
      },
      async list() {
        const { appointment } = await getHostAICooldownStatus();
        return (await aiAssistantRepository.getAll()).map((assistant) => ({
          id: assistant.id,
          name: assistant.name,
          nickname: assistant.nickname,
          model: assistant.model,
          avatar: assistant.avatar || null,
          persona: assistant.systemPrompt || '',
          enableTools: assistant.enableTools === true,
          allowMultipleBubbles: assistant.allowMultipleBubbles,
          isHostAI: assistant.isHostAI,
          isInHostCooldown: appointment.isInCooldown && appointment.revokedAIId === assistant.id,
        }));
      },
    },
    tools: {
      async list() {
        return getToolPermissionDescriptors();
      },
      async listOverrides(assistantId) {
        return (await assistantToolPermissionRepository.list(assistantId)).map((permission) => ({
          toolName: permission.toolName,
          enabled: permission.enabled,
        }));
      },
      async set(assistantId, toolName, enabled) {
        await assistantToolPermissionRepository.set({
          assistantId,
          toolName,
          enabled,
          updatedAt: new Date().toISOString(),
        });
      },
    },
    mcpServices: {
      async list() {
        return (await listMcpServersWithEnabledToolCounts()).map(toPromptMcpServiceSummary);
      },
      async setEnabled(id, enabled) {
        await setMcpServerEnabled(id, enabled);
        const server = (await listMcpServersWithEnabledToolCounts())
          .find((candidate) => candidate.id === id)!;
        return toPromptMcpServiceSummary(server);
      },
    },
    targets: {
      async exists(targetType, targetId) {
        if (targetType === 'assistant') {
          return Boolean(await aiAssistantRepository.getById(targetId));
        }
        if (targetType === 'group') {
          return Boolean(await groupChatRepository.getById(targetId));
        }
        return false;
      },
      async list(targetType) {
        if (targetType === 'assistant') {
          return (await aiAssistantRepository.getAll()).map((assistant) => ({
            id: assistant.id,
            name: getAssistantDisplayName(assistant),
          }));
        }
        return (await groupChatRepository.getAll()).map((group) => ({
          id: group.id,
          name: group.name,
        }));
      },
    },
    preview: promptPreviewService,
  });
}

function toPromptMcpServiceSummary(
  server: McpServerConfig & Pick<McpServerListItemWithEnabledToolCount, 'enabledToolCount'>,
) {
  return {
    id: server.id,
    name: server.name,
    description: server.description,
    enabled: server.enabled,
    connectionStatus: server.connectionStatus,
    enabledToolCount: server.enabledToolCount,
  };
}
