package expo.modules.conversationturnruntime;

import com.facebook.react.BaseReactPackage;
import com.facebook.react.bridge.NativeModule;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.module.model.ReactModuleInfo;
import com.facebook.react.module.model.ReactModuleInfoProvider;
import com.facebook.react.modules.core.HeadlessJsTaskSupportModule;
import java.util.Collections;

/** RN 0.81 的新架构遗漏任务完成模块；注册框架原实现，保持唯一的任务收尾协议。 */
public final class HeadlessJsTaskSupportPackage extends BaseReactPackage {
  @Override
  public NativeModule getModule(String name, ReactApplicationContext context) {
    return HeadlessJsTaskSupportModule.NAME.equals(name)
        ? new HeadlessJsTaskSupportModule(context)
        : null;
  }

  @Override
  public ReactModuleInfoProvider getReactModuleInfoProvider() {
    return () -> Collections.singletonMap(
        HeadlessJsTaskSupportModule.NAME,
        new ReactModuleInfo(
            HeadlessJsTaskSupportModule.NAME,
            HeadlessJsTaskSupportModule.class.getName(),
            false,
            false,
            false,
            true));
  }
}
