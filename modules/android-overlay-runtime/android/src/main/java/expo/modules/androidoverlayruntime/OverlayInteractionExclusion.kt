package expo.modules.androidoverlayruntime

/** 临时交互执行期抑制普通悬浮窗口；只投影可见性，不停止任何业务或 Service。由主线程访问。 */
object OverlayInteractionExclusion {
  private val owners = mutableSetOf<Any>()
  private val listeners = mutableSetOf<(Boolean) -> Unit>()

  fun acquire(owner: Any) {
    if (owners.add(owner) && owners.size == 1) notifyListeners(true)
  }

  fun release(owner: Any) {
    if (owners.remove(owner) && owners.isEmpty()) notifyListeners(false)
  }

  fun subscribe(listener: (Boolean) -> Unit): () -> Unit {
    listeners.add(listener)
    listener(owners.isNotEmpty())
    return { listeners.remove(listener) }
  }

  private fun notifyListeners(excluded: Boolean) {
    listeners.toList().forEach { it(excluded) }
  }
}
