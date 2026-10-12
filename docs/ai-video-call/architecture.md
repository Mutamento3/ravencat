# AI 通话当前架构

Calls 是独立的实时交互域，拥有通话状态、转写、媒体事件和原生执行期，不是聊天页的资源 hook。入口见 [Calls README](../../src/features/calls/README.md)，原生生命周期与设备验收见[原生通话契约](native-call-implementation-checklist.md)。

## 1. 所有权

| 所有者 | 职责 |
| --- | --- |
| Calls domain / Repository | 会话、事件、状态转换、并发与持久真值 |
| Calls application/runtime | 拨号/来电/接听/拒接/挂断、回复回合与媒体编排 |
| Speech | STT/TTS 提供方、文本与模型契约 |
| Chat | 可见通话记录、统一上下文投影与摘要提交 |
| Host | 跨 Feature 模型/Prompt/通知装配、bootstrap 与 Headless |
| Android CallExecutionService | 本次通话的执行、CameraX、唯一窗口和系统媒体生命周期 |
| Core-Telecom | 实际音频 endpoint 与系统通话控制 |
| Presentation | 当前状态、歌词、按钮与导航意图，不拥有执行和媒体 |

SQL 留在 Calls infrastructure，经 databaseCoordinator 执行。UI 与工具不直接写 Repository 或弹页面；业务 command 提交后，Host/App 适配导航和原生动作。只支持 Android 13+。

## 2. 产品入口与呼叫

用户从 Chat 工具面板发起呼叫。预检检查模型、当前所需语音/系统能力和并发条件；通过后去电决策使用角色当前人设及聊天上下文，决定接听/拒绝，接听结果带入开场话语。拒绝理由作为普通 AI 消息，通话状态作为独立记录。

AI 通过 `requestVideoCall` 请求来电；来电本身是邀请，用户接听/拒绝完成真实交互，不再弹通用 Agent 确认。无人接听按 ringing timeout 结算 missed，不解释为用户主动挂断。

aiTool 来源拒接/未接后的即时 AI 跟进、每 AI 可选通话设置和定时自动截帧不属于当前已实现契约。用户结束已接通通话的既有跟进仍严格解析 JSON，send_message/stay_silent；非法输出不交付，失败不反转挂断或阻塞清理。

## 3. 持久事实与 Chat 上下文

`call_sessions` 与 `call_events` 保存原始通话事实，Chat messages 只保存可见状态记录与应交付的 AI 消息。通话不保存原始音频；实时识别/合成产生的临时文件按媒体生命周期清理。

已接通电话终态只保留一条最终通话时长记录；未接、拒接或失败各自显示对应结果，不额外生成时长气泡。用户/AI 转写、工具、快照/OCR 和播放事件不伪装成普通可见聊天正文。

通话实时回复与去电决策共用 Chat 的全部已有摘要和完整未总结原文，当前通话状态放在历史之后。Host 通过 Calls 只读端口把事实放入同一 SQLite 快照，时间线与摘要共享 canonical 顺序，不复制 call_events。用户转写和 AI 完整回复参与计数，系统事件与 TTS 分句不重复计数。

