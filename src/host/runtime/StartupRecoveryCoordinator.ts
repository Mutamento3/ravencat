/**
 * 启动恢复编排器：基于真实完成状态（而非"已请求"）串联各启动阶段。
 *
 * 产品启动顺序固定为：
 *   数据库最低可用
 *   → RavenCat 悬浮交互投影对账完成
 *   → Chat 会话列表首屏加载完成
 *   → RavenCat / Agent Runtime 必要运行态恢复完成
 *
 * 同一时间只能运行一个启动恢复流程；冷启动和回到前台的语义要区分。
 */

import type { DatabaseTaskMeta } from '@platform/persistence';

/** 启动阶段标识。 */
export type StartupStage =
  | 'database'
  | 'raven-cat-surface'
  | 'conversation-list'
  | 'runtime-recovery'
  | 'completed';

/** 启动恢复依赖注入。 */
export interface StartupRecoveryDeps {
  /** 根据独立用户意图对账 RavenCat 悬浮交互投影。 */
  restoreRavenCatSurface(): Promise<void>;
  /** 等待会话列表首屏加载完成。 */
  waitForConversationListReady(): Promise<void>;
  /** 从 Companion SQLite 真相恢复 Self Wake 原生投影。 */
  reconcileCompanionScheduleProjection(): Promise<void>;
  /** 恢复 RavenCat / Agent Runtime 必要运行态。 */
  recoverRequiredRuntimeState(): Promise<void>;
  /** 可选：为整个启动恢复流程创建数据库任务元数据。 */
  createStartupExecutor?(meta: DatabaseTaskMeta): unknown;
}

/** 启动恢复结果。 */
export interface StartupRecoveryResult {
  stage: StartupStage;
  error?: Error;
}

let runningPromise: Promise<StartupRecoveryResult> | null = null;
let currentStage: StartupStage = 'database';
let recoveryGeneration = 0;
let cancelConversationListWait: (() => void) | null = null;

/**
 * 等待会话列表首屏，但可被恢复出厂取消提前释放。
 *
 * conversation-list 阶段可能永久等待（Host 已停用会话列表加载），
 * 不能依赖阶段结束后的 generation 检查；取消时通过闩锁立即释放。
 */
async function waitForConversationListOrCancellation(
  waitForReady: () => Promise<void>,
): Promise<void> {
  let releaseCancellation!: () => void;

  const cancellation = new Promise<void>((resolve) => {
    releaseCancellation = resolve;
  });

  cancelConversationListWait = releaseCancellation;

  try {
    await Promise.race([
      waitForReady(),
      cancellation,
    ]);
  } finally {
    if (cancelConversationListWait === releaseCancellation) {
      cancelConversationListWait = null;
    }
  }
}

/**
 * 执行完整的启动恢复 pipeline。
 *
 * - 同一时间只能运行一份；
 * - 某个低优先级阶段失败不会回滚已完成的悬浮交互投影或 Chat 首屏；
 * - 失败后返回包含阶段名的结果。
 */
export function runStartupRecovery(
  deps: StartupRecoveryDeps,
): Promise<StartupRecoveryResult> {
  if (runningPromise) {
    return runningPromise;
  }

  const generation = recoveryGeneration;

  runningPromise = (async (): Promise<StartupRecoveryResult> => {
    const stages: { name: StartupStage; run: () => Promise<void> }[] = [
      {
        name: 'raven-cat-surface',
        run: () => deps.restoreRavenCatSurface(),
      },
      {
        name: 'conversation-list',
        run: () => waitForConversationListOrCancellation(
          deps.waitForConversationListReady,
        ),
      },
      {
        name: 'runtime-recovery',
        run: async () => {
          try {
            await deps.reconcileCompanionScheduleProjection();
          } catch (error) {
            console.warn('[StartupRecovery] Self Wake 投影恢复失败，将在下次启动重试：', error);
          }
          await deps.recoverRequiredRuntimeState();
        },
      },
    ];

    for (const stage of stages) {
      if (generation !== recoveryGeneration) {
        return { stage: currentStage };
      }

      currentStage = stage.name;

      try {
        await stage.run();
      } catch (error) {
        if (generation !== recoveryGeneration) {
          return { stage: currentStage };
        }

        const err = error instanceof Error ? error : new Error(String(error));
        console.warn(`[StartupRecovery] 阶段 ${stage.name} 失败：`, err.message);
        return { stage: stage.name, error: err };
      }

      if (generation !== recoveryGeneration) {
        return { stage: currentStage };
      }
    }

    currentStage = 'completed';
    return { stage: 'completed' };
  })().finally(() => {
    runningPromise = null;
  });

  return runningPromise;
}

/**
 * 取消当前启动恢复流程（恢复出厂前调用）。
 *
 * 增加 generation 使旧流程在阶段边界停止：已运行的阶段会执行完，
 * 后续阶段不再开始；等待旧 Promise settle 后再清空运行态，
 * 新 Host 不会复用旧恢复流程。
 *
 * 卡在会话列表等待时通过闩锁立即释放，避免与停用列表加载互相死等。
 */
export async function cancelStartupRecoveryForReset(): Promise<void> {
  recoveryGeneration += 1;
  cancelConversationListWait?.();

  const active = runningPromise;
  if (active) {
    await active;
  }

  runningPromise = null;
  currentStage = 'database';
  cancelConversationListWait = null;
}

/** 获取当前启动阶段（用于 UI 或诊断）。 */
export function getStartupStage(): StartupStage {
  return currentStage;
}

/** 重置启动阶段（仅用于测试）。 */
export function resetStartupStage(): void {
  currentStage = 'database';
  runningPromise = null;
}
