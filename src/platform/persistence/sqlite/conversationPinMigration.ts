/**
 * 迁移89：为会话列表置顶补独立的「最近置顶时刻」。
 *
 * `is_pinned` 只回答「是否在置顶区」，无法表达「用户刚刚才置顶」。
 * 置顶是列表排序行为，不是消息活动，因此不能用 `last_time = now` 制造一次
 * 并不存在的聊天活跃：
 *   - 置顶：`is_pinned = 1`，`pinned_at = 置顶时刻`
 *   - 取消置顶：`is_pinned = 0`，`pinned_at = NULL`（彻底回到真实消息排序）
 * pinned 区的有效排序时间 = max(真实消息活动时间, pinned_at)，所以刚置顶的会话
 * 立刻浮到置顶区顶部，之后真实新消息仍然可以让别的置顶会话自然反超。
 *
 * 幂等：fresh schema 自带该列（本迁移整体跳过）；legacy 库按列存在性补齐。
 * 既有置顶行不做回填 —— 猜测一个「置顶时刻」等于伪造事实，只有升级后用户
 * 真正执行的置顶才带 `pinned_at`。
 */

import type { DatabaseWriteExecutor } from '../runtime';

async function addColumnIfMissing(
  db: DatabaseWriteExecutor,
  table: 'sessions' | 'group_chats',
): Promise<void> {
  const columns = await db.getAllAsync<{ name: string }>(`PRAGMA table_info('${table}')`);
  if (columns.some((column) => column.name === 'pinned_at')) {
    return;
  }

  await db.execAsync(`ALTER TABLE ${table} ADD COLUMN pinned_at TEXT;`);
}

export async function migrateConversationPinTimestamps(
  db: DatabaseWriteExecutor
): Promise<void> {
  await addColumnIfMissing(db, 'sessions');
  await addColumnIfMissing(db, 'group_chats');
}
