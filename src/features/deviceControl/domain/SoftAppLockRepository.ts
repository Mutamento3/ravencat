/** Soft App Lock 业务真值持久化端口。 */

import type { SoftAppLock } from './SoftAppLock';

/**
 * release 的幂等语义：
 * - 'released'：本次调用把 active 行转为 released；
 * - 'unchanged'：行已处于终态（released / expired / failed），本次调用不改写历史状态；
 * - 'not_found'：id 不存在。
 */
export type ReleaseSoftAppLockResult =
  | { outcome: 'released'; lock: SoftAppLock }
  | { outcome: 'unchanged'; lock: SoftAppLock }
  | { outcome: 'not_found' };

export type InsertAiSoftAppLockResult =
  | { outcome: 'inserted'; lock: SoftAppLock }
  | { outcome: 'already_active'; lock: SoftAppLock };

export type ReleaseActiveAiSoftAppLockResult =
  | { outcome: 'released'; lock: SoftAppLock }
  | { outcome: 'not_found' };

export interface ISoftAppLockRepository {
  /** 插入一条业务真值行；id 冲突由底层唯一约束拒绝。 */
  insert(lock: SoftAppLock): Promise<void>;
  getById(id: string): Promise<SoftAppLock | null>;
  /**
   * 读取当前 active 的锁；明确排除 released / expired / failed，
   * 并用显式时间比较排除已到期但尚未落 expired 的行。
   */
  listActive(nowEpochMs: number): Promise<SoftAppLock[]>;
  /**
   * 原子裁决同一 AI、同一目标的 active ai_tool lock：没有则插入，已有则返回原事实。
   * lock 已由 application/domain 固定为合法的 active ai_tool 业务事实。
   */
  insertAiLockIfNoActiveByActorAndTarget(
    lock: SoftAppLock,
    nowEpochMs: number
  ): Promise<InsertAiSoftAppLockResult>;
  /** 只释放指定 AI 自己为指定目标创建的 active ai_tool 锁。 */
  releaseActiveAiLockByActorAndTarget(
    sourceAiId: string,
    targetPackage: string
  ): Promise<ReleaseActiveAiSoftAppLockResult>;
  /** 幂等 release，见 [ReleaseSoftAppLockResult]。 */
  release(id: string): Promise<ReleaseSoftAppLockResult>;
  /**
   * 把到期（expires_at <= nowEpochMs）的 active 行明确转为 expired，
   * 返回本次实际转换的锁；重复调用返回空数组。
   */
  expireDue(nowEpochMs: number): Promise<SoftAppLock[]>;
  /** 恢复出厂清理；只清业务真值行，不触碰系统授权。 */
  clearForFactoryReset(): Promise<void>;
}
