# RavenCat Device Control 当前契约

Device Observer 提供只读设备事实，Device Control 执行受控动作，两者的业务所有权均在 `src/features/deviceControl`。Android 实现在 `modules/device-observer`、`modules/device-control`；窗口 primitive 在 `modules/android-overlay-runtime`。复用原生能力不改变业务所有权。

## 1. 范围与调用边界

当前支持 Soft App Lock、精确 package 的应用打开、受控 URI dispatch 与精确 package 的 MediaSession 观察/控制。工具目录、Protected Apps 与主理 AI 身份准入见[手机工具](phone-tools.md)。

Device Control 不决定何时介入，不拥有 AI 日程、ChatMessage 或消息通知。调用方经 AI Tool 请求动作；消息仍走正常 Chat 提交与交付链。授予系统权限不等于授予某个 AI 业务动作权限。

不 force-stop、冻结或修改第三方 App；产品执行不使用 root、Shizuku、adb。小红书文字笔记通过既有无障碍服务，按已采集页面布局执行区域点击、样式滑动和文字输入，不向模型开放通用坐标操作。业务准入由 Phone Tools 持有，原生页面适配见[小红书文字笔记](xiaohongshu-text-note.md)。

## 2. Soft Lock 的业务事实

`domain/SoftAppLock.ts` 定义锁的 ID、目标 package、来源、发起 AI、原因、创建/到期时间与 `active / released / expired / failed` 状态。SQLite Repository 经 `databaseCoordinator` 维护唯一业务真值。

AI 锁必须有明确持续时间。同一 AI、同一目标的 active 锁由 Repository 原子裁决：已有锁返回原事实，不因重复调用延长锁；释放只作用于该 AI 自己为该目标创建的 active 锁。到期判断既影响 active 查询，也由原生执行期调度解除窗口，不能依赖 JS 页面仍存活。

```text
主理 AI 身份与 Protected Apps action admission
→ Repository 原子创建/取得业务锁
→ commit
→ 启动并同步原生 active 投影
→ 返回业务事实与实际执行事实
```

业务 `active` 不等于窗口已经附着。`SoftLockExecutionTruth.ts` 将当前原生状态区分为 `blocking_now`、`waiting_for_target` 和带 issue 的 `activated_but_not_executing`。后台启动受限、观察不可用、窗口不可靠、权限缺失或同步失败不能包装为已经阻断，也不能反推业务锁已释放。

App 不提供独立工程测试页或手动测试锁入口。`manual_test` 仅保留历史读取契约；升级迁移释放存量 active 测试锁，保留历史终态与 AI 锁。

## 3. 窗口与前台事实

Soft Lock 消费 Device Observer 的前台窗口事实，不建立第二套当前 App 模型。当前 `SoftLockController` 只有在 observer 已连接、窗口可靠且 package 匹配未到期 active 投影时允许阻断。

当前 Android adapter 使用 `TYPE_APPLICATION_OVERLAY`，复用共享窗口 primitive；不是 Accessibility Overlay。窗口完全不透明、可触摸，覆盖可交互区域，阻止下层普通触摸。目标 App 的进程、媒体与画面仍可继续运行，盖屏不等于系统暂停。

离开目标 App 后移除窗口；锁仍有效时重入重新显示。当前阻断页统一为 `SoftLockView`，显示 RavenCat 身份、暂时锁定说明与“退出应用”。退出使用 Home Intent 回桌面，不解除业务锁；旧自定义 HTML 不再加载，也不参与新备份或恢复激活。

`projectedLocks` 是业务事实的瞬时投影，`attached / attachedLockId / overlayStatus` 是实际窗口事实，diagnostics 是观察结果，三者不能混为一谈。

## 4. Fail-open 与生命周期

原生窗口添加失败、观察断连、窗口不可靠、没有匹配目标、锁到期或 runtime 清理时，应移除窗口或拒绝新建窗口，恢复用户控制。不得在事实不确定时继续全屏阻断，也不得通过连续自动点击兜底。

当前核心执行依赖 Overlay 授权与已连接、可靠的 Device Observer。退出按钮使用 Home Intent，不需要额外的 Accessibility global-action 路径；不能从一般能力设计推断当前已经支持其他观察来源。

Soft Lock 不依赖 Floating Interaction 开关或悬浮球是否存在，拥有独立业务锁与执行生命周期。关闭悬浮球不等于解除锁。Factory reset 只清 App 自有业务状态和原生执行，不撤销 Android 系统授权。

## 5. 媒体与声音

当前 Soft Lock 不自动暂停媒体，不修改系统音量，也没有独立的 `SoftLockMediaResult` 返回协议。遮盖目标 App 不能保证它停止播放。

媒体控制由独立 exact-package MediaSession 能力处理：精确目标、真实控制器与 capability 返回值由原生边界负责。不能把一次 dispatch 成功说成媒体已经播放/暂停，不能因为目标不可控而发送全局媒体按键或控制其他 App。相关工具见[手机工具](phone-tools.md)。

## 6. 与 AI 日程、消息和悬浮交互的关系

AI 日程只提供一次自主决策机会；触发日程不直接等价于锁 App。AI 读取当前上下文后，按授权决定是否调用设备工具。Device Control 不持有调度语义。

一次 AI 执行可以先调用 Soft Lock，再正常发送消息；业务动作与 assistant 消息有各自提交事实，设备控制不得偷偷写消息或实现第二套通知系统。

## 7. 验收边界

- actor + target 的原子创建、重复调用与释放所有权；
- 目标前台时阻断、退出桌面、离开/重入与到期移除；
- observer 断连、不可靠窗口、权限撤销与原生执行失败的 fail-open；
- 业务 active 与实际执行事实分别返回；
- Floating Interaction 关闭时设备动作仍保持独立；
- Protected Apps 阻止新动作，但不阻止撤销已有影响。

业务与原生自动化验证不能代替 Android 设备上的窗口覆盖、安全区域、Home Intent、后台启动与 OEM 生命周期验收。
