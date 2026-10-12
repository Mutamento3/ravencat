import type { DatabaseWriteExecutor } from '../runtime';
import { STICKERS_SCHEMA, STICKER_EMBEDDINGS_SCHEMA } from './stickerSchema';

/** 重建唯一约束时同时保留引用表，整个升级在调用方事务中原子完成。 */
export async function migrateStickerOwnership(db: DatabaseWriteExecutor): Promise<void> {
  await db.execAsync(STICKERS_SCHEMA.replace('IF NOT EXISTS stickers', 'stickers_owned'));
  const columns = await db.getAllAsync<{ name: string }>('PRAGMA table_info(stickers)');
  const names = columns.map(column => column.name).join(', ');
  await db.execAsync(`INSERT INTO stickers_owned (${names}) SELECT ${names} FROM stickers;`);
  await db.execAsync(STICKER_EMBEDDINGS_SCHEMA
    .replace('IF NOT EXISTS sticker_embeddings', 'sticker_embeddings_owned')
    .replace('REFERENCES stickers(id)', 'REFERENCES stickers_owned(id)'));
  await db.execAsync(`
    INSERT INTO sticker_embeddings_owned SELECT * FROM sticker_embeddings;
    DROP TABLE sticker_embeddings;
    DROP TABLE stickers;
    ALTER TABLE stickers_owned RENAME TO stickers;
    ALTER TABLE sticker_embeddings_owned RENAME TO sticker_embeddings;
  `);
}
