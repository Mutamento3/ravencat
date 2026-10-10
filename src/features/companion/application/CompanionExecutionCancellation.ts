/**
 * 一次 Companion delivery 的取消注册。
 *
 * 取消事实的权威在 native（`RavenCatCompanionWakeStore` 按 deliveryEventId 记录，
 * 跨进程重建也不丢）：runner 可能晚于取消请求才注册自己的 `AbortController`
 * （JS 冷启动 / runtime 重建 / 任务尚未派发），此时 native 取消事件叫不到任何
 * controller，只能由 runner 启动后消费该标记并自己 abort。
 *
 * 这里只持有「本 JS runtime 中正在跑的 controller」，不做持久化，也不是取消事实的 owner。
 *
 * 时序不变量（runner initialization 的三段，缺一段就会静默丢取消）：
 *
 * ```text
 * register 之前到达的 cancel → native tombstone 接住，runner 消费后自己 abort
 * register 之后到达的 cancel → 取消事件直接命中 controller
 * register 与 native consume 之间到达的 cancel → 事件命中 controller，
 *   native consume 也可能同时命中 → abort 必须幂等（AbortController 本身幂等）
 * ```
 *
 * 因此 **register 必须早于 native consume**：先消费再注册会留下
 * 「consume 返回 false → cancel 到达（无人注册）→ register」这段无人接管的夹缝。
 */

export interface CompanionExecutionCancellationRegistry {
  /** runner 注册自己的 controller；注册与取消互不阻塞，只登记引用。 */
  register(deliveryEventId: string, controller: AbortController): void;

  /**
   * 让该 delivery 的 controller abort，返回是否命中本 runtime 的注册项。
   *
   * 幂等：重复取消、或该 delivery 的 controller 已经 abort 过，都不会出错。
   * 返回 false 只表示本 runtime 当前没有该 delivery 的注册项，
   * **不代表取消丢失**——取消事实由 native 标记持有。
   */
  cancel(deliveryEventId: string): boolean;

  /** runner 到达终态后释放注册。 */
  release(deliveryEventId: string): void;
}

export function buildCompanionExecutionCancellationError(deliveryEventId: string): Error {
  return new Error(`companion_execution_cancelled:${deliveryEventId}`);
}

export function createCompanionExecutionCancellationRegistry(): CompanionExecutionCancellationRegistry {
  const controllers = new Map<string, AbortController>();

  return {
    register(deliveryEventId, controller) {
      controllers.set(deliveryEventId, controller);
    },

    cancel(deliveryEventId) {
      const controller = controllers.get(deliveryEventId);
      if (!controller) {
        return false;
      }
      controller.abort(buildCompanionExecutionCancellationError(deliveryEventId));
      return true;
    },

    release(deliveryEventId) {
      controllers.delete(deliveryEventId);
    },
  };
}
