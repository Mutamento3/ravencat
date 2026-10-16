package expo.modules.kimiphonenotifications

import android.app.Activity
import android.app.KeyguardManager
import android.content.Intent
import org.junit.After
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import org.robolectric.annotation.Implementation
import org.robolectric.annotation.Implements

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [33], shadows = [CallPresentationReturnTest.KeyguardShadow::class])
class CallPresentationReturnTest {
  // 系统允许 null callback；Robolectric 自带 shadow 错误解引用它，设备边界在此替代。
  @Implements(KeyguardManager::class)
  class KeyguardShadow {
    @Implementation
    fun requestDismissKeyguard(activity: Activity, callback: KeyguardManager.KeyguardDismissCallback?) {}
  }

  class TaskActivity : Activity() {
    var backgroundCount = 0
    override fun moveTaskToBack(nonRoot: Boolean): Boolean { backgroundCount++; return true }
  }

  private val activities = mutableListOf<TaskActivity>()
  private fun mainActivity() = Robolectric.buildActivity(TaskActivity::class.java).get().also { activities.add(it) }

  @After
  fun cleanup() { activities.forEach { CallPresentationReturn.stopped(it) } }

  @Test
  fun `in app calls preserve the foreground task`() {
    val activity = mainActivity()
    CallPresentationReturn.started(activity)
    assertTrue(CallPresentationReturn.isAppVisible)
    CallPresentationReturn.accepted("internal", false)
    CallPresentationReturn.leave("internal", true, activity)
    assertEquals(0, activity.backgroundCount)
    CallPresentationReturn.stopped(activity)
    assertFalse(CallPresentationReturn.isAppVisible)
  }

  @Test
  fun `external calls return to the previous task through minimize restore and hangup`() {
    val activity = mainActivity()
    CallPresentationReturn.accepted("external", true)
    CallPresentationReturn.leave("old-call", true, activity)
    assertEquals(0, activity.backgroundCount)
    CallPresentationReturn.leave("external", false, activity)
    CallPresentationReturn.leave("external", true, activity)
    assertEquals(2, activity.backgroundCount)
    CallPresentationReturn.leave("external", true, activity)
    assertEquals(2, activity.backgroundCount)
  }

  private fun incomingIntent(action: String) = Intent(RuntimeEnvironment.getApplication(), IncomingCallActivity::class.java)
    .putExtra("type", "ai-incoming-call")
    .putExtra("notificationId", "notification-call")
    .putExtra("callId", "incoming")
    .putExtra("aiName", "AI")
    .putExtra("notificationAction", action)

  @Test
  fun `foreground source is captured before the native shell covers the app`() {
    val main = mainActivity()
    CallPresentationReturn.started(main)
    val shell = Robolectric.buildActivity(IncomingCallActivity::class.java, incomingIntent("open")).create()
    // 原生来电页已经盖住主界面，接听仍应保留进入前的来源。
    CallPresentationReturn.stopped(main)
    shell.newIntent(incomingIntent("accept"))
    CallPresentationReturn.leave("incoming", true, main)
    assertEquals(0, main.backgroundCount)
  }

  @Test
  fun `native shell recreation preserves external source`() {
    val controller = Robolectric.buildActivity(IncomingCallActivity::class.java, incomingIntent("open")).create()
    val savedState = android.os.Bundle()
    controller.saveInstanceState(savedState).destroy()
    val main = mainActivity()
    CallPresentationReturn.started(main)
    val restored = Robolectric.buildActivity(IncomingCallActivity::class.java, incomingIntent("open")).create(savedState)
    restored.newIntent(incomingIntent("accept"))
    CallPresentationReturn.leave("incoming", true, main)
    assertEquals(1, main.backgroundCount)
    CallPresentationReturn.stopped(main)
  }
}
