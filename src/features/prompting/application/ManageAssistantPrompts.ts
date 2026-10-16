/** 管理每 AI 的语言、内置覆盖和用户提示词，并为 Host 解析本轮有效配置。 */

import type { PromptScenarioId } from '@shared/prompt';
import type {
  AssistantPromptDefinitionOverride,
  AssistantPromptDefinitionState,
  AssistantPromptSettings,
  AssistantUserPrompt,
  PromptLanguageMode,
  PromptMigrationOrphan,
  UserPromptCondition,
} from '../domain/Prompting';
import {
  getPromptingRuntimeDependencies,
  type PromptAssistantSummary,
} from './PromptingRuntimeDependencies';

export interface AssistantPromptEditorDetails {
  directToolNames: string[];
  timeEnabled: boolean;
  batteryEnabled: boolean;
  settings: AssistantPromptSettings;
  states: AssistantPromptDefinitionState[];
  overrides: AssistantPromptDefinitionOverride[];
  userPrompts: AssistantUserPrompt[];
  tools: {
    name: string;
    description: string;
    enabled: boolean;
    mutating: boolean;
    callOnly: boolean;
  }[];
}

export interface AssistantPromptEditorSnapshot extends AssistantPromptEditorDetails {
  assistants: PromptAssistantSummary[];
}

export interface AssistantPromptAdvancedSnapshot {
  migrationOrphans: PromptMigrationOrphan[];
}

export interface ResolvedAssistantPromptConfiguration {
  timeEnabled: boolean;
  batteryEnabled: boolean;
  overrides: Record<string, string>;
  disabledDefinitionIds: string[];
  userPrompts: AssistantUserPrompt[];
}

/**
 * 内置 Prompt 固定中文后，覆盖正文按这一 locale 行读取。
 *
 * `assistant_prompt_definition_overrides.locale` 仍是可写列（历史行可能是 en-US），
 * 运行时只消费 zh-CN 行；历史上误存的英文覆盖不会生效，也不需要迁移。
 */
const RESOLVED_PROMPT_LOCALE = 'zh-CN';

export async function getInitialAssistantPromptEditorSnapshot(): Promise<AssistantPromptEditorSnapshot | null> {
  const assistants = await getPromptingRuntimeDependencies().assistants.list();
  const firstAssistant = assistants[0];
  if (!firstAssistant) return null;
  return {
    assistants,
    ...await getAssistantPromptEditorDetails(firstAssistant.id),
  };
}

export async function getAssistantPromptEditorDetails(
  assistantId: string
): Promise<AssistantPromptEditorDetails> {
  const dependencies = getPromptingRuntimeDependencies();
  const [storedSettings, states, overrides, userPrompts, tools, directToolNames] = await Promise.all([
    dependencies.assistantPrompts.getAssistantSettings(assistantId),
    dependencies.assistantPrompts.listDefinitionStates(assistantId),
    dependencies.assistantPrompts.listDefinitionOverrides(assistantId),
    dependencies.assistantPrompts.listAssistantUserPrompts(assistantId),
    getAssistantToolPermissions(assistantId),
    dependencies.assistantPrompts.listDirectToolNames(assistantId),
  ]);
  const now = new Date().toISOString();
  const settings = storedSettings ?? {
    assistantId,
    languageMode: 'system' as const,
    createdAt: now,
    updatedAt: now,
  };
  return {
    directToolNames,
    settings,
    timeEnabled: states.find((state) => state.definitionId === 'context.time_awareness')?.enabled ?? true,
    batteryEnabled: states.find((state) => state.definitionId === 'context.device_battery')?.enabled ?? true,
    states,
    overrides,
    userPrompts: [...userPrompts].sort((left, right) => left.sortOrder - right.sortOrder || left.id.localeCompare(right.id)),
    tools,
  };
}

/** 手机目录与编辑器共用单项权限解析，不读取 AI 专属提示词。 */
export async function getAssistantToolPermissions(assistantId: string): Promise<AssistantPromptEditorDetails['tools']> {
  const dependencies = getPromptingRuntimeDependencies();
  const [definitions, overrides, defaults] = await Promise.all([
    dependencies.tools.list(), dependencies.tools.listOverrides(assistantId), dependencies.defaults.read(),
  ]);
  const overrideByName = new Map(overrides.map((override) => [override.toolName, override.enabled]));
  return definitions.map((definition) => ({
    ...definition,
    enabled: overrideByName.get(definition.name) ?? defaults.toolPermissions[definition.name] ?? definition.defaultEnabled,
  }));
}

