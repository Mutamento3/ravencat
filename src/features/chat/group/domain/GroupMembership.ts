/** 成员资格、发言权限与退出历史分别保存；退出历史不授予群操作权限。 */
import type { DatabaseReadExecutor, DatabaseTransactionExecutor } from '@platform/persistence';
import type { ChatBackgroundContext } from '../../summary/domain/ChatSummaryRepository';

export type GroupActor = { kind: 'user' } | { kind: 'assistant'; assistantId: string };
export type GroupMemberAction = 'add' | 'join' | 'remove' | 'leave' | 'mute' | 'unmute';
export interface GroupNameMatch { groupId: string; name: string }
export interface GroupHistory {
  id: string;
  assistantId: string;
  groupId: string;
  groupName: string;
  exitedAt: string;
  reason: 'left' | 'removed';
  injectEnabled: boolean;
  context: ChatBackgroundContext;
}
export class GroupMembershipError extends Error {}
export interface GroupMemberChange {
  changed: boolean;
  groupName: string;
  notice: string;
  exitedAssistantIds: string[];
  revokedTaskIds: string[];
}
export interface GroupMembershipRepository {
  searchByName(keyword: string): Promise<GroupNameMatch[]>;
  changeInTransaction(tx: DatabaseTransactionExecutor, actor: GroupActor, groupId: string,
    action: GroupMemberAction, assistantIds: string[], now: string): Promise<GroupMemberChange>;
  renameInTransaction(tx: DatabaseTransactionExecutor, actor: GroupActor, groupId: string, name: string): Promise<string>;
  saveHistoryInTransaction(tx: DatabaseTransactionExecutor, history: GroupHistory): Promise<void>;
  listHistory(assistantId: string): Promise<GroupHistory[]>;
  getHistory(assistantId: string, historyId: string): Promise<GroupHistory>;
  getExitedHistory(assistantId: string, groupId: string, reader?: DatabaseReadExecutor): Promise<GroupHistory>;
  setHistoryInjection(assistantId: string, historyId: string, enabled: boolean): Promise<void>;
}
