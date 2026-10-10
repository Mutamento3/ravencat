/**
 * Device Control Soft App Lock 业务真值模型。
 *
 * 业务状态（active / released / expired / failed）是唯一真值；
 * native overlay 的 attached / detached 只是执行投影，不回流为本模型字段。
 * 过期判断使用明确的 epoch 毫秒比较，不依赖 UI timer。
 */

export type SoftAppLockStatus = 'active' | 'released' | 'expired' | 'failed';

/** manual_test 只用于读取已退休测试入口的历史事实，正式创建入口只写 ai_tool。 */
export type SoftAppLockSource = 'manual_test' | 'ai_tool';

export const SOFT_APP_LOCK_STATUSES: readonly SoftAppLockStatus[] = [
  'active',
  'released',
  'expired',
  'failed',
] as const;

export const SOFT_APP_LOCK_SOURCES: readonly SoftAppLockSource[] = [
  'manual_test',
  'ai_tool',
] as const;

export interface SoftAppLock {
  id: string;
  targetPackage: string;
  source: SoftAppLockSource;
  sourceAiId?: string;
  reason?: string;
  createdAtEpochMs: number;
  expiresAtEpochMs?: number;
  status: SoftAppLockStatus;
}

export type CreateSoftAppLockInput = Omit<SoftAppLock, 'status'> & {
  status?: SoftAppLockStatus;
};

export interface SoftAppLockRow {
  id: string;
  target_package: string;
  source: string;
  source_ai_id: string | null;
  reason: string | null;
  created_at: number;
  expires_at: number | null;
  status: string;
}

/** 校验目标 package：非空、不含任何空白字符。 */
export function isValidSoftAppLockTargetPackage(targetPackage: unknown): targetPackage is string {
  return (
    typeof targetPackage === 'string' &&
    targetPackage.length > 0 &&
    !/\s/.test(targetPackage)
  );
}

function isEpochMs(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

export function assertSoftAppLock(lock: SoftAppLock): void {
  if (typeof lock.id !== 'string' || lock.id.length === 0) {
    throw new Error('SoftAppLock id 不能为空');
  }
  if (!isValidSoftAppLockTargetPackage(lock.targetPackage)) {
    throw new Error(`SoftAppLock targetPackage 非法：${String(lock.targetPackage)}`);
  }
  if (!SOFT_APP_LOCK_SOURCES.includes(lock.source)) {
    throw new Error(`SoftAppLock source 非法：${String(lock.source)}`);
  }
  if (!SOFT_APP_LOCK_STATUSES.includes(lock.status)) {
    throw new Error(`SoftAppLock status 非法：${String(lock.status)}`);
  }
  if (lock.sourceAiId !== undefined) {
    if (typeof lock.sourceAiId !== 'string' || lock.sourceAiId.length === 0) {
      throw new Error('SoftAppLock sourceAiId 必须是非空字符串');
    }
    if (lock.source !== 'ai_tool') {
      throw new Error('SoftAppLock sourceAiId 只允许出现在 ai_tool 来源上');
    }
  } else if (lock.source === 'ai_tool') {
    throw new Error('SoftAppLock sourceAiId 在 ai_tool 来源上必填');
  }
  if (lock.reason !== undefined) {
    if (typeof lock.reason !== 'string' || lock.reason.trim().length === 0) {
      throw new Error('SoftAppLock reason 必须是非空字符串');
    }
  }
  if (!isEpochMs(lock.createdAtEpochMs)) {
    throw new Error(`SoftAppLock createdAtEpochMs 非法：${String(lock.createdAtEpochMs)}`);
  }
  if (lock.expiresAtEpochMs !== undefined) {
    if (!isEpochMs(lock.expiresAtEpochMs)) {
      throw new Error(`SoftAppLock expiresAtEpochMs 非法：${String(lock.expiresAtEpochMs)}`);
    }
    if (lock.expiresAtEpochMs <= lock.createdAtEpochMs) {
      throw new Error('SoftAppLock expiresAtEpochMs 必须晚于 createdAtEpochMs');
    }
  } else if (lock.source === 'ai_tool') {
    throw new Error('SoftAppLock expiresAtEpochMs 在 ai_tool 来源上必填');
  }
}

export function createSoftAppLock(input: CreateSoftAppLockInput): SoftAppLock {
  const lock: SoftAppLock = {
    id: input.id,
    targetPackage: input.targetPackage,
    source: input.source,
    sourceAiId: input.sourceAiId,
    reason: input.reason,
    createdAtEpochMs: input.createdAtEpochMs,
    expiresAtEpochMs: input.expiresAtEpochMs,
    status: input.status ?? 'active',
  };
  assertSoftAppLock(lock);
  return lock;
}

/** 从 SQLite 行重建 SoftAppLock；空值列映射回可选字段，损坏数据直接抛错。 */
export function createSoftAppLockFromRow(row: SoftAppLockRow | null): SoftAppLock | null {
  if (!row) {
    return null;
  }
  return createSoftAppLock({
    id: row.id,
    targetPackage: row.target_package,
    source: row.source as SoftAppLockSource,
    sourceAiId: row.source_ai_id ?? undefined,
    reason: row.reason ?? undefined,
    createdAtEpochMs: row.created_at,
    expiresAtEpochMs: row.expires_at ?? undefined,
    status: row.status as SoftAppLockStatus,
  });
}
