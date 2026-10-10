package expo.modules.devicecontrol.model

/**
 * application 下发给 native 的 active lock 执行投影。
 * 只携带执行所需字段（id / targetPackage / expiresAtEpochMs），
 * 不携带 source、reason、status 等业务历史；业务真值只存在于 application/SQLite。
 */
data class SoftLockProjection(
  val id: String,
  val targetPackage: String,
  val expiresAtEpochMs: Long?,
) {
  /** 执行租约级的到期判断（fail-open）：到期投影不得继续匹配目标。 */
  fun isExpired(nowEpochMs: Long): Boolean {
    return expiresAtEpochMs != null && expiresAtEpochMs <= nowEpochMs
  }

  fun toMap(): Map<String, Any?> {
    return mapOf(
      "id" to id,
      "targetPackage" to targetPackage,
      "expiresAtEpochMs" to expiresAtEpochMs,
    )
  }
}

/**
 * bridge → runtime 的投影同步命令：以 application 业务真值为权威，
 * 整体替换 native 当前执行投影。空列表代表当前没有 active lock，
 * native 必须清空全部投影；这不是增量 add/remove command。
 */
data class SoftLockCommand(
  val activeLocks: List<SoftLockProjection>,
) {
  companion object {
    /**
     * 解析 bridge 下发的投影数组。非法投影（缺 id / 空 targetPackage /
     * 重复 id / 非法 expiresAt）必须以 typed failure 显式拒绝，绝不静默丢弃。
     */
    fun fromBridgePayload(payload: List<Any?>): SoftLockCommandParseResult {
      val projections = mutableListOf<SoftLockProjection>()
      val seenIds = mutableSetOf<String>()

      for ((index, element) in payload.withIndex()) {
        val entry = element as? Map<*, *>
          ?: return SoftLockCommandParseResult.Invalid(
            "第 $index 个软锁投影不是对象",
          )

        val id = (entry["id"] as? String)?.trim()
        if (id.isNullOrEmpty()) {
          return SoftLockCommandParseResult.Invalid("第 $index 个软锁投影缺少非空 id")
        }

        val targetPackage = entry["targetPackage"] as? String
        if (targetPackage.isNullOrEmpty() || targetPackage.any(Char::isWhitespace)) {
          return SoftLockCommandParseResult.Invalid(
            "第 $index 个软锁投影 targetPackage 非法",
          )
        }

        if (!seenIds.add(id)) {
          return SoftLockCommandParseResult.Invalid("软锁投影 id 重复：$id")
        }

        val expiresAtEpochMs = when (val raw = entry["expiresAtEpochMs"]) {
          null -> null
          is Number -> raw.toSafeEpochMsOrNull()
            ?: return SoftLockCommandParseResult.Invalid(
              "第 $index 个软锁投影 expiresAtEpochMs 不是正安全整数",
            )
          else -> {
            return SoftLockCommandParseResult.Invalid(
              "第 $index 个软锁投影 expiresAtEpochMs 不是数字",
            )
          }
        }

        projections.add(
          SoftLockProjection(
            id = id,
            targetPackage = targetPackage,
            expiresAtEpochMs = expiresAtEpochMs,
          ),
        )
      }

      return SoftLockCommandParseResult.Parsed(SoftLockCommand(projections))
    }

    /** JS number 只能可靠表达安全整数；bridge 不做截断、舍入或钳制。 */
    private fun Number.toSafeEpochMsOrNull(): Long? {
      val value = toDouble()
      if (!value.isFinite() || value % 1.0 != 0.0) {
        return null
      }
      if (value <= 0.0 || value > MAX_SAFE_INTEGER_AS_DOUBLE) {
        return null
      }
      return value.toLong()
    }

    private const val MAX_SAFE_INTEGER_AS_DOUBLE = 9_007_199_254_740_991.0
  }
}

/** bridge payload 解析结果。 */
sealed interface SoftLockCommandParseResult {
  data class Parsed(val command: SoftLockCommand) : SoftLockCommandParseResult

  data class Invalid(val reason: String) : SoftLockCommandParseResult
}

/**
 * reconcile 命令的 typed 执行结果。
 * DC2-C 的 ok 只代表投影被 native runtime 接受并存储，
 * 不代表任何 blocking overlay 已 attach（overlay 在 DC2-D 才实现）。
 */
enum class SoftLockReconcileStatus(val serial: String) {
  OK("ok"),
  RUNTIME_UNAVAILABLE("runtime_unavailable"),
  INVALID_PROJECTION("invalid_projection"),
  FAILED("failed"),
}

data class SoftLockReconcileResult(
  val status: SoftLockReconcileStatus,
  val appliedCount: Int = 0,
  val reason: String? = null,
) {
  fun toMap(): Map<String, Any?> {
    return mapOf(
      "status" to status.serial,
      "appliedCount" to appliedCount,
      "reason" to reason,
    )
  }

  companion object {
    fun ok(appliedCount: Int): SoftLockReconcileResult {
      return SoftLockReconcileResult(SoftLockReconcileStatus.OK, appliedCount)
    }

    fun runtimeUnavailable(reason: String): SoftLockReconcileResult {
      return SoftLockReconcileResult(SoftLockReconcileStatus.RUNTIME_UNAVAILABLE, reason = reason)
    }

    fun invalidProjection(reason: String): SoftLockReconcileResult {
      return SoftLockReconcileResult(SoftLockReconcileStatus.INVALID_PROJECTION, reason = reason)
    }

    fun failed(reason: String): SoftLockReconcileResult {
      return SoftLockReconcileResult(SoftLockReconcileStatus.FAILED, reason = reason)
    }
  }
}
