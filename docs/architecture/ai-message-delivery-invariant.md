# AI 回复执行宿主与消息交付

Host 在业务查询前通过 `ensureHostDatabaseReady()` 完成恢复事务门与普通数据库 bootstrap。普通 Chat、Calls 执行/拒接与 Together 通知动作共用该门；没有恢复任务也必须等待初始化。Repository 信任 Host 启动契约，不自行重复初始化。


执行生命周期与展示生命周期解耦：

- 任何要求在 Activity 不可见后仍继续完成的 AI run，不得由页面 React runtime 的
  fire-and-forget Promise 独占执行生命周期；必须由具备 Android 后台生命周期保证的
  execution host 承担（Activity 不可见后，页面 JS runtime 的 XHR/SSE 消费可能被冻结）。
- 普通聊天 canonical `user_reply` 的唯一执行宿主是
  `modules/conversation-turn-runtime` 的 `ConversationTurnExecutionTask`
  （Headless JS service）：页面在 T1 commit 后只 abort 被 supersede 的旧句柄并
  `startConversationTurnExecutionHost`，不得在页面 runtime 直接 claim；
  任务侧经 `ConversationTurnCoordinator.executeTurnFromHost` claim 并等待 run 到达
  terminal，执行链路仍是 `executeUserReplyTurn → processAIReply`，禁止复制回复业务流程。
- execution ownership 必须由显式 `executionMode` 表达：普通 Chat page 默认
  `delegate_to_android_host`；仅受控且会等待 terminal 的 execution host（如 RavenCat
  `FloatingMessageHeadlessTask`）可显式选择 `inline_current_host` 并就地 claim + 执行。
  `replyCallbacks` 仅用于回复投影/交付观察，不得用于判定 host 身份。
- 后台执行一律 `deliveryTiming: 'immediate'`（后台 setTimeout 会被冻结）。
- 不新增第二份 pending queue、JS 轮询、回前台补跑、多层 retry 或页面保活 hack；
  跨进程正确性以持久化 fence / watermark / revision 为准，AbortSignal 只节约资源。
- 启动恢复（recoverConversationTurns）同样只负责发现待恢复会话并启动
  execution host，不得在页面 runtime claim/执行恢复出的 run；多个恢复会话在
  同一个 Headless 任务内串行执行，孤儿接管与终态覆盖判定由 executeTurnFromHost 承担。
- assistant message commit 后的交付判定统一在 `AIMessageDeliveryCoordinator`
  （每个 JS runtime 注册一次）：前台正在查看的会话抑制系统通知（已读由 Host UI 同序完成），
  其余走 Native NotificationManager 聚合通知，`userNotificationHandled` 尊重
  RavenCat overlay preview 消费者；Chat 页面 / KimiPhoneHost / RavenCat / 通知模块
  不得各自维护一套「回复来了怎么办」的判定。
- canonical 回复仍在 T3 一次提交全部分段。commit 后、UI 刷新前登记本批消息 ID，
  原生 `MessageArrivalProgress` 按会话维持约 1 秒到达间隔；通知权限、前台抑制和
  消费方展示不改变到达节奏。该进度仅是当前进程的展示投影，不拥有业务提交、
  pending reply 或执行恢复。批次结束、交付异常或所属 runtime 销毁时移除投影；
  冷启动直接读取已提交事实，不重放到达动画。
- Tab、会话红点与实时列表预览查询排除尚未到达的消息 ID，非流式多气泡聊天页
  消费同一进度，不再单独计时。SQL 仍按真实 `is_read` 计数，进入会话批量已读后，
  后续分段到达不得重新制造未读。展示查询不得回写 session/group 持久预览。
- 回合诊断统一用 `@shared/diagnostics/TurnTimelineLog` 的里程碑事件
  （runId / correlationId 串联），禁止输出 prompt、key 与消息正文。

ConversationTurn 的固定输入区间、事务状态转换与提交 fence 见
[`conversation-turn-coordination-invariant.md`](./conversation-turn-coordination-invariant.md)。

### Protected Chat Background Execution Contract

普通 Chat AI 回复的执行生命周期必须由 Android-backed execution host 持有，不得退回页面
React Native runtime。

修改 `SendUserMessage`、`ConversationTurnCoordinator`、`ConversationTurnExecutionHost`、
`ConversationTurnHeadlessTask`、reply callbacks 或相关 wiring 前，必须阅读：

`docs/architecture/chat-background-execution-invariant.md`

不得以 slimming、callback unification、fallback、runtime simplification 等理由绕过该约束。
