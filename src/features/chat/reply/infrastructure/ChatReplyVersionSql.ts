/** 版本快照只复制已提交消息；嵌套 metadata 保持可被 Media 的引用枚举读取。 */
import type { DatabaseReadExecutor, DatabaseTransactionExecutor } from '@platform/persistence';
import type { ChatMessage } from '../../messages/domain/ChatMessage';

export interface ReplyVersionSetRow {
  id: string;
  session_id: string;
  current_run_id: string;
  selected_version_id: string;
  locked: number;
}

type SnapshotMessage = Omit<ChatMessage, 'metadataJson'> & { metadata: unknown };

export function encodeReplyVersion(messages: ChatMessage[]): string {
  return JSON.stringify(messages.map(({ metadataJson, ...message }) => ({
    ...message, metadata: metadataJson ? JSON.parse(metadataJson) : null,
  })));
}

export function decodeReplyVersion(raw: string): ChatMessage[] {
  const snapshot: SnapshotMessage[] = JSON.parse(raw);
  return snapshot.map(({ metadata, ...message }) => ({
    ...message, metadataJson: metadata === null ? null : JSON.stringify(metadata),
  }));
}

export function findReplyVersionSet(db: DatabaseReadExecutor, runId: string): Promise<ReplyVersionSetRow | null> {
  return db.getFirstAsync<ReplyVersionSetRow>(
    'SELECT * FROM chat_reply_version_sets WHERE current_run_id = ?', [runId],
  );
}

export async function saveReplyVersion(
  tx: DatabaseTransactionExecutor, setId: string, versionId: string, messages: ChatMessage[],
): Promise<void> {
  await tx.runAsync(`INSERT INTO chat_reply_versions(id, set_id, created_at, snapshot_json)
    VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET snapshot_json = excluded.snapshot_json`,
  [versionId, setId, messages[0].createdAt, encodeReplyVersion(messages)]);
}

/** 改字只修改当前候选，未采用的版本保持原文。 */
export async function editSelectedReplyVersion(tx: DatabaseTransactionExecutor, message: ChatMessage): Promise<void> {
  if (!message.turnRunId || message.turnItemIndex == null) return;
  const set = await findReplyVersionSet(tx, message.turnRunId);
  if (!set) return;
  const row = await tx.getFirstAsync<{ snapshot_json: string }>(
    'SELECT snapshot_json FROM chat_reply_versions WHERE id = ?', [set.selected_version_id],
  );
  const messages = decodeReplyVersion(row!.snapshot_json);
  const index = messages.findIndex(item => item.turnItemIndex === message.turnItemIndex);
  if (index === -1) throw new Error('当前消息不属于已采用版本，候选快照与时间线不一致');
  messages[index] = message;
  await tx.runAsync('UPDATE chat_reply_versions SET snapshot_json = ? WHERE id = ?',
    [encodeReplyVersion(messages), set.selected_version_id]);
}

/** 用户删除本轮任一消息时也删除候选，不能通过历史把已删除正文复活。 */
export async function deleteReplyVersionsForMessages(tx: DatabaseTransactionExecutor, ids: readonly number[]): Promise<string[]> {
  const placeholders = ids.map(() => '?').join(',');
  const scope = `SELECT v.id FROM chat_reply_version_sets v WHERE v.current_run_id IN
    (SELECT turn_run_id FROM messages WHERE id IN (${placeholders}))`;
  const assets = await tx.getAllAsync<{ asset_id: string }>(`SELECT DISTINCT CAST(tree.value AS TEXT) AS asset_id
    FROM chat_reply_versions, json_tree(snapshot_json) tree WHERE set_id IN (${scope})
    AND tree.type = 'text' AND tree.key IN ('mediaAssetId', 'thumbnailMediaAssetId')
    AND TRIM(CAST(tree.value AS TEXT)) <> ''`, [...ids]);
  await tx.runAsync(`DELETE FROM chat_reply_version_sets WHERE id IN (${scope})`, [...ids]);
  return assets.map(row => row.asset_id);
}
