/** pair pool 的持久化 owner：事务内创建或返回唯一 AI×用户空间。 */
import { SELF_USER_ID } from '@shared';
import { randomUUID } from 'expo-crypto';
import { databaseCoordinator } from '@platform/persistence';
import type { GetOrCreatePairMemoryPoolInput, IMemoryPoolRepository, PairMemoryPool } from '../domain/MemoryPoolRepository';
interface MemoryPoolRow {
  id: string; scope: 'pair_shared'; user_profile_id: string; ai_assistant_id: string; created_at: string; updated_at: string;
}
function mapPool(row: MemoryPoolRow): PairMemoryPool {
  return { id: row.id, scope: row.scope, userProfileId: row.user_profile_id, aiAssistantId: row.ai_assistant_id,
    createdAt: row.created_at, updatedAt: row.updated_at };
}
export class SQLiteMemoryRepository implements IMemoryPoolRepository {
  async getPoolByAI(aiAssistantId: string, userProfileId = SELF_USER_ID): Promise<PairMemoryPool | null> {
    const db = databaseCoordinator.openTaskExecutor({ name: 'memory.getPoolByAI', feature: 'memory', priority: 'runtime' });
    const row = await db.getFirstAsync<MemoryPoolRow>('SELECT * FROM memory_pools WHERE ai_assistant_id = ? AND user_profile_id = ?', [aiAssistantId, userProfileId]);
    return row ? mapPool(row) : null;
  }
  async getOrCreatePairPool(input: GetOrCreatePairMemoryPoolInput): Promise<PairMemoryPool> {
    const db = databaseCoordinator.openTaskExecutor({ name: 'memory.resolvePool', feature: 'memory', priority: 'runtime' });
    const userProfileId = input.userProfileId ?? SELF_USER_ID;
    return db.withExclusiveTransactionAsync(async (tx) => {
      const existing = await tx.getFirstAsync<MemoryPoolRow>('SELECT * FROM memory_pools WHERE ai_assistant_id = ? AND user_profile_id = ?', [input.aiAssistantId, userProfileId]);
      if (existing) return mapPool(existing);
      const now = new Date().toISOString();
      const id = 'pool_' + randomUUID();
      await tx.runAsync("INSERT INTO memory_pools (id, scope, user_profile_id, ai_assistant_id, created_at, updated_at) VALUES (?, 'pair_shared', ?, ?, ?, ?)", [id, userProfileId, input.aiAssistantId, now, now]);
      return { id, scope: 'pair_shared', userProfileId, aiAssistantId: input.aiAssistantId, createdAt: now, updatedAt: now };
    });
  }
}
export const memoryRepository = new SQLiteMemoryRepository();
