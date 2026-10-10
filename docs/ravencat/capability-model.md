# RavenCat Capability Model

> 本文描述当前产品能力与代码所有权。
>
> 本文只回答一件事：RavenCat 中哪些是用户功能，哪些是底层能力，以及谁可以依赖谁。

## 1. 为什么需要这份文档

RavenCat 早期把“本地伴随”同时承载为：

- 悬浮球与悬浮层；
- AI 主动联系；
- 后台唤醒与恢复；
- Accessibility；
- Usage Access；
- 电池优化与后台运行设置；
- 屏幕截图与问屏能力。

这些能力历史上一起出现，不代表它们属于同一个产品功能。

继续以“本地伴随”作为总开关或总模块，会造成三个问题：

1. 用户为了使用一个无关能力，被迫开启主动联系；
2. 某个 Feature 被迫拥有自己不该拥有的系统权限；
3. 原生模块因为承载多个生命周期而不断膨胀。

本设计把“功能语义”和“平台能力”分开。

## 2. 产品功能

### 2.1 Floating Interaction / 悬浮交互

用户语义：

> 我即使停留在其他 App，也能快速找到 RavenCat、聊天，并主动把当前页面交给 AI。

它包括：

- 悬浮球及其变形体；
- 展开/收起悬浮层；
- 快捷聊天入口；
- Extract；
- Shot；
- 悬浮窗样式、位置、贴边和休眠行为；
- 作为用户可见的后台宿主存活指示。

它不包括：

- AI 是否允许主动联系用户；
- 主动伴随的 AI 日程自主执行生命周期；
- WorkManager/Alarm 驱动的主动唤醒语义；
- Accessibility 授权所有权；
- 通知、Usage Access、电池白名单等权限管理本身；
- Soft App Lock 等设备控制动作。

### 2.2 Proactive Companion / 主动伴随

主动伴随允许主理 AI 在用户没有新输入时，通过唯一 AI 日程获得一次正常自主执行机会。用户提醒和 AI 自主安排共用日程事实、工具、keyed 投影、claim 与 runner 终态回执；Self Wake 独立链已经退役。

它拥有开关、日程与活动状态、软勿扰上下文和有界执行期，不预生成联系配额或 contact/defer 决策。AI 可以不发消息；日程不授予额外工具权限。当前契约见[主动伴随](proactive-companion.md)和[AI 日程](ai-schedule.md)。

它不要求悬浮窗、Accessibility 或看屏权限，不拥有 Soft Lock、系统授权或 Overlay FGS。需要观察/动作时只消费所属 owner 的已授权能力。

## 3. 代码能力与系统抽象

### 3.1 Device Observer

Device Observer 是代码能力，不是必须单独暴露给用户的一级产品功能。它的业务代码归 `src/features/deviceControl`；AccessibilityService 等 Android 实现仍位于 `modules/device-observer`。native implementation 的物理位置不改变 Feature ownership。

它负责提供设备当前状态事实，例如：

- 当前前台 package/window；
- Accessibility service 的连接状态与能力；
- 当前页面语义提取；
- 原生截图事实与临时文件；
- 已安装应用等设备事实。

Device Observer 不应决定：

- AI 是否可以主动联系；
- 某个页面是否应显示一个按钮；
- 某个 Feature 是否开启；
- 某条 RavenCat 业务 route 应如何回退；
- 是否应该锁住某个 App；
- 是否应该执行 Home / Back 等设备动作。

它返回事实和明确的能力状态，业务层根据策略决定如何使用。

### 3.2 Screen Capture

Screen Capture 的业务代码归 `src/features/screenCapture`。它负责：

- 当前窗口安全检查；
- 调用 Device Observer 提供的 native screenshot primitive；
- native cache 生命周期。

它不拥有 Companion 截图策略，也不决定何时、为何截图或截图如何进入主动上下文与 Chat attachment。这些业务编排归 `src/features/companion`。

### 3.3 System Access

System Access 是对 Android 系统访问能力的统一抽象。

它统一描述：

