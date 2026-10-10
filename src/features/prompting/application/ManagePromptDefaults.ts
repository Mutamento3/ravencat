/** 默认配置由 Prompting 管理，Host 消费同一配置，页面不保存另一套状态。 */
import type { DefaultUserPrompt } from '../domain/PromptDefaults';
import { getPromptingRuntimeDependencies } from './PromptingRuntimeDependencies';

export function readPromptDefaults() {
  return getPromptingRuntimeDependencies().defaults.read();
}

export async function getDefaultPromptEditor() {
  const dependencies = getPromptingRuntimeDependencies();
  const [defaults, tools] = await Promise.all([dependencies.defaults.read(), dependencies.tools.list()]);
  return {
    ...defaults,
    tools: tools.map((tool) => ({ ...tool, enabled: defaults.toolPermissions[tool.name] ?? tool.defaultEnabled })),
  };
}

export function saveDefaultDefinition(definitionId: string, content: string) {
  const dependencies = getPromptingRuntimeDependencies();
  if (!dependencies.catalog.getById(definitionId)?.defaultContent) throw new Error('该条目没有可编辑的默认正文');
  if (!content.trim()) throw new Error('提示词正文不能为空');
  return dependencies.defaults.saveOverride(definitionId, content);
}

export function resetDefaultDefinition(definitionId: string) {
  return getPromptingRuntimeDependencies().defaults.resetOverride(definitionId);
}

export function saveDefaultUserPrompt(prompt: DefaultUserPrompt) {
  if (!prompt.content.trim()) throw new Error('提示词正文不能为空');
  return getPromptingRuntimeDependencies().defaults.saveUserPrompt({ ...prompt, name: prompt.name.trim() || '自定义提示词' });
}

export function deleteDefaultUserPrompt(id: string) {
  return getPromptingRuntimeDependencies().defaults.deleteUserPrompt(id);
}

export function moveDefaultUserPrompt(first: DefaultUserPrompt, second: DefaultUserPrompt) {
  return getPromptingRuntimeDependencies().defaults.reorderUserPrompts(first, second);
}

export function setDefaultPromptSwitch(key: string, enabled: boolean) {
  if (!key.startsWith('tool:')) throw new Error('未知默认开关');
  return getPromptingRuntimeDependencies().defaults.setEnabled(key, enabled);
}

export function listPromptAssistantOptions() {
  return getPromptingRuntimeDependencies().assistants.listOptions();
}

export async function getPromptAssistant(assistantId: string) {
  const assistant = (await getPromptingRuntimeDependencies().assistants.list()).find((item) => item.id === assistantId);
  if (!assistant) throw new Error('AI 不存在');
  return assistant;
}
