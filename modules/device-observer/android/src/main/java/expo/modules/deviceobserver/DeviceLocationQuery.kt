package expo.modules.deviceobserver

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.location.LocationManager
import android.location.LocationRequest
import android.os.CancellationSignal
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlin.coroutines.resume

/** 单次定位由系统融合 provider 拥有；不监听轨迹、不保存位置，也不依赖无障碍或悬浮服务。 */
internal class DeviceLocationQuery(private val context: Context) {
  private val manager = context.getSystemService(LocationManager::class.java)

  private fun permission(): String = when {
    context.checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED -> "precise"
    context.checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED -> "approximate"
    else -> "not_granted"
  }

  fun accessState(): Map<String, Any> = mapOf(
    "permission" to permission(),
    "servicesEnabled" to manager.isLocationEnabled,
  )

  suspend fun read(): Map<String, Any> {
    val permission = permission()
    if (permission == "not_granted") return mapOf("status" to "permission_not_granted")
    if (!manager.isLocationEnabled) return mapOf("status" to "location_services_disabled")
    if (!manager.hasProvider(LocationManager.FUSED_PROVIDER)) return mapOf("status" to "location_provider_unavailable")

    return suspendCancellableCoroutine { continuation ->
      val cancellation = CancellationSignal()
      continuation.invokeOnCancellation { cancellation.cancel() }
      try {
        manager.getCurrentLocation(
          LocationManager.FUSED_PROVIDER,
          LocationRequest.Builder(0L)
            .setQuality(LocationRequest.QUALITY_HIGH_ACCURACY)
            .setDurationMillis(15_000L)
            .build(),
          cancellation,
          context.mainExecutor,
        ) { location ->
          val result = if (location == null) {
            mapOf("status" to "location_unavailable")
          } else {
            // 系统允许返回近期 fix；把真实测量时间和单调时钟年龄一起交给消费者解释。
            mapOf(
              "status" to "available",
              "latitude" to location.latitude,
              "longitude" to location.longitude,
              "accuracyMeters" to location.accuracy.toDouble(),
              "measuredAtEpochMs" to location.time,
              "ageMs" to location.elapsedRealtimeAgeMillis,
              "permission" to permission,
              "isMock" to location.isMock,
            )
          }
          continuation.resume(result)
        }
      } catch (error: SecurityException) {
        // 授权可在检查后被系统撤销；这个竞态只由原生调用边界处理。
        continuation.resume(mapOf("status" to "permission_not_granted"))
      }
    }
  }
}
