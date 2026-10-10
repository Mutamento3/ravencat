/** 用户与工具共用的正文输入边界；pool 由已授权的 AI 身份解析。 */
import { randomUUID } from 'expo-crypto';
import { ACTIVE_RECALL_PAGE_SIZE_OPTIONS, PASSIVE_RECALL_LIMIT_OPTIONS, MemoryInputError, normalizeMemoryText, requireMemoryContent, requireMemorySummary, type MemoryRecallSettings } from '../domain/Memory';
import type { CreateMemoryRecord } from '../domain/MemoryRepository';
import { getMemoryRuntimeDependencies } from './MemoryRuntimeDependencies';
import { emitMemoryChanged } from './MemorySignals';

/** 用户、工具与 Host 的跨 Feature 转存复用同一输入边界。 */
export function prepareMemoryRecord(poolId: string, value: string, summaryValue: string | null, writeKey: string | null): CreateMemoryRecord {
  const content = requireMemoryContent(value);
  const summary = requireMemorySummary(summaryValue);
  return { id: randomUUID(), poolId, content, summary, normalizedContent: normalizeMemoryText(content),
    now: new Date().toISOString(), writeKey };
}

export async function rememberMemory(assistantId: string, value: string, writeKey: string | null = null, summaryValue: string | null = null) {
  const runtime = getMemoryRuntimeDependencies();
  const space = await runtime.resolveMemorySpace(assistantId);
  const entry = await runtime.repository.createEntry(prepareMemoryRecord(space.poolId, value, summaryValue, writeKey));
  emitMemoryChanged();
  return entry;
}
export async function editMemory(assistantId: string, memoryId: string, value: string, summaryValue?: string | null) {
  const content = requireMemoryContent(value);
  const summary = summaryValue === undefined ? undefined : requireMemorySummary(summaryValue);
  const runtime = getMemoryRuntimeDependencies();
  const space = await runtime.resolveMemorySpace(assistantId);
  const entry = await runtime.repository.updateEntry(space.poolId, memoryId, content, normalizeMemoryText(content), new Date().toISOString(), summary);
  emitMemoryChanged();
  return entry;
}
export async function forgetMemory(assistantId: string, memoryId: string) {
  const runtime = getMemoryRuntimeDependencies();
  const space = await runtime.resolveMemorySpace(assistantId);
  const deleted = await runtime.repository.deleteEntry(space.poolId, memoryId);
  emitMemoryChanged();
  return deleted;
}
export async function retryMemoryEmbedding(assistantId: string, memoryId: string) {
  const runtime = getMemoryRuntimeDependencies();
  const space = await runtime.resolveMemorySpace(assistantId);
  await runtime.repository.retryEmbedding(space.poolId, memoryId);
  emitMemoryChanged();
}
export async function selectMemorySpace(assistantId: string) {
  const runtime = getMemoryRuntimeDependencies();
  await runtime.resolveMemorySpace(assistantId);
  await runtime.repository.setPreferredAssistantId(assistantId);
  emitMemoryChanged();
}
export async function setMemoryRecallSettings(assistantId: string, settings: MemoryRecallSettings) {
  if (!(PASSIVE_RECALL_LIMIT_OPTIONS as readonly number[]).includes(settings.passiveLimit)
    || !(ACTIVE_RECALL_PAGE_SIZE_OPTIONS as readonly number[]).includes(settings.activePageSize)) {
    throw new MemoryInputError('请选择提供的召回数量');
  }
  const runtime = getMemoryRuntimeDependencies();
  const space = await runtime.resolveMemorySpace(assistantId);
  await runtime.repository.setRecallSettings(space.poolId, settings);
  emitMemoryChanged();
}
/** 用户可批量配置触发词，并显式绑定正文中没有这些词的记忆。 */
export async function addMemoryTrigger(assistantId: string, value: string, memoryId?: string) {
  const keywords = new Map<string, string>();
  for (const item of value.split(/[,，、;；\r\n]+/)) {
    const keyword = item.trim();
    const normalized = normalizeMemoryText(keyword);
    if (normalized && !keywords.has(normalized)) keywords.set(normalized, keyword);
  }
  if (keywords.size === 0) throw new MemoryInputError('触发词不能为空');
  const runtime = getMemoryRuntimeDependencies();
  const space = await runtime.resolveMemorySpace(assistantId);
  await runtime.repository.createTriggers(space.poolId, Array.from(keywords, ([normalizedKeyword, keyword]) => ({
    id: randomUUID(), keyword, normalizedKeyword,
  })), memoryId);
  emitMemoryChanged();
}
export async function deleteMemoryTrigger(assistantId: string, triggerId: string) {
  const runtime = getMemoryRuntimeDependencies();
  const space = await runtime.resolveMemorySpace(assistantId);
  await runtime.repository.deleteTrigger(space.poolId, triggerId);
  emitMemoryChanged();
}
export async function setMemoryAutoRecall(assistantId: string, triggerId: string, memoryId: string, enabled: boolean) {
  const runtime = getMemoryRuntimeDependencies();
  const space = await runtime.resolveMemorySpace(assistantId);
  await runtime.repository.setAutoRecall(space.poolId, triggerId, memoryId, enabled);
  emitMemoryChanged();
}
