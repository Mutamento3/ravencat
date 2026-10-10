/** 在 UI 子树挂载前完成 restore commit 或补偿回滚。 */

import type { PendingRestoreAction } from '../../../modules/backup-storage';

export interface PendingBackupRestoreCompletionDependencies {
  consumeRestoreFailure(): Promise<string | null>;
  readPendingRestoreAction(): Promise<PendingRestoreAction | null>;
  initializeDatabase(): Promise<void>;
  closeDatabaseForRollback(): Promise<void>;
  restoreStableSettings(json: string): Promise<void>;
  commitActivatedRestore(): Promise<void>;
  rollbackActivatedRestore(failureMessage: string): Promise<void>;
  completeRolledBackRestore(): Promise<void>;
  collectRestoreGarbage(): Promise<void>;
  reportCleanupFailure(error: unknown): void;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function collectGarbageWithoutChangingOutcome(
  dependencies: PendingBackupRestoreCompletionDependencies,
): Promise<void> {
  try {
    await dependencies.collectRestoreGarbage();
  } catch (error) {
    // committed / rolled_back 已是事务终态；这里只报告可在下次冷启动重试的 GC。
    dependencies.reportCleanupFailure(error);
  }
}

async function finishRollbackSettings(
  action: Extract<PendingRestoreAction, { kind: 'restore_rollback_settings' }>,
  dependencies: PendingBackupRestoreCompletionDependencies,
): Promise<never> {
  await dependencies.restoreStableSettings(action.stableSettingsJson);
  await dependencies.completeRolledBackRestore();
  await collectGarbageWithoutChangingOutcome(dependencies);
  throw new Error(`恢复失败，原数据已回滚：${action.failureMessage}`);
}

export async function runPendingBackupRestoreCompletion(
  dependencies: PendingBackupRestoreCompletionDependencies,
): Promise<void> {
  const previousFailure = await dependencies.consumeRestoreFailure();
  if (previousFailure) {
    throw new Error(`恢复失败，原数据已回滚：${previousFailure}`);
  }

  const action = await dependencies.readPendingRestoreAction();
  if (action === null) return;
  if (action.kind === 'restore_rollback_settings') {
    return finishRollbackSettings(action, dependencies);
  }

  try {
    await dependencies.initializeDatabase();
    await dependencies.restoreStableSettings(action.stableSettingsJson);
    await dependencies.commitActivatedRestore();
  } catch (error) {
    await dependencies.closeDatabaseForRollback();
    await dependencies.rollbackActivatedRestore(errorMessage(error));
    const rollbackAction = await dependencies.readPendingRestoreAction();
    if (rollbackAction?.kind !== 'restore_rollback_settings') {
      throw new Error('恢复事务未进入稳定设置回滚阶段', { cause: error });
    }
    return finishRollbackSettings(rollbackAction, dependencies);
  }

  await collectGarbageWithoutChangingOutcome(dependencies);
}
