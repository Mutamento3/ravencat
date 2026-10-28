# 原生持续通话契约与设备验收

当前入口与产品行为见 [Calls README](../../src/features/calls/README.md)，回合与持久事实见[通话架构](architecture.md)。本文只定义原生执行、媒体与系统展示边界，不记录逐次修复过程。

## 执行与业务真值

```text
Calls Repository commit
→ Android CallExecutionService
→ Host CallExecutionHeadlessTask
→ ensureHostDatabaseReady（恢复门 + 普通 SQLite bootstrap）
→ 唯一 CallMediaRuntime
→ ASR / AI 回复 / TTS / lookAtUser
→ Calls 终态 + 资源释放 + Headless completion
```

- Calls Repository 是唯一业务真值；原生 service 只拥有一次通话的执行与媒体生命周期。
- React provider/页面只展示，卸载、导航或切后台不停止通话，不再创建第二份相机/录音 owner。
- 来电响铃时，原生通知模块在主线程读取 React 的前台 Activity；应用在前台时直接展示同一个 `IncomingCallActivity`，后台/锁屏由 CallStyle 与 FullScreenIntent 交给系统展示。前台不能依赖系统一定执行 FSI，也不新增 React 来电页；通知点击与前台展示共用入口及动作链路。
- 响铃通知没有 FGS 执行期，CallStyle 发布必须携带 FullScreenIntent，前台直接展示也不能移除。`canUseFullScreenIntent()` 只记录系统展示能力；用户禁用全屏时由 Android 将请求转为通知。系统和前台指向同一个 singleTop 来电 Activity，不创建第二套页面。
- 来电拒接 Headless 共用 Host 启动门；Feature/Repository 不重复初始化数据库。
- 恢复先按 callId 查询原生宿主，存活的执行不被错误结算为孤儿；另一通电话的宿主不能保护本电话。
- 数据库已终态时重复挂断仍走资源释放，并完成该通电话的 Headless 等待；保留首次结束原因、时间、状态记录和一次性跟进。
- 终态页面立即退出，资源释放仍由 Headless 等待；App 内按本次进入前的页面返回，来自桌面或其他应用时由原生将任务退后，不主动拉起 RavenCat 或其他应用。主界面可见性由 Application 生命周期记录，来电壳自身不计入前台来源；来电接听与小窗每次拉起共同更新 `android-overlay-runtime` 的一次性展示来源。

## 媒体与 Telecom

- CameraX 采集、截帧与 surface 属于通话 service；主线程 API 在主线程调用。
- Core-Telecom endpoint 是实际音频设备的唯一来源，不并行维护 AudioManager 路由 owner。
- `CallTelecomSession` 持有系统注册、音频激活与断开的寿命。激活整体限时 30 秒；注册失败、激活失败、端点不再回调或音频观察失败时，由原生直接结束会话，不等待 JS 收口才断开系统通话。
- 通话终态的原生音频释放与 Headless 最终释放共用同一次结束结果。注册中挂断仍等待返回句柄并断开；断开与会话退出整体限时 10 秒，不重试。只有系统确认断开或已不再跟踪该通话时才算成功；服务销毁不会把断开失败改成成功，新通话必须等待旧宿主的释放结果。
- 语音识别与 TTS 使用 Speech 的模型和厂商文本契约；Calls 冻结本轮模型，播放队列不再次解析模型句子。
- 终态停止 ASR、录音、相机、合成与播放，关闭窗口和持续通知，再释放本次执行。
- React bridge 销毁按 ReactContext 隔离旧/新实例，清理独立于已取消 scope，不能被线程异常截断。

## 唯一小窗与字幕

小窗为 112×150 竖向区域。相机开启后通话页、其他页面和 App 后台保留同一个窗口、位置与 surface；AI 头像与相机占同一区域，不再挂第二个 React 预览。头像只读取一次供小窗/通知共享，通话背景独立管理。

小窗和返回来源共用 Application 的主界面 Started/Stopped 可见性；系统麦克风/相机权限窗口只触发 Pause 时，主界面仍可见，不得创建后台头像小窗。React bridge 的 Resume/Pause 不作为另一份展示可见性真值，模块销毁时释放可见性订阅。