- 当前状态；
- 是否可检测；
- 是否可直接 request；
- 是否必须打开系统设置；
- 是否依赖 OEM；
- 是否需要用户手动确认；
- 如何刷新状态。

它不是一个“万能权限 Manager”。它不理解 RavenCat 的业务开关，也不执行 Soft Lock 等业务动作。

### 3.4 Device Control

Device Control 是受控设备动作能力，业务代码归 `src/features/deviceControl`。Device Observer、Device Control 与 Soft Lock 在同一 Feature 内保持窄 contract；Device Control 仍只执行，不替 Companion 或其他调用方做业务决策。

它回答的是：

> 在调用方已经做出业务决定，并且系统能力与用户授权满足要求后，RavenCat 能否安全地执行某个设备动作？

当前包含 Soft App Lock、精确 package 的应用打开、受控 URI dispatch 与 MediaSession 观察/控制。工具与授权规则见[手机工具](phone-tools.md)。

Soft Lock 的核心语义：

- 指定 package 在前台时显示完全不透明、可触摸的 blocking overlay（当前为 TYPE_APPLICATION_OVERLAY）；
- 阻断用户继续操作下面的目标 App；
- 不 force-stop、不 root、不冻结第三方进程；
- 离开目标 App 后自动撤销 Overlay；
- 锁仍有效时再次进入目标 App，重新显示 Overlay；
- 始终提供明确的退出路径；
- 遮盖不等于暂停目标媒体；媒体控制属于独立 exact-package MediaSession 能力；
- runtime 状态不确定时 fail open，优先恢复用户控制。

Device Control 不应决定：

- 用户是否“该睡觉”；
- 某个 App 是否值得锁；
- AI 是否应该在此刻介入；
- 是否应该主动给用户发消息；
- 当前前台 package 是什么事实源。

这些分别属于 Feature / AI Runtime / Device Observer。

Device Control 也不得直接写 ChatMessage 或拥有 AI 消息通知语义。一次 AI 行动可以在 application orchestration 层同时调用 Device Control 和正常消息投递，从而实现“Soft Lock Overlay 出现 + AI 消息通知/震动”的体验，但两条底层链路必须保持独立 ownership。

详细设计见：

```text
docs/ravencat/device-control.md
```

## 4. 功能与能力的依赖图

```text
                    ┌──────────────────────┐
                    │  Floating Interaction │
                    └──────────┬───────────┘
                               │
                     uses when needed
                               │
                     ┌─────────▼─────────┐
                     │ Device Observer /  │
                     │   Screen Capture   │
                     └─────────┬─────────┘
                               │ system state
                               ▼
                     ┌───────────────────┐
                     │   System Access    │
                     └───────────────────┘

                    ┌──────────────────────┐
                    │ Proactive Companion  │
                    └──────────┬───────────┘
                               │
                      optional dependency
                               │
                               └────────────> Device Observer / Screen Capture

                    ┌──────────────────────┐
                    │ AI Tool / Feature     │
                    └──────────┬───────────┘
                               │
                         requests action
                               │
                     ┌─────────▼─────────┐
                     │   Device Control   │
                     └───────────────────┘
```

注意：图中“uses / requests”表示消费能力，不表示生命周期所有权。

Device Control 可以消费同 Feature 内 Device Observer 的当前前台 App 事实，也可以查询 System Access 的 required capability，但不得反向拥有这些状态源。Screen Capture 可以消费 Device Observer 的原生截图事实，但不反向拥有 Device Observer 生命周期。

## 5. 开关语义

必须存在互相独立的状态：

```ts
floatingInteractionEnabled: boolean
proactiveCompanionEnabled: boolean
```

Device Observer 不使用一个对应的用户级总开关来代表 Accessibility 是否授权。

Device Control 也不应使用一个“开启后允许 AI 控制全部手机”的模糊总开关替代细粒度授权。高影响动作必须有明确产品设置和本地 authorization gate。

系统能力状态应独立表达，例如：

```ts
type SystemCapabilityState =
  | 'granted'
  | 'denied'
  | 'restricted'
  | 'unsupported'
  | 'unknown';
```

