/** 聚合各 Feature 的内置定义，并提供只读、可校验的提示词目录。 */

import { CALL_PROMPT_DEFINITIONS } from '@features/calls';
import { CHAT_TASK_PROMPT_DEFINITIONS, CHAT_SUMMARY_PROMPT_DEFINITIONS } from '@features/chat/composition';
import { COMPANION_PROMPT_DEFINITIONS } from '@features/companion';
import { TOGETHER_LISTENING_PROMPT_DEFINITIONS } from '@features/togetherListening';
import type { PromptDefinitionDescriptor } from '@shared/prompt';
import { HOST_PROMPT_DEFINITIONS } from './hostPromptDefinitions';

const BUILT_IN_DEFINITIONS: PromptDefinitionDescriptor[] = [
  ...HOST_PROMPT_DEFINITIONS,
  ...CALL_PROMPT_DEFINITIONS,
  ...CHAT_TASK_PROMPT_DEFINITIONS,
  ...CHAT_SUMMARY_PROMPT_DEFINITIONS,
  ...COMPANION_PROMPT_DEFINITIONS,
  ...TOGETHER_LISTENING_PROMPT_DEFINITIONS,
];

export class PromptCatalog {
  private readonly definitions: readonly PromptDefinitionDescriptor[];
  private readonly definitionsById: ReadonlyMap<string, PromptDefinitionDescriptor>;

  constructor(definitions: PromptDefinitionDescriptor[]) {
    const definitionsById = new Map<string, PromptDefinitionDescriptor>();
    definitions.forEach((definition) => {
      if (definitionsById.has(definition.id)) {
        throw new Error(`提示词定义 ID 重复：${definition.id}`);
      }
      if (definition.contentKind === 'provider' && !definition.providerId) {
        throw new Error(`动态提示词定义缺少 providerId：${definition.id}`);
      }
      definitionsById.set(definition.id, definition);
    });
    this.definitions = Object.freeze([...definitions].sort((left, right) => (
      left.owner.localeCompare(right.owner) || left.id.localeCompare(right.id)
    )));
    this.definitionsById = definitionsById;
  }

  list(): readonly PromptDefinitionDescriptor[] {
    return this.definitions;
  }

  getById(definitionId: string): PromptDefinitionDescriptor | null {
    return this.definitionsById.get(definitionId) || null;
  }
}

export const promptCatalog = new PromptCatalog(BUILT_IN_DEFINITIONS);
