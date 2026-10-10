/** 角色模型输入边界：只转换实际修改字段，不生成整份 AIProfile。 */
import type { AIProfile } from '../../../domain/AIProfile';
import type { AIModelSettingsUpdate } from '../../../domain/AssistantRepository';
import type { DraftCommit, DraftErrors } from '@shared/ui/AutoSaveDraftEditor';
import { readDraftInteger, readDraftNumber } from '@shared/ui/draftValidation';
import {
  DEFAULT_GROUP_CONTEXT_PRIMARY_LIMIT, DEFAULT_GROUP_CONTEXT_SECONDARY_LIMIT,
  DEFAULT_PRIVATE_CONTEXT_PRIMARY_LIMIT, DEFAULT_PRIVATE_CONTEXT_SECONDARY_LIMIT,
} from '@shared/prompt';

export const DEFAULT_MAX_TOKENS = 2000;
export const UNLIMITED_MAX_TOKENS = '无限制';
export interface ContextLimitsDraft {
  privatePrimary: string;
  privateSecondary: string;
  groupPrimary: string;
  groupSecondary: string;
}
export interface ConnectionParams { temperature: number | null; topP: number | null; maxTokens: number | null; disableThinking: boolean }
export function getDefaultContextLimitsDraft(): ContextLimitsDraft {
  return {
    privatePrimary: String(DEFAULT_PRIVATE_CONTEXT_PRIMARY_LIMIT),
    privateSecondary: String(DEFAULT_PRIVATE_CONTEXT_SECONDARY_LIMIT),
    groupPrimary: String(DEFAULT_GROUP_CONTEXT_PRIMARY_LIMIT),
    groupSecondary: String(DEFAULT_GROUP_CONTEXT_SECONDARY_LIMIT),
  };
}
export function getMaxTokensInputValue(value: number | null): string {
  return value === null ? UNLIMITED_MAX_TOKENS : String(value);
}
export interface ModelSettingsDraft extends ContextLimitsDraft {
  apiBaseUrl: string;
  apiKey: string;
  selectedModel: string;
  tempInput: string;
  topPInput: string;
  maxTokens: string;
  enableTools: boolean;
  disableThinking: boolean;
  allowMultipleBubbles: boolean;
}
export function getModelSettingsDraft(ai: AIProfile): ModelSettingsDraft {
  return {
    apiBaseUrl: ai.apiBaseUrl ?? '', apiKey: ai.apiKey ?? '', selectedModel: ai.model,
    tempInput: ai.temperature === null ? '' : String(ai.temperature),
    topPInput: ai.topP === null ? '' : String(ai.topP), maxTokens: getMaxTokensInputValue(ai.maxTokens),
    privatePrimary: String(ai.privateContextPrimaryLimit), privateSecondary: String(ai.privateContextSecondaryLimit),
    groupPrimary: String(ai.groupContextPrimaryLimit), groupSecondary: String(ai.groupContextSecondaryLimit),
    enableTools: ai.enableTools, allowMultipleBubbles: ai.allowMultipleBubbles, disableThinking: ai.disableThinking,
  };
}
export function parseModelSettingsDraft(draft: ModelSettingsDraft, changed: (keyof ModelSettingsDraft)[]): DraftCommit<ModelSettingsDraft, AIModelSettingsUpdate> {
  const patch: AIModelSettingsUpdate = {};
  const accepted: (keyof ModelSettingsDraft)[] = [];
  const errors: DraftErrors<ModelSettingsDraft> = {};
  const numeric = {
    tempInput: { field: 'temperature', label: 'Temperature', min: 0, max: 2 },
    topPInput: { field: 'topP', label: 'Top P', min: 0, max: 1 },
  } as const;
  const contexts = {
    privatePrimary: 'privateContextPrimaryLimit', privateSecondary: 'privateContextSecondaryLimit',
    groupPrimary: 'groupContextPrimaryLimit', groupSecondary: 'groupContextSecondaryLimit',
  } as const;
  for (const key of changed) {
    if (key === 'tempInput' || key === 'topPInput') {
      const spec = numeric[key];
      const parsed = readDraftNumber(draft[key], spec.label, spec.min, spec.max, true);
      if (parsed.error) { errors[key] = parsed.error; continue; }
      patch[spec.field] = parsed.value;
    } else if (key === 'maxTokens') {
      const parsed = draft.maxTokens === UNLIMITED_MAX_TOKENS
        ? { value: null, error: null } : readDraftInteger(draft.maxTokens, 'Max Tokens');
      if (parsed.error) { errors[key] = parsed.error; continue; }
      patch.maxTokens = parsed.value;
    } else if (key in contexts) {
      const field = key as keyof typeof contexts;
      const parsed = readDraftInteger(draft[field], '上下文条数');
      if (parsed.error) { errors[key] = parsed.error; continue; }
      patch[contexts[field]] = parsed.value;
    } else if (key === 'selectedModel') {
      patch.model = draft[key].trim();
    } else if (key === 'apiBaseUrl' || key === 'apiKey') {
      patch[key] = draft[key].trim();
    } else if (key === 'enableTools' || key === 'allowMultipleBubbles' || key === 'disableThinking') {
      patch[key] = draft[key];
    }
    accepted.push(key);
  }
  return { patch, accepted, errors };
}
