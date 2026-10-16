/** 旧昵称审计转换为原时刻的 Chat 操作事件，已清除范围不复活。 */
import type { DatabaseWriteExecutor } from '../runtime';

export async function migrateAssistantNicknameHistory(db: DatabaseWriteExecutor, previousVersion: number): Promise<void> {
  if (previousVersion >= 125) {
    await db.execAsync(`
      INSERT INTO messages (session_id, text, is_me, sender_type, client_message_id,
        status, delivery_status, is_read, time, created_at, updated_at, metadata_json)
      SELECT s.id,
        '用户将你的昵称备注从' || CASE WHEN n.previous_nickname IS NULL THEN '未设置昵称' ELSE json_quote(n.previous_nickname) END ||
        '修改为' || CASE WHEN n.nickname IS NULL THEN '未设置昵称' ELSE json_quote(n.nickname) END || '。',
        0, 'system', 'assistant-nickname:legacy:' || n.id, 'sent', 'delivered', 1,
        substr(n.created_at, 12, 5), n.created_at, n.created_at,
        json_object('type', 'assistantNicknameChanged', 'source', 'assistants',
          'previousNickname', n.previous_nickname, 'nickname', n.nickname)
      FROM assistant_nickname_changes n
      JOIN sessions s ON s.ai_assistant_id = n.assistant_id
      WHERE s.visible_after_at IS NULL OR n.created_at > s.visible_after_at
      ORDER BY n.created_at, n.id;
    `);
  }
  await db.execAsync('DROP TABLE IF EXISTS assistant_nickname_changes;');
}
