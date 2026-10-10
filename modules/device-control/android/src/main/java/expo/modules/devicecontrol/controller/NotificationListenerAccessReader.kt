package expo.modules.devicecontrol.controller

/** 每次读取 Android 系统授权真值，不保存“曾授权”状态。 */
class NotificationListenerAccessReader(
  private val readSystemAccess: () -> Boolean,
) {
  fun getState(): Map<String, String> = mapOf(
    "status" to if (readSystemAccess()) "granted" else "not_granted",
  )

  fun isGranted(): Boolean = readSystemAccess()
}
