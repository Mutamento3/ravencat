package expo.modules.devicecontrol.controller

import expo.modules.devicecontrol.model.SoftLockProjection
import expo.modules.deviceobserver.DeviceWindowState

/** controller 对一次输入快照的决策输出；不包含任何执行副作用。 */
data class SoftLockControllerDecision(
  val matchingLockId: String?,
  val targetMatched: Boolean,
  val shouldBlock: Boolean,
)

/**
 * Soft Lock 执行决策的最小状态机（DC2-C）。
 *
 * 只回答：在当前 active 投影与 observer 事实组合下是否应该阻断：
 *
 * shouldBlock = observer connected
 *             + current window reliable
 *             + current package 匹配某个未过期 active lock
 *
 * DC2-C 不创建、不移除任何 overlay window；
 * shouldBlock → attach blocking window 的执行链在 DC2-D 接上。
 * 不做 SQLite 读写、Chat 写入、通知、媒体暂停或任何 AI 决策。
 */
class SoftLockController {
  fun reconcile(
    activeLocks: List<SoftLockProjection>,
    currentWindow: DeviceWindowState?,
    observerConnected: Boolean,
    nowEpochMs: Long,
  ): SoftLockControllerDecision {
    val currentPackage = currentWindow?.packageName?.takeIf { it.isNotEmpty() }
    val matchingLock = currentPackage?.let { packageName ->
      activeLocks.firstOrNull { lock ->
        !lock.isExpired(nowEpochMs) && lock.targetPackage == packageName
      }
    }
    val targetMatched = matchingLock != null
    val windowReliable = currentWindow?.detectionReliable == true
    val shouldBlock = observerConnected && windowReliable && targetMatched

    return SoftLockControllerDecision(
      matchingLockId = matchingLock?.id,
      targetMatched = targetMatched,
      shouldBlock = shouldBlock,
    )
  }
}