对于具有连接态的能力，还应额外表达 runtime 状态，例如 Accessibility：

```ts
type AccessibilityRuntimeState = {
  enabled: boolean;
  connected: boolean;
  canRetrieveWindowContent: boolean;
  canTakeScreenshot: boolean;
};
```

不要把 `enabled` 与 `connected` 压缩成一个 boolean。

## 6. 允许的用户组合

以下组合全部合法：

```text
A.
悬浮窗 ON
主动伴随 OFF
Accessibility ON

=> 用户可以随时通过悬浮窗主动聊天、Extract、Shot，AI 不会自行来找用户。
```

```text
B.
悬浮窗 OFF
主动伴随 ON
Accessibility OFF

=> AI 可以通过不需要屏幕观察的 route 主动联系，屏幕观察相关 route 不可用。
```

```text
C.
悬浮窗 OFF
主动伴随 ON
Accessibility ON

=> 没有悬浮球，但允许主动联系，且在对应策略允许时可以读取当前页面语义。
```

```text
D.
悬浮窗 ON
主动伴随 ON
Accessibility OFF

=> 悬浮聊天和普通主动联系都可用，Extract 不可用。
```

```text
E.
悬浮窗 OFF
主动伴随 OFF
Accessibility ON
Soft Lock authorization ON

=> 用户可以完全不使用悬浮球和主动伴随，但显式触发/测试 Device Control 仍可以工作。
```

任何实现都不得把这些合法组合误判为“状态异常”。

## 7. Feature 依赖声明

Feature 负责声明自己需要的系统能力。

以下是职责说明的概念表示，不是当前已实现的 TypeScript API：

```ts
type FeatureCapabilityRequirement = {
  capability: SystemCapabilityId;
  level: 'required' | 'optional';
  reason: string;
};
```

例如：

```text
floating interaction
required: overlay

extract
required: accessibility

shot
required: accessibility screenshot capability

proactive companion basic messaging
required/optional according to Android version and delivery path: notifications/background execution

screen-aware proactive route
required: accessibility

soft app lock
required: overlay permission + reliable connected Device Observer
exit: Home Intent（不解除业务锁）
media: 独立 MediaSession 动作，不由 Soft Lock 自动触发
```

权限中心不应该反向写：

```ts
if (proactiveCompanionEnabled) { ... }
```

Device Control 也不应该反向写：

```ts
if (currentPackage === 'com.xingin.xhs') lockBecauseUserShouldSleep();
```

如果出现这种代码，说明依赖方向反了：平台层开始偷偷做业务决策。

## 8. 生命周期所有权

### Floating Interaction owns

- 业务代码 `src/features/floatingLayer`；
- Overlay Service（`RavenCatOverlayService`）的启动/停止；
- Overlay foreground service 生命周期与它的通知；
- Overlay UI runtime；
- 悬浮窗位置、形态、交互状态；
- 从悬浮 UI 发起的即时操作。

### Proactive Companion owns

- 业务代码 `src/features/companion`；
- 当前 self wake 与主动活动事实；
- 主动唤醒任务（Alarm / WorkManager projection）；
- boot/time/timezone/package replace 后未消费 wake 的恢复；
- 主动联系 runtime 的开始/停止；
- **一次 wake 的后台执行宿主**：包括它自己的执行生命周期，以及执行期按需建立、执行结束立即释放的有界前台执行。

### 8.1 Overlay FGS 与 Companion execution 的所有权边界

`RavenCatOverlayService` 是 Floating Interaction 的 foreground service。它的存在只表示「用户开启了悬浮交互且悬浮 UI 在运行」。

不变量：

```text
Overlay FGS owner
= Floating Interaction

Companion execution foreground owner
= Proactive Companion 的一次 wake 执行
```

因此：

