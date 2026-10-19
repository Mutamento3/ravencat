# RavenCat 主动伴随

Self Wake 已合并到 AI 日程。所有定时自主行动由唯一日程真值、工具、投影与执行入口负责。Doze、OEM 回收、真实进程被杀与通知仍需设备验收。


## 1. 产品定义

主动伴随允许当前主理 AI 在没有用户新消息时，由 AI 日程取得一次正常单聊执行机会。AI 可调用零个、一个或多个已授权工具，也可不发送任何消息。日程不是一条预存的待发消息。

用户提出“稍后提醒”，与 AI 自己决定“稍后醒来”，使用同一套日程。没有独立的 Self Wake 工具或第二种调度队列。同一安排调整时间或内容使用 `update_ai_schedule`，不同时建立两种唤醒。

## 2. 所有权与真实链路

业务代码归 `src/features/companion`，跨 Feature 的具体组合由 Host 负责。

```text
create_ai_schedule / update_ai_schedule / cancel_ai_schedule
→ AIScheduleApplication（模型输入与内容、时间、来源校验）
→ SQLiteAIScheduleRepository（事务与状态机）
→ commit
→ AIScheduleProjectionOwner（串行投影与启停）
→ keyed Alarm / WorkManager
→ RavenCatAIScheduleWorker
→ native projection gate
→ RavenCatCompanionExecutionHost
→ CompanionWakeHeadlessTask / RunHeadlessAISchedule
→ Assistants Host Authority + SQLite claim
→ RunAIScheduleAutonomousAgent / RunHostAutonomousAgent
→ RunChatVisibleAgent（正常 Agent Runtime、工具与 Chat 提交）
→ consume / native completion
```

原生投影不是业务真值；它不能创造日程、决定行动内容或绕过 SQLite claim。消息交付仍由 Chat commit 后的 AIMessageDeliveryCoordinator 决策，不能另建主动消息流程。

## 3. 日程与工具

持久真值只有 `raven_cat_ai_schedules`，稳定 identity 是 `scheduleId`。状态：

```text
scheduled → claimed → consumed
scheduled → cancelled
```

创建、修改只接受未来时间；取消只接受尚未到期的 scheduled。查询及取消在主动伴随关闭时仍可用。summary 最长 160 字，details 最长 4000 字；来源快照由正常会话和消息边界验证。

正常主理 AI 工具只有：

- `create_ai_schedule`
- `list_ai_schedules`
- `get_ai_schedule`
- `update_ai_schedule`
- `cancel_ai_schedule`

日程不授予额外权限。每次执行都解析当前主理 AI 的工具授权、MCP、运行时暴露面与会话。

### 3.1 系统日历提醒

`create_ai_schedule` 默认 `system_calendar=true`，同时保存内部 AI 日程与手机日历的事件及零分钟提醒。缺少日历读写权限或没有支持提醒的可写日历时，在业务提交前报错，不创建内部记录，也不弹权限框。权限由用户在小程序的「权限与后台运行 → 系统日历」入口主动授权。用户拒绝或已有仅内部提醒偏好时，AI 可显式传 `system_calendar=false`；不静默降级、不反复索要权限。

`system_calendar` 是日程持久事实。既有记录升级后保持仅内部，不自动导出历史安排。更新默认保留原选择，也可显式切换；修改或移除已有系统事件需要日历权限。取消先提交内部终态，再移除系统事件；若授权已撤销，工具必须明确报告系统事件尚未移除，恢复权限后再同步。

SQLite 与 Calendar Provider 不共享事务。内部事实先提交，AI 唤醒投影与系统日历副作用分别执行；提交后的系统写入失败返回带稳定 scheduleId 和 calendarStatus 的部分成功，不能声称系统提醒已成功或重建第二份日程。系统事件用当前安装包与 scheduleId 标记，事件及提醒使用 Provider batch 原子写入；沿用现有投影 owner、bounded repair 和前台恢复入口幂等同步，不建立第二套调度队列。

