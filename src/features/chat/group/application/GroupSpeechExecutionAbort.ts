/**
 * 群聊执行链路的协作式中止注册表（App JS 进程内）。
 *
 * 召唤 owner 为管理员规划注册 AbortController，执行器为每个 running 任务
 * 注册 AbortController，并经由 runtimeContext.abortSignal 传入 processAIReply；用户消息换代事务提交后，
 * 发送路径按旧 planId 中止其旧请求以节约模型/网络资源。
 *
 * AbortSignal 永远只是协作式提示：旧输出能否落库由持久化 fence
 * （isSpeechTaskCommitEligible）最终裁决，不得以 abort 代替 fence。
 */

const controllersByPlanId = new Map<string, Set<AbortController>>();
const invocationCountsByGroupId = new Map<string, number>();

/** 从读取/claim 前登记 owner，冷启动恢复不能把本进程的准备阶段误判为孤儿。 */
export function registerGroupSpeechInvocation(groupId: string): () => void {
  invocationCountsByGroupId.set(groupId, (invocationCountsByGroupId.get(groupId) ?? 0) + 1);
  return () => {
    const remaining = invocationCountsByGroupId.get(groupId)! - 1;
    if (remaining === 0) invocationCountsByGroupId.delete(groupId);
    else invocationCountsByGroupId.set(groupId, remaining);
  };
}

export function listActiveGroupSpeechGroupIds(): string[] {
  return [...invocationCountsByGroupId.keys()];
}

/** 注册并返回反注册函数；任务结束（无论成败）必须反注册。 */
export function registerGroupSpeechAbort(
  planId: string,
  controller: AbortController,
): () => void {
  let controllers = controllersByPlanId.get(planId);
  if (!controllers) {
    controllers = new Set();
    controllersByPlanId.set(planId, controllers);
  }
  controllers.add(controller);
  return () => {
    controllers.delete(controller);
    if (controllers.size === 0) {
      controllersByPlanId.delete(planId);
    }
  };
}

export function abortGroupSpeechPlanExecution(planId: string): void {
  const controllers = controllersByPlanId.get(planId);
  if (!controllers) {
    return;
  }
  for (const controller of [...controllers]) {
    controller.abort();
  }
}