单击无动作，完整双击松手返回通话页；超过系统 touch slop 即拖动并取消双击，不等长按。窗口使用完整屏幕坐标，不裁状态栏、挖孔或键盘区域。镜头翻转在通话页，挂断由通话页或持续通知执行。

双击恢复时，React 内容和背景就绪后，实际通话页原地淡入，头像小窗在原位置同步淡出；路由激活不等于页面已经显示，真实页面完整绘制后才移除头像小窗。系统窗口的坐标和尺寸在整个交接中保持不变，相机预览不淡出、不被截图或搬到 React 页面；过渡不使用页面快照、头像位移或窗口扩缩。中途切后台、页面退场、相机模式变化、权限撤销或挂断都结束过渡，晚到透明度和绘制回调不得影响后一次恢复。

歌词流来自已提交用户文本及逐句正式 TTS 播放事实，保留历史、自动贴底，翻历史时停止跟随；不靠模型整轮结束或轮询才显示字幕。

通话期间持有共享可见性抑制隐藏普通悬浮球，结束后按原规则恢复，不停止独立 Companion/Floating 业务。通知诊断只读，不能在查询状态时创建或删除通道。

## 必须单独验收的设备行为

- Android 13+ 前台、Home、锁屏、进程/React 重载与再次拨号；正常后台不产生虚假故障记录。
- 麦克风/相机/悬浮权限与服务启动准入、权限撤销后的终态和资源释放。
- 解锁并停留在应用内收到 AI 来电时，接听/拒接界面直接出现；切后台及锁屏时沿系统通知展示，同一通电话不重复打开两份来电页。
- 听筒、扬声器、蓝牙/有线耳机实际 endpoint 变化、TTS 与 ASR 打断。
- 前后置画面方向；页面/前后台切换的 CameraX 连续性、同一窗口身份和位置。
- 摄像头开启/关闭时分别从 App 内其他页及其他 App 双击恢复；自定义背景加载、原地淡入淡出和快速返回，窗口不跳位、不扩缩，无提前消失的小窗。真实流畅度及 Activity 拉起期间的系统画面仍须真机确认。
- 单击、双击、立即拖动、第二击转拖动与完整屏幕边缘，尤其 vivo/OEM 触摸表现。
- 重复挂断和旧终态残留：摄像头、窗口、通知退出，不拉起 App 等待清理。
- 激活期间挂断、端点迟到/不回调、系统拒绝断开，以及失败后再次来电/去电；确认没有遗留系统 CONNECTING 通话，正常蜂窝电话不受阻塞。单元测试不替代这些 OEM 系统行为。
- 聊天页发起后收起，切换到设置或其他 App 页面，再通过小窗进入并收起/挂断：返回本次来源页及参数；同次展示的 Activity 重建保留来源。分别从桌面和其他应用经小窗进入，退出恢复之前的系统任务；再从 App 内进入时，不继承前一次 App 外来源。
- 字幕早于整轮完成、连续句追加、翻历史、晚到查询与事件去重。
- OEM 持续通知头像与通道，模型跟进失败不影响已完成挂断。

`verify:calls`、定向 Kotlin 编译和原生单元测试保护业务与生命周期边界；不能替代以上设备行为。后台/锁屏、CameraX 方向、路由和 OEM 展示仍需独立真机证据，不从实现存在推导已经验收。

## 平台依据

- [Core-Telecom](https://developer.android.com/develop/connectivity/telecom/voip-app/telecom)：系统通话与 endpoint。
- [CameraX Preview](https://developer.android.com/reference/androidx/camera/core/Preview)：主线程 surface API。
- [GestureDetector](https://developer.android.com/reference/android/view/GestureDetector.SimpleOnGestureListener)：双击与移动事件。
- [WindowManager.LayoutParams](https://developer.android.com/reference/android/view/WindowManager.LayoutParams)：窗口坐标和系统边界。
- [前台服务类型](https://developer.android.com/develop/background-work/services/fgs/service-types)：实际媒体类型与授权准入。