系统日历负责独立提醒用户，不触发 AI 执行；AI 仍通过唯一的内部日程链路 claim 和运行。关闭主动伴随保留系统提醒，AI claim/consume 不删除已到期系统事件。两边设定相同时间，但内部非精确调度和模型生成不保证消息同秒到达。系统日历自身的通知设置仍由用户和手机系统管理。

## 4. 主动伴随开关

`raven_cat_companion_state.desired_enabled` 是开关真值。AIScheduleProjectionOwner 在同一 operation lane 提交意图并同步原生镜像；Repository 在 create / update / claim 的同一事务读取开关和绑定主理身份。这是持久化执行边界，UI 防抖或原生镜像不能代替它。

关闭时：

- 所有未消费原生投影撤销；日程计划与历史保留。
- 新建、修改及新的执行 claim 返回 `companion_disabled`。
- 迟到的原生 Worker 不 dispatch；已经 dispatch 的迟到 JS 回调仍受 Repository claim 边界约束。
- 已取得 claim 的 run 由原有 bounded execution owner 收口，关闭开关不补造、重放或接管它。

重新开启只恢复尚未到期的 scheduled 计划。暂停期间已错过的计划显示“未执行”，不补跑。主动生活界面明确提示暂停状态。

主理 AI 更换、撤销或删除仍由 Host Authority 处理；旧 owner 的 scheduled 日程取消并保留原身份，不能转交给新 AI。用户单纯关闭开关不会取消业务计划。

## 5. 响应证据与中断

`consumed` 只表示执行机会不可再领取，不等于 AI 已响应或工具成功。Chat 持有开始、模型响应、工具事件和真实终态；主动生活通过 runId 查询证据并展示：

- 过期未 claim：未执行。
- 已收到模型输出：显示 AI 已响应。
- 正常结束且有响应：已执行；行动结果仍以工具 outcome 为准。
- 执行途中被停止或进程死亡：执行因故障中断，保留已提交的文本和步骤。
- 准备、模型或执行失败：执行失误。

开始记录在模型与工具准备之前提交。模型增量到达后持续存档；执行到一半结束时不丢弃已存档的半段原文。后续冷启动／回前台只结算不属于当前进程活动句柄的旧 claim，Chat 补写中断终态；不重新执行模型或工具。完全没有获得执行机会的日程保持未执行。

## 6. Android 投影与执行

### 6.1 统一投影

每个 scheduleId 对应独立的 inexact Alarm 与 OneTimeWork；二者共享同一版本身份与 native gate。Alarm 只将该日程交给同一 keyed Worker，不启动另一种业务 run。更新替换同一 identity，取消移除该 identity。

native gate 原子检查开关、remindAt 与 projectionToken 并消费镜像；只有一个 winner 进入执行宿主。SQLite scheduled → claimed CAS 再裁决业务执行权。deliveryEventId 是 `scheduleId@projectionToken`，旧版本回执不能污染新版本。

使用 Android 13+ 的 `setAndAllowWhileIdle` 保留 idle 下系统唤醒能力；它不是准秒计时保证。WorkManager 的系统调度也可能延迟，代码不把迟到本身解释为 AI 违约或新日程。

### 6.2 恢复与清理

冷启动／回前台只从 SQLite 恢复未来投影；过期且缺失投影的计划不补建立即 Work。过期但仍匹配的既有系统投递保留；过期的错误版本撤销。原生 boot／package replace 只恢复未来 Alarm，不访问 SQLite 或主动运行模型。

投影故障不能回滚已提交的日程。现有 bounded projection repair 只同步镜像，不重放模型或工具。关闭后持久化开关已经阻止新的 claim，镜像故障不会越过业务边界。

### 6.3 Background Execution / Headless Execution Host

四个 owner 必须显式分开，不能靠「进程恰好活着」把责任推给别的组件：

```text
schedule ownership
= Proactive Companion
  SQLite durable truth + AlarmManager / WorkManager projection

execution ownership
= Companion execution host（`RavenCatCompanionExecutionHost`）
  取得 native dispatch 权后接管一次 wake delivery 的执行生命周期，
  直到 autonomous run 到达终态，或宿主按有界等待以明确结果收口

foreground execution ownership
= 同一次 wake 的执行
  只在真正执行时按需建立有界前台执行，执行收口立即释放；
  它不是 `proactiveCompanionEnabled` 的 lifetime，
  Companion ON 但没有执行时不得存在任何常驻 foreground service

Headless completion ownership
= JS runner 的终态回执（`recordCompanionRunnerCompletion`）
  execution host 以它作为唯一完成信号；没有回执就不算完成
```

