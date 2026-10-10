/** Phase 3B 群聊结构化 mention metadata 迁移。 */

import type { DatabaseWriteExecutor } from '../runtime';

interface MessageMetadataRow {
  id: number;
  metadata_json: string;
}

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function migrateMention(value: unknown): { value: unknown; changed: boolean } {
  if (
    !isRecord(value) ||
    typeof value.aiAssistantId !== 'string' ||
    value.aiAssistantId.trim().length === 0 ||
    typeof value.displayNameAtSend !== 'string' ||
    value.displayNameAtSend.trim().length === 0
  ) {
    return { value, changed: false };
  }

  return {
    value: {
      actorType: 'user',
      target: {
        targetType: 'assistant',
        assistantId: value.aiAssistantId,
        displayNameAtSend: value.displayNameAtSend,
      },
    },
    changed: true,
  };
}

/**
 * 把 Phase 3A 之前的用户 @ 快照升级为带 actor/target 类型的事实。
 * 无关或无法解析的 metadata 保持原样，运行时只消费新契约。
 */
export async function migrateGroupMentionMetadata(
  db: DatabaseWriteExecutor
): Promise<void> {
  await db.execAsync('BEGIN;');
  try {
    const rows = await db.getAllAsync<MessageMetadataRow>(
      `SELECT id, metadata_json
       FROM messages
       WHERE metadata_json IS NOT NULL
         AND metadata_json LIKE '%"aiAssistantId"%'`
    );

    let updatedCount = 0;
    for (const row of rows) {
      let metadata: unknown;
      try {
        metadata = JSON.parse(row.metadata_json);
      } catch {
        continue;
      }
      if (!isRecord(metadata) || !isRecord(metadata.groupChat)) {
        continue;
      }

      const mentions = metadata.groupChat.mentions;
      if (!Array.isArray(mentions)) {
        continue;
      }

      let changed = false;
      const migratedMentions = mentions.map((mention) => {
        const migrated = migrateMention(mention);
        changed ||= migrated.changed;
        return migrated.value;
      });
      if (!changed) {
        continue;
      }

      const migratedMetadata = {
        ...metadata,
        groupChat: {
          ...metadata.groupChat,
          mentions: migratedMentions,
        },
      };
      await db.runAsync(
        `UPDATE messages SET metadata_json = ? WHERE id = ?`,
        [JSON.stringify(migratedMetadata), row.id]
      );
      updatedCount += 1;
    }

    if (updatedCount > 0) {
      console.info(
        `[persistence:sqlite.bootstrap] 迁移60：已升级 ${updatedCount} 条群聊消息的 mention metadata`
      );
    }
    await db.execAsync('COMMIT;');
  } catch (error) {
    try {
      await db.execAsync('ROLLBACK;');
    } catch {
      // 事务可能尚未成功开始，保留原始迁移错误。
    }
    throw error;
  }
}
