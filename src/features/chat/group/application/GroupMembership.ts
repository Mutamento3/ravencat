/** 用户与 AI 共用成员命令；成员事实、退出快照、系统记录与任务撤销原子提交。 */
import { randomUUID } from 'expo-crypto';
import { CoordinatedDatabaseError, databaseCoordinator, type DatabaseTransactionExecutor } from '@platform/persistence';
import { getChatGroupRuntimeDependencies } from './ChatGroupRuntime';
import { getChatMessageRuntimeDependencies } from '../../messages/application/ChatMessageRuntime';
import { emitChatGroupSpeechPlanChanged, emitChatMessagesUpdated } from '../../messages/events/ChatEvents';
import { abortGroupSpeechTasks } from './GroupSpeechExecutionAbort';
import { GroupMembershipError, type GroupActor, type GroupMemberAction } from '../domain/GroupMembership';

const listeners = new Set<(groupId: string) => void>();
export function subscribeGroupChanged(listener: (groupId: string) => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
function changed(groupId: string) {
  emitChatMessagesUpdated(groupId);
  emitChatGroupSpeechPlanChanged(groupId);
  for (const listener of listeners) listener(groupId);
}
async function membershipTransaction<T>(name: string, operation: (tx: DatabaseTransactionExecutor) => Promise<T>): Promise<T> {
  try {
    return await databaseCoordinator.transaction({ name, feature: 'chat', priority: 'interactive' }, operation);
  } catch (error) {
    // 事务层统一包装异常；应用边界恢复自己的业务拒绝，真正的存储故障仍向上传递。
    if (error instanceof CoordinatedDatabaseError && error.cause instanceof GroupMembershipError) throw error.cause;
    throw error;
  }
}
async function recordChange(tx: DatabaseTransactionExecutor, groupId: string, text: string, now: string, sourceRunId?: string) {
  const message = await getChatMessageRuntimeDependencies().messages.commitMessageInTransaction(tx, {
    message: { sessionId: groupId, text, isMe: false, isRead: true, senderType: 'system', status: 'sent',
      turnRunId: sourceRunId ?? null, turnItemIndex: null,
      metadataJson: JSON.stringify({ type: 'groupMembershipChanged', groupChat: { kind: 'system_tip', groupId, actorType: 'system' } }),
      time: new Date(now).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }), createdAt: now, updatedAt: now },
    previewText: text,
  });
  await getChatGroupRuntimeDependencies().groups.updatePreviewInTransaction(tx, groupId, message.id, text, now);
}
export async function changeGroupMembers(groupId: string, action: GroupMemberAction, assistantIds: string[],
  actor: GroupActor = { kind: 'user' }, guard?: (tx: DatabaseTransactionExecutor) => Promise<void>, sourceRunId?: string) {
  const ids = [...new Set(assistantIds)];
  if (ids.length === 0) throw new GroupMembershipError('请选择群成员');
  const runtime = getChatGroupRuntimeDependencies();
  const now = new Date().toISOString();
  const result = await membershipTransaction('chat.change-group-members', async tx => {
    await guard?.(tx);
    const result = await runtime.membership.changeInTransaction(tx, actor, groupId, action, ids, now);
    if (result.exitedAssistantIds.length > 0) {
      const context = await runtime.captureHistory(tx, groupId, result.groupName);
      for (const assistantId of result.exitedAssistantIds) await runtime.membership.saveHistoryInTransaction(tx, {
        id: randomUUID(), assistantId, groupId, groupName: result.groupName, exitedAt: now,
        reason: action === 'leave' ? 'left' : 'removed', injectEnabled: true, context,
      });
    }
    if (result.changed) await recordChange(tx, groupId, result.notice, now, sourceRunId);
    return result;
  });
  abortGroupSpeechTasks(result.revokedTaskIds);
  if (result.changed) changed(groupId);
  return { groupId, message: result.notice };
}
export function searchGroupNames(value: string) {
  const keyword = value.trim();
  if (!keyword || keyword.length > 120) throw new GroupMembershipError('请提供 1～120 个字符的群名关键词');
  return getChatGroupRuntimeDependencies().membership.searchByName(keyword);
}
export async function renameGroupChat(groupId: string, value: string, actor: GroupActor = { kind: 'user' },
  guard?: (tx: DatabaseTransactionExecutor) => Promise<void>, sourceRunId?: string) {
  const name = value.trim();
  if (!name || name.length > 30) throw new GroupMembershipError('群聊名称须为 1～30 个字符');
  const now = new Date().toISOString();
  await membershipTransaction('chat.rename-group', async tx => {
    await guard?.(tx);
    const notice = await getChatGroupRuntimeDependencies().membership.renameInTransaction(tx, actor, groupId, name);
    await recordChange(tx, groupId, notice, now, sourceRunId);
  });
  changed(groupId);
  return { groupId, name };
}
export const listHistoricalGroups = (assistantId: string) => getChatGroupRuntimeDependencies().membership.listHistory(assistantId);
export async function setHistoricalGroupInjection(assistantId: string, historyId: string, enabled: boolean) {
  const runtime = getChatGroupRuntimeDependencies();
  const history = await runtime.membership.getHistory(assistantId, historyId);
  await runtime.membership.setHistoryInjection(assistantId, historyId, enabled);
  for (const listener of listeners) listener(history.groupId);
}
export async function listGroupInviteCandidates(groupId: string) {
  const runtime = getChatGroupRuntimeDependencies();
  const members = await runtime.groups.getMembers(groupId);
  const existing = new Set(members.filter(member => member.enabled).map(member => member.aiAssistantId));
  return (await runtime.assistantDirectory.list()).filter(ai => !existing.has(ai.id) && !ai.isBlocked);
}
