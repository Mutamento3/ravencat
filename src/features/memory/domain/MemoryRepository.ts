/** Memory 持久化 port：pool 授权与向量任务的原子比较由 Repository 拥有。 */

import type { MemoryEntry, MemoryRecallSettings, MemoryTriggerKeyword, PassiveTriggerGroup, PassiveTriggerMemory } from './Memory';

export interface MemoryEmbeddingModel {
  id: string;
  name: string;
  fingerprint: string;
  baseURL: string;
  apiKey: string;
  model: string;
  metadataJson: string | null;
}

export interface MemoryVector {
  memoryId: string;
  vector: number[];
}

export interface MemoryEmbeddingClaim {
  memoryId: string;
  content: string;
  summary: string | null;
  contentRevision: number;
  modelFingerprint: string;
  claimId: string;
  attempts: number;
}

export interface CreateMemoryRecord {
  id: string;
  poolId: string;
  content: string;
  summary: string | null;
  normalizedContent: string;
  now: string;
  writeKey: string | null;
}

export interface MemoryRepository {
  getEmbeddingModelId(): Promise<string | null>;
  setEmbeddingModelId(modelConfigId: string | null): Promise<void>;
  listEntries(poolId: string): Promise<MemoryEntry[]>;
  getEntry(poolId: string, memoryId: string): Promise<MemoryEntry | null>;
  createEntry(input: CreateMemoryRecord): Promise<MemoryEntry>;
  updateEntry(poolId: string, memoryId: string, content: string, normalizedContent: string, now: string, summary?: string | null): Promise<MemoryEntry>;
  deleteEntry(poolId: string, memoryId: string): Promise<boolean>;
  getPreferredAssistantId(): Promise<string | null>;
  setPreferredAssistantId(assistantId: string): Promise<void>;
  getRecallSettings(poolId: string): Promise<MemoryRecallSettings>;
  setRecallSettings(poolId: string, settings: MemoryRecallSettings): Promise<void>;
  listTriggers(poolId: string): Promise<PassiveTriggerGroup[]>;
  createTriggerGroup(poolId: string, groupId: string, keywords: MemoryTriggerKeyword[], memoryIds: string[], autoAssociate: boolean): Promise<void>;
  updateTriggerGroup(poolId: string, groupId: string, keywords: MemoryTriggerKeyword[], autoAssociate: boolean): Promise<void>;
  deleteTrigger(poolId: string, triggerId: string): Promise<void>;
  listTriggerMemories(poolId: string, triggerId: string): Promise<PassiveTriggerMemory[]>;
  setAutoRecall(poolId: string, triggerId: string, memoryId: string, enabled: boolean): Promise<void>;
  recallPassive(poolId: string, normalizedInput: string): Promise<MemoryEntry[]>;
  syncEmbeddingModel(model: MemoryEmbeddingModel | null): Promise<void>;
  readRecallCandidates(poolId: string, fingerprint: string | null, dimension: number | null): Promise<{ entries: MemoryEntry[]; vectors: MemoryVector[] }>;
  claimEmbedding(fingerprint: string, claimId: string, now: string, expiresAt: string): Promise<MemoryEmbeddingClaim | null>;
  completeEmbedding(claim: MemoryEmbeddingClaim, vector: number[]): Promise<'accepted' | 'discarded' | 'dimension_mismatch'>;
  failEmbedding(claim: MemoryEmbeddingClaim, error: string, terminal: boolean, now: string, retryAt: string): Promise<boolean>;
  releaseEmbedding(claim: MemoryEmbeddingClaim): Promise<void>;
  retryEmbedding(poolId: string, memoryId: string): Promise<void>;
  getNextEmbeddingWakeAt(fingerprint: string): Promise<string | null>;
}
