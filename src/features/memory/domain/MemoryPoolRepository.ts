/** 共享记忆池（pair pool）的持久化端口，只服务新链路的 pool 解析。 */

export type MemoryPoolScope = 'pair_shared';

export interface PairMemoryPool {
  id: string;
  scope: MemoryPoolScope;
  userProfileId: string;
  aiAssistantId: string;
  createdAt: string;
  updatedAt: string;
}

export interface GetOrCreatePairMemoryPoolInput {
  aiAssistantId: string;
  userProfileId?: string;
}

export interface IMemoryPoolRepository {
  getPoolByAI(aiAssistantId: string, userProfileId?: string): Promise<PairMemoryPool | null>;
  getOrCreatePairPool(input: GetOrCreatePairMemoryPoolInput): Promise<PairMemoryPool>;
}