export async function getAssistantPromptAdvancedSnapshot(): Promise<AssistantPromptAdvancedSnapshot> {
  const dependencies = getPromptingRuntimeDependencies();
  const migrationOrphans = await dependencies.assistantPrompts.listMigrationOrphans();
  return {
    migrationOrphans,
  };
}

export async function resolveAssistantPromptConfiguration(params: {
  assistantId: string;
  scenarioId: PromptScenarioId;
  hasImage?: boolean;
  toolsEnabled?: boolean;
}): Promise<ResolvedAssistantPromptConfiguration> {
  const repository = getPromptingRuntimeDependencies().assistantPrompts;
  const [states, overrides, userPrompts, defaults] = await Promise.all([
    repository.listDefinitionStates(params.assistantId),
    repository.listDefinitionOverrides(params.assistantId),
    repository.listAssistantUserPrompts(params.assistantId),
    getPromptingRuntimeDependencies().defaults.read(),
  ]);
  return {
    timeEnabled: states.find((state) => state.definitionId === 'context.time_awareness')?.enabled ?? true,
    batteryEnabled: states.find((state) => state.definitionId === 'context.device_battery')?.enabled ?? true,
    overrides: { ...defaults.overrides, ...Object.fromEntries(
      overrides
        .filter((override) => override.locale === RESOLVED_PROMPT_LOCALE)
        .map((override) => [override.definitionId, override.content])
    ) },
    disabledDefinitionIds: states.filter((state) => !state.enabled).map((state) => state.definitionId),
    userPrompts: [
      ...defaults.userPrompts.filter((prompt) => prompt.enabled).map((prompt): AssistantUserPrompt => ({
        ...prompt, id: `default:${prompt.id}`, assistantId: params.assistantId,
        condition: 'always', createdAt: '', updatedAt: '',
      })),
      ...userPrompts.filter((prompt) => prompt.enabled && conditionMatches(prompt.condition, params))
        .sort((left, right) => left.sortOrder - right.sortOrder || left.id.localeCompare(right.id)),
    ],
  };
}

export function setAssistantPromptLanguage(
  assistantId: string,
  languageMode: PromptLanguageMode
): Promise<AssistantPromptSettings> {
  return getPromptingRuntimeDependencies().assistantPrompts
    .saveAssistantLanguageMode(assistantId, languageMode);
}

export function saveAssistantDefinitionState(params: {
  assistantId: string;
  definitionId: string;
  enabled: boolean;
  sortOrder?: number | null;
}): Promise<AssistantPromptDefinitionState> {
  const definition = getPromptingRuntimeDependencies().catalog.getById(params.definitionId);
  if (!definition) throw new Error('提示词定义不存在');
  if (!params.enabled && definition.protection === 'locked') {
    throw new Error('聊天功能必需项不能关闭');
  }
  return getPromptingRuntimeDependencies().assistantPrompts.saveDefinitionState({
    assistantId: params.assistantId,
    definitionId: params.definitionId,
    enabled: params.enabled,
    sortOrder: params.sortOrder ?? null,
    updatedAt: new Date().toISOString(),
  });
}

export function saveAssistantDefinitionOverride(params: {
  assistantId: string;
  definitionId: string;
  /** 内置正文只维护中文；覆盖行固定写在 zh-CN 列，与运行时读取保持一致。 */
  locale: 'zh-CN';
  content: string;
}): Promise<AssistantPromptDefinitionOverride> {
  const definition = getPromptingRuntimeDependencies().catalog.getById(params.definitionId);
  if (!definition?.defaultContent) throw new Error('该内置提示词不支持正文覆盖');
  if (!params.content.trim()) throw new Error('提示词正文不能为空');
  return getPromptingRuntimeDependencies().assistantPrompts.saveDefinitionOverride({
    ...params,
    updatedAt: new Date().toISOString(),
  });
}

export function resetAssistantDefinitionOverride(params: {
  assistantId: string;
  definitionId: string;
  locale: 'zh-CN';
}): Promise<boolean> {
  return getPromptingRuntimeDependencies().assistantPrompts.resetDefinitionOverride(
    params.assistantId,
    params.definitionId,
    params.locale
  );
}

