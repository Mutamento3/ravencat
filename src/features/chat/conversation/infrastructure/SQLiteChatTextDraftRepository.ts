import { databaseCoordinator } from '@platform/persistence';
import type { ChatTextDraft, ChatTextDraftRepository } from '../domain/ChatTextDraftRepository';

export class SQLiteChatTextDraftRepository implements ChatTextDraftRepository {
  list(): Promise<ChatTextDraft[]> {
    return databaseCoordinator.read({ name: 'chat.textDraft.list', feature: 'chat', priority: 'surface' }, async (db) => {
      const rows = await db.getAllAsync<{ conversation_id: string; text: string }>(
        'SELECT conversation_id, text FROM chat_text_drafts',
      );
      return rows.map(row => ({ conversationId: row.conversation_id, text: row.text }));
    });
  }

  save(drafts: readonly ChatTextDraft[]): Promise<void> {
    return databaseCoordinator.transaction({ name: 'chat.textDraft.save', feature: 'chat', priority: 'interactive' }, async (tx) => {
      for (const draft of drafts) {
        if (draft.text.length === 0) {
          await tx.runAsync('DELETE FROM chat_text_drafts WHERE conversation_id = ?', [draft.conversationId]);
        } else {
          // 延迟保存可能晚于删除会话；不重新创建已删除的身份或孤立草稿。
          await tx.runAsync(`INSERT INTO chat_text_drafts (conversation_id, text)
            SELECT id, ? FROM chat_conversations WHERE id = ?
            ON CONFLICT(conversation_id) DO UPDATE SET text = excluded.text`, [draft.text, draft.conversationId]);
        }
      }
    });
  }
}
