package expo.modules.conversationturnruntime;

import static org.junit.Assert.*;

import com.facebook.react.bridge.JavaOnlyMap;
import com.facebook.react.bridge.BridgeReactContext;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.jstasks.HeadlessJsTaskConfig;
import com.facebook.react.jstasks.HeadlessJsTaskContext;
import com.facebook.react.modules.core.HeadlessJsTaskSupportModule;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.RuntimeEnvironment;
import org.robolectric.annotation.Config;

/** 完成通知只结束对应任务；多个宿主共享的框架任务上下文必须全部收尾后才空闲。 */
@RunWith(RobolectricTestRunner.class)
@Config(sdk = 33)
public class HeadlessJsTaskSupportPackageTest {
  @Test
  public void registeredModuleFinishesOnlyItsTask() {
    HeadlessJsTaskSupportPackage pkg = new HeadlessJsTaskSupportPackage();
    assertTrue(pkg.getReactModuleInfoProvider().getReactModuleInfos()
        .get("HeadlessJsTaskSupport").isTurboModule());
    ReactApplicationContext context = new BridgeReactContext(RuntimeEnvironment.getApplication());
    HeadlessJsTaskSupportModule module = (HeadlessJsTaskSupportModule)
        pkg.getModule("HeadlessJsTaskSupport", context);
    assertNotNull(module);
    HeadlessJsTaskContext tasks = HeadlessJsTaskContext.getInstance(context);
    HeadlessJsTaskConfig config = new HeadlessJsTaskConfig(
        "ConversationTurnExecutionTask", new JavaOnlyMap(), 0, true);
    int first = tasks.startTask(config);
    int second = tasks.startTask(config);
    module.notifyTaskFinished(first);
    assertFalse(tasks.isTaskRunning(first));
    assertTrue(tasks.isTaskRunning(second));
    assertTrue(tasks.hasActiveTasks());
    module.notifyTaskFinished(second);
    assertFalse(tasks.hasActiveTasks());
  }
}
