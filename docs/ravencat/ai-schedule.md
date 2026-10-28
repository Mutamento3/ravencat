# RavenCat AI 日程

> 当前状态：AI 日程已合并 Self Wake，成为唯一的定时自主行动入口（2026-10-10）。启停、上下文、Chat 记录与 Android 执行约束以[主动伴随架构](./proactive-companion.md)为准。

## 1. 产品行为

AI 可以根据近期交流自主安排未来醒来，也可以响应用户的提醒要求。到点后系统追加自动唤醒输入，进入正常主理 AI 单聊执行；AI 基于最新上下文决定行动，可以不发消息。

日程本身不是手机系统日历事件，也不预存一条必须发送的消息。当前不实现周期日程或系统内置每日任务。

主动伴随关闭时暂停并保留既有计划；创建、修改与新的执行 claim 被拒绝，查询和取消仍可用。开启只恢复未来日程，错过的显示未执行，不补跑。已 claim 的 run 由既有有界宿主收口。

## 2. 持久事实

`AISchedule` 使用稳定的 `scheduleId`，ownerAIId 保留创建时主理身份。时间使用 ISO 字符串。字段：

| 字段 | 含义 |
|---|---|
| remindAt | 原定唤醒时间 |
| summary / details | 简短摘要／留给未来执行的背景 |
| sourceConversationId / sourceMessageIds / sourceExcerpt | 可选的真实会话来源快照 |
| status | scheduled / claimed / consumed / cancelled |
| claimedByRunId / claimedAt | 领取执行机会的 run 与时间 |
| consumedAt / completionDisposition | 执行机会的收口事实 |
| cancelledAt / cancelledReason | 取消事实；主理撤销记录 owner_revoked |
| createdAt / updatedAt | 创建时间与当前版本 |

状态只允许：

```text
scheduled → claimed → consumed
scheduled → cancelled
```

scheduled 到点后不能更新或取消；历史不可改回未来。consumed 表示机会不能重复领取，不保证模型有响应或工具成功。真实响应与行动证据由 Chat 记录提供。

用户／AI 的取消限制不影响系统终结：超过 15 分钟未开始、归并到最新日程、交给当前聊天，分别保存 cancelledReason 为 expired、merged_schedule、merged_chat。旧回调不能恢复这些安排。失败与跳过结果进入下次正常聊天的动态环境，按已提交回合确认单次告知；结果记录没有唤醒或重新执行能力。

## 3. 创建、查询与修改

唯一正常工具族：

- `create_ai_schedule`：未来时间、summary、details，可选真实消息来源。
- `list_ai_schedules`：时间范围、可选状态和稳定分页；返回轻量列表。
- `get_ai_schedule`：按 ID 返回完整详情。
- `update_ai_schedule`：同一未来计划调整时间或正文，保留 identity 与来源。
- `cancel_ai_schedule`：取消未来 scheduled，保留历史事实。

同一安排只创建一次；调整使用 update，不创建平行的 Self Wake。后续确有新行动机会时才创建新 identity，不能为后台调度迟到重排原事件。

内容边界：summary 1～160 字、details 1～4000 字、sourceExcerpt 最长 2000 字、sourceMessageIds 最多 12 条。模型不能自造来源原文；Chat 的来源解析端口验证会话归属、消息身份和顺序并生成快照，Repository 信任这份 contract。

主理身份由模型工具入口的 Host Authority 验证；Repository 在 create / update / claim 事务中读取主动伴随开关和绑定身份。外部 SQLite 数据在 mapping 时按 domain 状态约束解析，内部层不重复修补无效组合。

## 4. 执行与幂等

```text
日程 commit
→ AIScheduleProjectionOwner
→ keyed Alarm + OneTimeWork（同一个 scheduleId）
→ native gate（开关／remindAt／projectionToken 匹配后消费镜像）
→ bounded Companion execution host
→ RunHeadlessAISchedule
→ 当前 Host Authority + scheduled → claimed CAS
→ RunHostAutonomousAgent
→ 正常单聊 Agent Runtime / 持久展示 / T3 提交 / 工具与消息交付
→ consumed + native completion
```

deliveryEventId 是 `scheduleId@projectionToken`；eventId 仍是原始 scheduleId。旧版本 completion 不影响更新后的投递。

Alarm 只投递同一 keyed Worker。两个系统调度来源共用一个 gate，只有唯一 winner 能进入宿主。后台调度可能延迟；不保证准秒唤醒，也不借延迟创造补偿任务。

启动／回前台先终结超过 15 分钟仍未领取的任务，再重建 future 投影。仍在有效期内的既有投递按最新计划归并、聊天优先裁决；不排队补跑过期、失败或已归并的任务。

## 5. 中断与主动生活

`AIScheduleRecovery` 将 claim 与当前进程活动 run 绑定，冷启动／前台只结算旧 claim，跳过当前活动句柄。正常 consume 与结算使用同一 run fence，先提交的终态不能被迟到路径覆盖。

进程死亡或执行中断后不重新调用模型、工具或消息提交；Chat 的共享回合与展示 owner 封闭终态、保留已交付增量。正文生成时直接显示为普通气泡，思考及工具过程进入行动步骤，不额外生成开始、响应或结束消息。只有模型实际返回内容或工具请求才显示 AI 已响应，consumed 不能充当响应证据。隐藏触发来源提供历史定位锚点，响应、终态及后续模型上下文沿共享事实读取。

主动生活只读取日程与 Chat 证据，提供 future / running / history。未来计划在暂停时仍可查看；过期未 claim 显示未执行，执行失误与因故障中断分别呈现。聊天定位仅用 runId，不向日程复制 session 事实。

## 6. 升级与验证

迁移114 搬运旧 Self Wake 计划及历史：wakeId 保留为 scheduleId，owner、claim runId 与时间保留；superseded 转为 cancelled。旧工具授权迁入创建日程工具，已有新授权优先。旧 Chat 原文不改写，历史显示名仍可识别。

原生旧单值 Alarm／Work／偏好投影清理一次；旧工具、Repository、执行入口与调度实现退休。之后不同时维护两套语义。

行为验证覆盖事务开关、状态机、旧计划迁移与回滚、暂停保留、重新开启不补跑、重复投递、取消和正常单聊复用。原生模块单测可验证 gate 与 Alarm identity；真实 Doze／OEM 回收／进程被杀及通知仍属于设备验收。