正式链路：

```text
wake due
→ Worker 取得 native dispatch 权（consumeDueTriggerIfCurrent）
→ companion_execution_host_started
→ 请求建立有界前台执行（start 请求投递 ≠ 前台已建立）
→ headless_task_start_requested / accepted
→ application claim → autonomous Host Agent Run → consume
→ runner 回执终态
→ companion_execution_host_stopped（前台执行与执行生命周期同时释放）
```

收口语义（`TIMED_OUT` 与 `WORKER_STOPPED` 都不是「run 已结束」的证据）：

```text
有界等待耗尽（runner 未回执）             → TIMED_OUT 路径
Worker 被 WorkManager 停止（interrupt）   → WORKER_STOPPED 路径
```

两条路径之后是同一段收口，且**取消事实必须先落 native 再发事件**：

```text
→ RavenCatCompanionWakeStore.markExecutionCancellationRequested(deliveryEventId)
→ companion_execution_cancel_requested
→ native 事件 onCompanionExecutionCancel → 已注册 runner 的 AbortSignal
→ 晚注册的 runner：启动后 consumeExecutionCancellation(deliveryEventId) 追平 abort
→ Agent Runtime 既有 cancellation → terminal → consume → 终态回执
→ 宿主在取消宽限（CANCELLATION_GRACE_MS）内等待收口
→ 收口后释放前台执行与执行生命周期
```

没有这条取消链路，宿主会比它启动的 Headless autonomous run 更早结束，
重新制造「无 owner 的后台 JS 执行」。

取消**不能只放在 JS 内存里**：runner 可能晚于取消请求才注册自己的 `AbortController`
（JS 冷启动 / runtime 重建 / 任务尚未派发），此时事件叫不到任何 controller。
所以取消事实由 native 按 `deliveryEventId` 持有（跨进程重建也不丢），
runner 启动后主动消费一次；事件只是「已经在跑的 runner」的快路径。

runner initialization 的顺序是语义的一部分，写错会让取消静默丢失：

```text
创建 AbortController
→ 注册到本 runtime 的 registry
→ 消费 native 取消标记（命中则立刻 abort）
→ 运行 autonomous run
→ 回执终态
→ finally 释放 registry 项
```

覆盖关系：

```text
取消落在 register 之前   → native 标记接住，consume 命中后 abort
取消落在 register 之后   → 取消事件直接命中 controller
取消落在两者之间         → 事件命中 controller；consume 也可能同时命中 → abort 幂等
native consume 读不到（抛异常）→ 不得当成「没有被取消」，本次 execution 以失败回执收口
```

也就是说 **register 必须早于 native consume**：先 consume 再 register 会留下
「consume 返回 false → 取消到达（无人注册）→ register」这一段无人接管的夹缝。
取消标记只有两种消亡方式：被 runner 消费一次，或 TTL 剪枝——**任何层都不主动删除它**，
包括执行宿主收口；`deliveryEventId` 就是 delivery identity，同一个 id 的再次执行是同一个
delivery，不是「全新执行」。

硬约束：

