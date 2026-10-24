# 原生文字选择

Android 只读文字选择会取得焦点；RN 的 `ReactScrollView.requestChildFocus` 随后主动滚动整个文字块。`SelectionScrollView` 继承 RN 的原生滚动实现，在显式启用文字选择策略后，只在触摸选择只读文字的焦点调用期间阻止滚动；用户手势、JS 滚动命令、编辑输入和硬件焦点导航保持原有语义。

`NativeTextSelectionPackage` 通过 Expo 本地模块发现注册规范名称 `ScrollView` 的 RN ViewManager。`@platform/device` 的 `TextSelectionScrollView` 复用 RN JS ScrollView，通过 postinstall 开放的原生组件插槽使用该身份，并传入 `textSelectionEnabled=true`。聊天外层列表与过程卡片的内层滚动使用此适配。

原生组件身份是跨 Kotlin 与 Fabric 的契约：必须命中内置 `ScrollViewShadowNode`，由其根据 `contentOffset` 把内容坐标转换为屏幕坐标。不能改成独立名称的 legacy interop View；只继承 Kotlin `ReactScrollView` 不会自动获得 Fabric 的滚动语义。真机曾测得屏幕触点 Y≈703，而同一控件 `measure` 的 Y=3275；MOVE 到来后，Pressability 会把实际仍在控件内的触点判为越界，造成短按和长按偶发失效。

Android Fabric 挂载时优先按规范名称 `ScrollView` 找管理器，再尝试 `RCTScrollView`。因此普通 RN 竖向滚动也可能由这个管理器创建；`textSelectionEnabled` 默认 false，普通滚动不启用焦点拦截或惯性补齐，仍执行 RN 原始语义。不要把聊天专用策略变成管理器的默认行为，也不要通过扩大 pressRetentionOffset 修补坐标。

RN 0.81 在触摸打断惯性时会取消结束检测，却不配对发送惯性结束事件，JS ScrollView 随后可能一直认为仍在滚动并截走子控件点击。启用文字选择策略的适配监听当前原生视图真实发出的惯性开始／结束，只在已接收的按下事件中为被打断的惯性补齐结束；正常结束沿用 RN，不增加超时或页面点击补救。

折叠过程卡片前，`releaseFocus` 在主线程释放当前只读文字选区，同时阻止根窗口自动选择下一个焦点。完成后恢复窗口原有的焦点策略，再由 UI 卸载正文。编辑输入不属于此操作。

这是原生模块变更，应用需要在下一次明确授权的 APK 构建后安装更新；Metro 热更新不能增加原生视图或模块。

局部验证：`android/gradlew.bat :native-text-selection:testDebugUnitTest` 与 `npm run verify:chat-touch-coordinates`，不构建 APK。后者使用真实 RN Pressability 复现坐标错位时“无 MOVE 成功、有 MOVE 取消”，并验证正确屏幕坐标下的短按与长按。

修复后的安装包已通过真机回归：静止点击、快速滚动并触摸按停后的点击、键盘打开时的操作，以及思维链正文选择／复制后收起，均正常。临时触摸追踪、测量日志及 JS 心跳已移除。
