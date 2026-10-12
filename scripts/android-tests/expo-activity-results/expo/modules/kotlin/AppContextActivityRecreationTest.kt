package expo.modules.kotlin

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.os.Bundle
import androidx.appcompat.app.AppCompatActivity
import expo.modules.kotlin.activityresult.ActivityResultsManager
import expo.modules.kotlin.activityresult.AppContextActivityResultContract
import expo.modules.kotlin.activityresult.AppContextActivityResultLauncher
import io.mockk.every
import io.mockk.mockk
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [33], manifest = Config.NONE)
class AppContextActivityRecreationTest {
  class HostActivity : AppCompatActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
      setTheme(androidx.appcompat.R.style.Theme_AppCompat)
      super.onCreate(savedInstanceState)
    }
  }

  private class PickerContract(private val name: String) : AppContextActivityResultContract<String, String> {
    override fun createIntent(context: Context, input: String) = Intent("ravencat.test.$name").putExtra("input", input)
    override fun parseResult(input: String, resultCode: Int, intent: Intent?) = "$input:$resultCode"
  }

  @Test
  fun pickerContractsFollowTheNewActivityEvenWithoutReactHostDestroy() = runBlocking<Unit> {
    // 只替换 JS/模块装配边界；执行真实 AppContext、ActivityResultsManager 和原生引用注册表。
    val appContext = mockk<AppContext>(relaxed = true)
    val runtime = mockk<RuntimeContext>(relaxed = true)
    val modules = mockk<ModuleRegistry>(relaxed = true)
    every { runtime.registry } returns modules
    setField(appContext, "hostingRuntimeContext", runtime)
    every { appContext.onHostResume() } answers { callOriginal() }
    every { appContext.onHostDestroy() } answers { callOriginal() }
    val manager = ActivityResultsManager(appContext)
    setField(appContext, "activityResultsManager", manager)

    val launchers = mutableMapOf<String, AppContextActivityResultLauncher<String, String>>()
    fun registerPickers() = runBlocking {
      for (name in listOf("camera", "library", "crop")) {
        launchers[name] = manager.registerForActivityResult(PickerContract(name)) { _, _ -> }
      }
    }
    every { modules.registerActivityContracts() } answers { registerPickers() }

    fun resume(activity: HostActivity) {
      every { appContext.currentActivity } returns activity
      appContext.onHostResume()
    }
    fun launchAll(activity: HostActivity) {
      for ((name, launcher) in launchers) {
        var result: String? = null
        launcher.launch(name) { result = it }
        val started = shadowOf(activity).nextStartedActivityForResult
        assertEquals("ravencat.test.$name", started.intent.action)
        manager.onActivityResult(started.requestCode, Activity.RESULT_OK, null)
        assertEquals("$name:${Activity.RESULT_OK}", result)
      }
    }

    val first = Robolectric.buildActivity(HostActivity::class.java).setup()
    resume(first.get())
    registerPickers()
    launchAll(first.get())
    val pendingResults = mutableListOf<String>()
    launchers.getValue("library").launch("pending") { pendingResults.add(it) }
    val pending = shadowOf(first.get()).nextStartedActivityForResult
    resume(first.get())
    manager.onActivityResult(pending.requestCode, Activity.RESULT_CANCELED, null)
    assertEquals("同一页面恢复后仍能收到正在等待的选择结果", listOf("pending:${Activity.RESULT_CANCELED}"), pendingResults)

    // ReactHost 仍在后台工作，旧 Activity 的销毁没有传递给 Expo AppContext。
    first.pause().stop().destroy()
    val second = Robolectric.buildActivity(HostActivity::class.java).setup()
    resume(second.get())
    launchAll(second.get())
    resume(second.get())
    launchAll(second.get())
    second.pause().stop()
    appContext.onHostDestroy()
    second.destroy()
    val third = Robolectric.buildActivity(HostActivity::class.java).setup()
    resume(third.get())
    launchAll(third.get())
    third.pause().stop().destroy()
  }

  private fun setField(target: AppContext, name: String, value: Any) {
    AppContext::class.java.getDeclaredField(name).apply { isAccessible = true }.set(target, value)
  }
}