export async function createAssistantUserPrompt(params: {
  assistantId: string;
  name: string;
  content: string;
  condition: UserPromptCondition;
  enabled: boolean;
  sortOrder: number;
}): Promise<AssistantUserPrompt> {
  const repository = getPromptingRuntimeDependencies().assistantPrompts;
  const now = new Date().toISOString();
  const prompt: AssistantUserPrompt = {
    id: `user_prompt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    assistantId: params.assistantId,
    name: params.name.trim() || '自定义提示词',
    content: params.content,
    condition: params.condition,
    enabled: params.enabled,
    sortOrder: params.sortOrder,
    createdAt: now,
    updatedAt: now,
  };
  assertUserPromptContent(prompt.content);
  return repository.saveAssistantUserPrompt(prompt);
}

export function updateAssistantUserPrompt(
  prompt: AssistantUserPrompt
): Promise<AssistantUserPrompt> {
  assertUserPromptContent(prompt.content);
  return getPromptingRuntimeDependencies().assistantPrompts.saveAssistantUserPrompt({
    ...prompt,
    name: prompt.name.trim() || '自定义提示词',
    updatedAt: new Date().toISOString(),
  });
}

export function reorderAssistantUserPrompts(
  first: AssistantUserPrompt,
  second: AssistantUserPrompt
): Promise<AssistantUserPrompt[]> {
  if (first.assistantId !== second.assistantId) {
    throw new Error('只能调整同一 AI 的提示词顺序');
  }
  const updatedAt = new Date().toISOString();
  return getPromptingRuntimeDependencies().assistantPrompts.saveAssistantUserPrompts([
    { ...first, sortOrder: second.sortOrder, updatedAt },
    { ...second, sortOrder: first.sortOrder, updatedAt },
  ]);
}

export function deleteAssistantUserPrompt(id: string, assistantId: string): Promise<boolean> {
  return getPromptingRuntimeDependencies().assistantPrompts.deleteAssistantUserPrompt(id, assistantId);
}

export async function setAssistantToolPermission(
  assistantId: string,
  toolName: string,
  enabled: boolean
): Promise<void> {
  await assertAssistantToolEditable(assistantId, toolName);
  await getPromptingRuntimeDependencies().tools.set(assistantId, toolName, enabled);
}

/** 星标只决定 schema 是否常驻，不授予调用权限。 */
export async function setAssistantDirectToolExposure(
  assistantId: string,
  toolName: string,
  exposed: boolean
): Promise<void> {
  await assertAssistantToolEditable(assistantId, toolName);
  await getPromptingRuntimeDependencies().assistantPrompts.setDirectToolExposure(assistantId, toolName, exposed);
}

/** 全局应用是一次普通工具星标快照，不改写主理专属偏好或调用权限。 */
export async function applyAssistantDirectToolsGlobally(directToolNames: readonly string[]): Promise<void> {
  const dependencies = getPromptingRuntimeDependencies();
  const [tools, assistants] = await Promise.all([dependencies.tools.list(), dependencies.assistants.listOptions()]);
  const selectedNames = new Set(directToolNames);
  const toolNames = tools.filter((tool) => !tool.hostOnly).map((tool) => tool.name);
  await dependencies.assistantPrompts.applyDirectToolSnapshot(
    assistants.map((assistant) => assistant.id),
    toolNames,
    toolNames.filter((name) => selectedNames.has(name))
  );
}

async function assertAssistantToolEditable(assistantId: string, toolName: string): Promise<void> {
  const dependencies = getPromptingRuntimeDependencies();
  const tool = (await dependencies.tools.list()).find((item) => item.name === toolName);
  if (!tool) throw new Error('工具不存在或不在提示词中心管理');
  if (tool.hostOnly) {
    const assistant = (await dependencies.assistants.listOptions()).find((item) => item.id === assistantId);
    if (tool.cooldownOnly ? !assistant?.isInHostCooldown : !assistant?.isHostAI) {
      throw new Error(tool.cooldownOnly ? '只有冷静期中的原主理 AI 可以配置此工具' : '只有主理 AI 可以修改主理专属工具');
    }
  }
}

export function listAssistantDirectToolNames(assistantId: string): Promise<string[]> {
  return getPromptingRuntimeDependencies().assistantPrompts.listDirectToolNames(assistantId);
}

function conditionMatches(
  condition: string,
  params: { scenarioId: PromptScenarioId; hasImage?: boolean; toolsEnabled?: boolean }
): boolean {
  if (condition === 'always') return true;
  if (condition === 'private_chat') return params.scenarioId === 'chat.private_reply';
  if (condition === 'group_chat') return params.scenarioId === 'chat.group_member_reply';
  if (condition === 'call') return params.scenarioId === 'call.live_reply';
  if (condition === 'image_present') return params.hasImage === true;
  if (condition === 'tools_enabled') return params.toolsEnabled === true;
  // 运行时遗留或已退役的 condition（例如 moments）一律不匹配，
  // 不再落到末尾的 tools_enabled 兜底。
  return false;
}

function assertUserPromptContent(content: string): void {
  if (!content.trim()) throw new Error('提示词正文不能为空');
}