- **禁止 fire-and-forget execution**：Worker 不得在把 wake 交给 JS 之后立即返回成功，把 Headless 生命周期留给系统或另一个 foreground service 维持。执行宿主要么等到 runner 终态回执，要么按「超时 → 显式取消 → 有界宽限」以明确结果收口。
- **禁止对 Overlay FGS 的隐式依赖**：Companion 调度与执行链不得读取 `RavenCatOverlayService` 状态、Overlay 授权或 `floatingInteractionEnabled`。`Floating Interaction OFF + Proactive Companion ON` 必须独立工作。
- **只有 native gate 的 winner 能进入 execution host**：统一走 `consumeDueTriggerIfCurrent`，只有 `CONSUMED` 能 dispatch；`STALE` / `ABSENT` 直接收口。SQLite claim 再裁决业务执行权。
- `START_REJECTED` / `TIMED_OUT` / `WORKER_STOPPED` 都**不重跑**同一个 wake：native projection 已消费，业务幂等边界仍是 SQLite 的 `scheduled → claimed` CAS 与 consume 语义。
- **不得宣称「收口后 run 已不可能继续产生副作用」**：`TIMED_OUT` / `WORKER_STOPPED` 只表示「宿主在等待上界内没有收到 runner 终态」。宿主释放执行保障后，autonomous run 是否还在跑取决于进程是否存活与 Agent Runtime 自己的取消语义，代码不保证它已经停止；业务幂等仍只由 SQLite 的 CAS / consume 兜底。
- 执行期的前台执行属于 Companion，通知必须与本次 delivery 绑定、执行结束即消失；Companion 空闲时不得存在常驻 foreground service，也不得为它多挂一条常驻通知。
- 平台拒绝后台建立前台执行（Android 后台启动限制）只降级执行质量，不得让本次 wake 失败：宿主仍须完成本次交付与收口。
- **correctness 的承重结构**是「Worker 阻塞到 runner 终态（有界）+ 收口时显式取消」。前台执行**不延长任何系统执行预算**：JobScheduler 单次 job 约 10 分钟的上限由系统强制，WorkManager 在中断那一刻就 `resolve()` 掉本次 work（2.8.0 `WorkerWrapper.interrupt()`：`mInterrupted=true` → `tryCheckForInterruptionAndResolve()` → `future.cancel(true)` → `worker.stop()`，`doWork()` 之后返回的 Result 被丢弃）。前台服务只做两件事：提高进程优先级、降低被冻结/回收的概率。前台执行被拒绝时，长 run 退化为尽力执行，并以诊断记录，不伪装成受保障执行。

诊断要求：健康快照必须区分 `overlayForegroundServiceRunning`（Floating Interaction 的 Overlay FGS）与 `companionExecutionForegroundRunning`（Companion 执行期临时前台）；执行收口诊断必须区分
`foregroundStartRequested`（`startForegroundService` 请求已投递）与 `foregroundRunning`（`startForeground` 真实建立，
Android 12+ 可能在后者才被拒绝），并持久化 `lastCompanionExecution{Outcome,ForegroundRunning}`。**不允许把 Overlay FGS 显示成「本地伴随前台服务」，也不允许把「请求已投递」报成「前台执行已建立」。**

进程死亡时无法继续提交终态；下次启动／回前台由 §5 的 owner 结算旧 claim，Chat 保留已存档过程并记录故障中断。当前进程仍在运行的句柄不参与结算；不依靠时间阈值猜测，也不补跑原机会。

#### Worker 被停止之后，Headless run 归谁

| 阶段 | owner | 说明 |
|---|---|---|
| Worker 运行中 | Companion execution host | 阻塞等待 runner 终态，持有有界前台执行 |
| WorkManager 中断 Worker | **无系统 owner** | WM 已 `resolve()` 本次 work，不再接受 Result；宿主只保留自己那份前台执行 |
| 取消宽限内 | Companion execution host | 仍有机会收到 cancellation → terminal → consume → 回执，记为 `COMPLETED` |
| 宽限耗尽 | **无 owner** | 宿主记 `WORKER_STOPPED` 并释放前台执行；autonomous run 若仍在跑，只能靠 Agent Runtime 自己的 cancel / consume 与 SQLite 幂等收口，代码不保证它已经停止 |

#### Current implementation：Companion 自有的执行期前台服务

当前实现是 `RavenCatCompanionExecutionService`（自定义 FGS，类型 `specialUse`），
按 `deliveryEventId` 引用计数，随一次 delivery 的执行开始、随终态结束释放。

当前 foreground execution 提高执行期进程优先级，降低被冻结/回收的概率，但不延长普通 Worker 的 WorkManager 执行窗口，也不保证终态之后 Agent run 已停止。平台拒绝 foreground start 时只降低执行保障，仍按当前交付与有界收口契约处理。

