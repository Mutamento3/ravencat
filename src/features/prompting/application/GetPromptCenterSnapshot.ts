/** 构建不读取真实聊天、记忆或协议正文的提示词中心只读快照。 */

import type { PromptDefinitionDescriptor, PromptScenarioId } from '@shared/prompt';
import { getPromptingRuntimeDependencies } from './PromptingRuntimeDependencies';

export interface PromptUserDataSourceSummary {
  id: 'assistant_persona' | 'group_admin_prompt' | 'protocol_space';
  name: string;
  description: string;
  storageMeaning: string;
}

export interface PromptCenterSnapshot {
  definitions: readonly PromptDefinitionDescriptor[];
  owners: string[];
  scenarios: PromptScenarioId[];
  lockedCount: number;
  providerCount: number;
  legacyCount: number;
  userDataSources: PromptUserDataSourceSummary[];
}

const USER_DATA_SOURCES: PromptUserDataSourceSummary[] = [
  {
    id: 'assistant_persona',
    name: 'AI 角色设定',
    description: '每位 AI 的关系、性格和表达习惯；统一在提示词中心编辑。',
    storageMeaning: 'ai_assistants.system_prompt，领域语义为 persona',
  },
  {
    id: 'group_admin_prompt',
    name: '群聊管理员提示词',
    description: '只影响群聊发言成员调度，不属于成员 AI 的聊天人设。',
    storageMeaning: 'group_chat_admin_configs.system_prompt',
  },
  {
    id: 'protocol_space',
    name: '协议空间',
    description: '用户与 AI 均可修改的固定注入信息；全部条目作为常驻提示词生效，直到修改或删除。',
    storageMeaning: 'protocols，按 AI 保存的常驻提示词',
  },
];

export function getPromptCenterSnapshot(): PromptCenterSnapshot {
  const definitions = getPromptingRuntimeDependencies().catalog.list();
  return {
    definitions,
    owners: [...new Set(definitions.map((definition) => definition.owner))].sort(),
    scenarios: [...new Set(definitions.flatMap((definition) => definition.supportedScenarios))].sort(),
    lockedCount: definitions.filter((definition) => definition.protection === 'locked').length,
    providerCount: definitions.filter((definition) => definition.contentKind === 'provider').length,
    legacyCount: definitions.filter((definition) => definition.status === 'legacy').length,
    userDataSources: USER_DATA_SOURCES,
  };
}

export function getPromptDefinitionDetails(
  definitionId: string
): PromptDefinitionDescriptor | null {
  return getPromptingRuntimeDependencies().catalog.getById(definitionId);
}