通话中达到摘要门槛等待挂断，短通话继续累计；长原文最多5000字顺序分片、全部成功后原子交接。摘要只追加及用户维护规则见 [Memory V3 §18～22](../memory-simplification-v3-implementation-spec.md#18-聊天摘要的产品契约)。未接/拒接不生成交谈摘要。

## 4. 领域与并发

CallSession 保存角色/会话 identity、方向、状态、媒体模式、来源、请求/接通/终态时间与原因；CallEvent 保存转写、系统/工具/媒体事实。CallAttachment 是临时快照事实，不变成长久视频或音频档案。

同一时间只允许一通有效通话，新请求通过持久 owner 的 claim/事务裁决 busy；UI 禁用不是唯一性保证。被拉黑或无资格角色由业务层拒绝，不在原生层复制授权状态机。

## 5. 状态机与回复回合

### 5.1 去电

```text
预检 → dialing → connecting → active → ending → ended
                     └→ rejected / failed
```

### 5.2 来电

```text
requested → ringing → active → ending → ended
               └→ rejected / missed / failed
```

### 5.3 工具与输入

来电工具的调用资格和单次运行限制由 Calls/Host 的现有 contract 裁决。通话中的 `lookAtUser` 只接受 active call、已开启相机和当前快照能力；它不授予新的相机权限或自行开启摄像头。

### 5.4 终态与恢复

Repository 是终态真值；原生宿主存活时页面重建不得把通话当作孤儿。重复挂断已终态电话仍释放残留资源并完成 Headless 等待，首次原因、时间和一次性跟进不改写。

### 5.5 回合相位与打断规则

每通电话的回复相位由 Calls runtime 持有：`idle → generating → speaking → idle`。Presentation 消费相位，不用局部“发送中”布尔反推。

- ASR 稳态文本与文字提交走同一用户输入入口。
- idle：开启新回合。
- generating：取消在途回合，runId fence 与 AbortController 阻止晚到提交；已提交用户事件保留。
- speaking：先通过 TTS version、合成取消、停播与 ttsInterrupted 事实打断，再开启新回合。
- 一个回合包括模型回复和全部句子播放；正常结束不早于最后一句，打断是正常退出路径。
- 打断后整队未播放句子作废，不续播；文字不需要语音回声确认。

## 6. 模型、语音与字幕

ProcessCallAIReply 使用当前角色主模型与 resolved Chat Pack；流式文本分句进入 TTS，完整回复提交一次 aiSpeechText，逐句正式事件即时驱动歌词流。Calls 当前多模态续答仍在自身 runtime，不宣称已接入通用 AgentRunLoop。

每轮固定角色 TTS 模型及 Speech 厂商文本契约。合成输入保留当前模型支持的表达/停顿标记，事件和字幕使用无标记转写；跨 delta 标记不被分句切断，播放队列不再次解析句子。模型配置变化只影响下一轮。

麦克风关闭会停止采集与 ASR。系统声学回声消除可用时，TTS 期间保持输入并通过连续人声确认打断；不可用时采用当前半双工保护，不把回声当新输入。文字与语音共享回合 owner，文本输入不创建第二套回复链。

## 7. 原生执行与媒体

```text
Calls commit → CallExecutionService → CallExecutionHeadlessTask
→ ensureHostDatabaseReady → 唯一 CallMediaRuntime
→ 终态 → ASR/相机/TTS/窗口/通知释放 → Headless completion
```

Calls 执行独立于 Overlay FGS 和 Companion 服务。CameraX 与窗口由 service 持有，React 卸载/切后台只改变展示；Core-Telecom 是音频 route 的唯一 owner。来电 ringing 由 IncomingCallActivity/CallStyle 通知承担，RN 不创建第二个来电状态机。

系统小窗使用唯一窗口，交互、主线程销毁和设备验收见原生契约。通话期间共享可见性抑制隐藏普通悬浮球，终态恢复，不关闭独立产品功能。

## 8. 快照、背景与权限

本轮 `lookAtUser` 才截取相机图片，按当前角色视觉模型选择走原图或识别转述；没有独立 Vision 模型类别或通话 OCR 配置。快照成功/失败/取消/通话终态及时清理，冷启动处理上一进程残留；临时快照从默认备份排除。窗口/页面不能成为截帧 provider 的第二个 owner。

Calls 背景是 SQLite 持有的稳定 MediaAsset 选择，角色绑定、旧全局迁移和 revision/CAS 由 Calls 管理。AI 头像供小窗与通知共享，不与全屏背景混用。模型选择见[辅助模型契约](../architecture/auxiliary-model-selection.md)，文件边界见[媒体契约](../ravencat-media-asset-refactor-plan.md)。

系统通知、全屏来电、录音、相机、悬浮窗口与前台媒体服务按实际能力准入；权限中心只负责系统状态与引导。AI 是否请求来电由上下文与用户工具授权决定，不追加另一套通用可打扰决策。

## 9. 验证范围

`verify:calls` 和相关 SQLite/Prompt/Speech 行为验证保护并发、终态、回合 fence、字幕、媒体释放和上下文。独立 Kotlin 编译/单元验证保护原生接口；真实后台/锁屏、endpoint、CameraX、OEM 通知/触摸与恢复需按[设备清单](native-call-implementation-checklist.md)单独验收。不要把历史 Phase 完成或局部测试通过写成所有设备行为已关闭。