当前没有迁移为 WorkManager long-running foreground Worker。替代执行方案的调查与版本字节码核对保留在本地历史，不作为当前运行协议或新的实施指令。

#### 真机验收 checklist

- [ ] 关闭悬浮层后安排 AI 日程；
- [ ] App 切后台并熄屏，验证 5–10 分钟 wake；
- [ ] App 切后台并熄屏，验证 30–60 分钟 wake；
- [ ] App 长时间后台，验证 2–4 小时 wake；
- [ ] 设备进入 Doze / 长时间 idle 后验证 delivery；
- [ ] Floating Interaction OFF + Companion ON，且进程已被系统回收（冷启动）后仍按时收到主动消息；
- [ ] Floating Interaction ON + Companion ON，同一个 wake 不产生第二次 autonomous delivery；
- [ ] wake 执行过程中开关悬浮球，正在执行的 Companion run 不受影响；
- [ ] Companion ON 但当前没有执行时，不存在常驻 foreground service 与常驻执行通知（`companionExecutionForegroundRunning=false`）；
- [ ] 执行期 `companionExecutionForegroundRunning=true`，执行收口后立即回到 false；
- [ ] `lastCompanionExecutionOutcome` 在正常执行后为 `COMPLETED`（而不是 `TIMED_OUT` / `START_REJECTED`）；
- [ ] replacement 后旧 event 不执行；
- [ ] cancel 后旧 event 不执行；
- [ ] 杀进程后验证 future wake；
- [ ] reboot 后验证 future Alarm 恢复；
- [ ] 到期时无网络，确认不会重复启动同一 event；
- [ ] 恢复网络后确认现有业务终态与后续调度语义；
- [ ] 最终确认同一个 event 没有重复发送。

以上真机项需人工执行，不能用本地 verifier 代替验收。进程被杀后的原文保留与不补跑终态结算也需纳入设备回归。


## 7. 单聊上下文与行动记录

自主唤醒走普通单聊 Prompt、人设、聊天摘要和未处理原文；历史之后的本轮 system 统一说明日程到期和自主活动时间，注入日程事实与行动记录输出要求；没有新用户消息，不创建 user role 的唤醒输入。工具目录、权限解析与正常单聊共用。共同前缀尽可能保持一致，实际缓存命中由模型服务决定。

`finalAssistantPolicy: record_as_activity` 将模型提供的思考文本、前言、完成说明、工具状态与生命周期收进单聊行动步骤；即使没有任何消息工具调用也能看到执行证据。这些持久记录进入后续 AI 上下文。运行时未输出的内部思考不属于可记录数据。

实际文字、语音、贴纸等交付仍由正常工具提交。过程记录不触发用户消息通知、未读或会话预览。媒体提交钩子是提交后的资源确认步骤，故障信息用用户能理解的执行结果表达。

## 8. 主动生活与历史

主动生活只读取 AI 日程及 Chat 响应证据，提供 future / running / history，不建立第二份业务状态。时间轴按实际 claimedAt 排序；未执行按原定时间排序。分页使用时间与稳定 identity，不再区分两种来源。

Chat anchor 只通过 runId 定位，不向日程 domain 复制会话事实。同一个 run 可被实际消息分隔成多个行动步骤分组，但生命周期与响应证据按整个 run 展示，不能把前一段误报为仍未结束。

## 9. 升级边界

SQLite 迁移114 将旧 Self Wake 计划与历史迁入 AI 日程，保留 wakeId 作为 scheduleId、owner、claim runId 和时间戳。superseded 映射为 cancelled，旧工具授权搬到创建日程工具；已有新工具授权优先。摘要与背景按现有日程长度边界迁入，旧 Chat 原文和执行记录不改写。

旧 Self Wake 表和工具入口删除。原生升级清理一次旧单值 Alarm／Work／偏好镜像，不再恢复旧链路。旧 Chat 的触发类型与工具显示名只服务历史展示，不提供调度入口。

本地验证覆盖状态机、暂停保留、重新开启不补跑、迁移回滚、单聊上下文、增量存档、取消与 native gate。Doze／OEM 回收、真实进程被杀和通知仍需设备验收，不以 JVM 检查代替。