- Proactive Companion 不拥有 Overlay FGS，也不得依赖它的存在；
- Overlay FGS 存在与否不得改变 Companion 的 correctness：调度、claim、Agent run、消息 commit 与通知交付在两个组合下必须等价；
- Companion 如果需要 foreground execution，它只能是**一次任务的 bounded execution lifetime**（随该次 wake 的执行开始、随该次执行终态结束），不能是产品开关（`proactiveCompanionEnabled`）的 lifetime；
- 禁止用「进程恰好因为 Overlay FGS 而更容易存活」当作 wake 成功的必要条件。

正式发布必须支持且必须独立可用的组合：

```text
Floating Interaction OFF
Proactive Companion ON

=> 没有悬浮球、没有 Overlay FGS，AI 日程 仍必须在后台完成，
   主动消息仍能正常生成、落库并发系统通知。
```

### Device Observer owns

- `src/features/deviceControl` 中的设备观察 contract 与 adapter；
- AccessibilityService 实例和连接态；
- 当前窗口事实；
- semantic extraction；
- screenshot native capture primitive；
- Device Observer 自身诊断。

### Screen Capture owns

- 业务代码 `src/features/screenCapture`；
- 当前窗口安全检查；
- screenshot capture 调用；
- native cache 释放。

Screen Capture 不拥有 Companion 的截图时机、理由、主动上下文或 Chat attachment 生命周期。

### Device Control owns

- 业务代码 `src/features/deviceControl`；
- Device Control action contract；
- Soft Lock active/released/expired 等动作状态；
- Soft Lock Overlay attach/detach 执行；
- target package 匹配后的阻断生命周期；
- exit action；
- best-effort media pause action result；
- action diagnostics / trace；
- fail-open cleanup。

Device Control 不拥有：

- 当前 package 的事实源；
- Accessibility 授权真值；
- AI 是否应该调用动作的业务策略；
- Chat message persistence；
- AI message notification delivery。

### System Access owns

- 权限/特殊访问状态读取；
- request/open-settings 能力；
- OEM-specific guidance 的事实适配；
- 状态刷新。

## 9. 当前代码与原生模块边界

业务 Feature 已按真实职责拆分：

```text
src/features/
├─ companion/
├─ deviceControl/
├─ floatingLayer/
└─ screenCapture/
```

底层 native/platform implementation 可以位于 `modules/device-observer`、`modules/device-control`、`modules/ravencat-floating-layer` 与 `modules/android-overlay-runtime`。其中保留的 RavenCat native 名称属于品牌或兼容标识，不表示重新建立 RavenCat 业务 Feature；跨 Feature 连接只由 Host composition 完成。

## 10. 反例

以下设计应被 Review 阻止：

```text
关闭主动伴随
→ stop overlay
→ revoke/disable accessibility
→ cancel unrelated user-triggered screen features
```

```text
权限页面
→ 根据业务状态决定某个 Feature 是否启用
```

```text
FloatingLayerModule
→ 同时拥有 Overlay、主动 wake、Accessibility、Usage Access、设备观察、AI route
```

```text
DeviceObserver
→ 自己决定“当前页面不值得给 AI 看”
```

```text
DeviceObserver
→ lockApp()
```

```text
DeviceControl
→ 当前打开小红书
→ 自己判断用户违反睡觉约定
→ 自动锁
```

```text
DeviceControl
→ 插入 ChatMessage
→ 自己发 AI 通知
```

底层可以返回事实，例如 `no_text`、`self_app`、`protected_app`、`action_unavailable`、`media_pause_unsupported`；是否继续截图、取消某条业务 route、锁某个 App 或发送消息，应由调用方策略 / application orchestration 决定。

## 11. Review Gate

后续改动如果触及以上边界，Review 时至少回答：

- 这项状态是谁拥有的？
- 关闭某个 Feature 是否误伤了另一个 Feature？
- 这是用户功能、观察能力、设备动作，还是系统访问能力？
- 当前层是在返回事实、执行已经决定的动作，还是偷偷做业务决策？
- Device Observer 是否仍然保持 read / observe 边界？
- Device Control 是否开始拥有 Chat / Notification / AI decision？
- Soft Lock 异常时是否 fail open？
- 是否因为现有文件恰好在某个 module 中，就误把它当成该 module 的职责？

无法明确回答时，不应继续扩展实现。
