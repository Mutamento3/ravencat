# 原生文字选择

Android 只读文字选择会取得焦点；RN 的 `ReactScrollView.requestChildFocus` 随后主动滚动整个文字块。`NativeTextSelectionScrollView` 继承 RN 的原生滚动实现，只在触摸选择只读文字的焦点调用期间阻止滚动；用户手势、JS 滚动命令、编辑输入和硬件焦点导航保持原有语义。

`NativeTextSelectionPackage` 通过 Expo 本地模块发现注册独立名称的 RN ViewManager。`@platform/device` 的 `TextSelectionScrollView` 复用 RN JS ScrollView，使用 postinstall 开放的原生组件插槽接入该 ViewManager。聊天外层列表与过程卡片的内层滚动使用此适配，不替换全应用默认滚动容器。

RN 0.81 在触摸打断惯性时会取消结束检测，却不配对发送惯性结束事件，JS ScrollView 随后可能一直认为仍在滚动并截走子控件点击。适配层监听当前原生视图真实发出的惯性开始／结束，只在已接收的按下事件中为被打断的惯性补齐结束；正常结束沿用 RN，不增加超时或页面点击补救。

折叠过程卡片前，`releaseFocus` 在主线程释放当前只读文字选区，同时阻止根窗口自动选择下一个焦点。完成后恢复窗口原有的焦点策略，再由 UI 卸载正文。编辑输入不属于此操作。

这是原生模块变更，应用需要在下一次明确授权的 APK 构建后安装更新；Metro 热更新不能增加原生视图或模块。

局部验证：`android/gradlew.bat :native-text-selection:testDebugUnitTest`，不构建 APK。
