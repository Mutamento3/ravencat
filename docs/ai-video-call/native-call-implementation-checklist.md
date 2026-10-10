# 原生持续通话契约与设备验收

当前入口与产品行为见 [Calls README](../../src/features/calls/README.md)，回合与持久事实见[通话架构](architecture.md)。本文只定义原生执行、媒体与系统展示边界，不记录逐次修复过程。

## 执行与业务真值

```text
Calls Repository commit
→ Android CallExecutionService
→ Host CallExecutionHeadlessTask
→ ensureCallHostReady（恢复门 + 普通 SQLite bootstrap）
→ 唯一 CallMediaRuntime
→ ASR / AI 回复 / TTS / lookAtUser
→ Calls 终态 + 资源释放 + Headless completion
```

- Calls Repository 是唯一业务真值；原生 service 只拥有一次通话的执行与媒体生命周期。
- React provider/页面只展示，卸载、导航或切后台不停止通话，不再创建第二份相机/录音 owner。
- 来电拒接 Headless 共用 Host 启动门；Feature/Repository 不重复初始化数据库。
- 恢复先按 callId 查询原生宿主，存活的执行不被错误结算为孤儿；另一通电话的宿主不能保护本电话。
- 数据库已终态时重复挂断仍走资源释放，并完成该通电话的 Headless 等待；保留首次结束原因、时间、状态记录和一次性跟进。

## 媒体与 Telecom

- CameraX 采集、截帧与 surface 属于通话 service；主线程 API 在主线程调用。
- Core-Telecom endpoint 是实际音频设备的唯一来源，不并行维护 AudioManager 路由 owner。
- 语音识别与 TTS 使用 Speech 的模型和厂商文本契约；Calls 冻结本轮模型，播放队列不再次解析模型句子。
- 终态停止 ASR、录音、相机、合成与播放，关闭窗口和持续通知，再释放本次执行。
- React bridge 销毁按 ReactContext 隔离旧/新实例，清理独立于已取消 scope，不能被线程异常截断。

## 唯一小窗与字幕

小窗为 112×150 竖向区域。相机开启后通话页、其他页面和 App 后台保留同一个窗口、位置与 surface；AI 头像与相机占同一区域，不再挂第二个 React 预览。头像只读取一次供小窗/通知共享，通话背景独立管理。

单击无动作，完整双击松手返回通话页；超过系统 touch slop 即拖动并取消双击，不等长按。窗口使用完整屏幕坐标，不裁状态栏、挖孔或键盘区域。镜头翻转在通话页，挂断由通话页或持续通知执行。

歌词流来自已提交用户文本及逐句正式 TTS 播放事实，保留历史、自动贴底，翻历史时停止跟随；不靠模型整轮结束或轮询才显示字幕。

通话期间持有共享可见性抑制隐藏普通悬浮球，结束后按原规则恢复，不停止独立 Companion/Floating 业务。通知诊断只读，不能在查询状态时创建或删除通道。

## 必须单独验收的设备行为

- Android 13+ 前台、Home、锁屏、进程/React 重载与再次拨号；正常后台不产生虚假故障记录。
- 麦克风/相机/悬浮权限与服务启动准入、权限撤销后的终态和资源释放。
- 听筒、扬声器、蓝牙/有线耳机实际 endpoint 变化、TTS 与 ASR 打断。
- 前后置画面方向；页面/前后台切换的 CameraX 连续性、同一窗口身份和位置。
- 单击、双击、立即拖动、第二击转拖动与完整屏幕边缘，尤其 vivo/OEM 触摸表现。
- 重复挂断和旧终态残留：摄像头、窗口、通知退出，不拉起 App 等待清理。
- 字幕早于整轮完成、连续句追加、翻历史、晚到查询与事件去重。
- OEM 持续通知头像与通道，模型跟进失败不影响已完成挂断。

`verify:calls`、定向 Kotlin 编译和原生单元测试保护业务与生命周期边界；不能替代以上设备行为。后台/锁屏、CameraX 方向、路由和 OEM 展示仍需独立真机证据，不从实现存在推导已经验收。

## 平台依据

- [Core-Telecom](https://developer.android.com/develop/connectivity/telecom/voip-app/telecom)：系统通话与 endpoint。
- [CameraX Preview](https://developer.android.com/reference/androidx/camera/core/Preview)：主线程 surface API。
- [GestureDetector](https://developer.android.com/reference/android/view/GestureDetector.SimpleOnGestureListener)：双击与移动事件。
- [WindowManager.LayoutParams](https://developer.android.com/reference/android/view/WindowManager.LayoutParams)：窗口坐标和系统边界。
- [前台服务类型](https://developer.android.com/develop/background-work/services/fgs/service-types)：实际媒体类型与授权准入。
