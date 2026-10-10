# Chat 功能

Chat 拥有单聊、群聊、消息时间线和回复引擎。外部 Feature 只能从
`@features/chat` 使用稳定公共能力，不得深导入 Chat 内部目录；Host 的运行时装配
才可以使用 `@features/chat/composition`。

## 职责

- 管理单聊会话、消息、群聊及其领域模型和仓储端口；
- 摘要模块拥有聊天与通话的统一时间线、逻辑消息计数和原文交接。通话中达到门槛等待挂断，短通话继续累计；长原文每次最多5000字，全部分片成功后原子追加摘要与处理进度。Calls 的只读事实通过 Host 装配到同一数据库快照，不复制通话消息。
- 编排用户消息、外部 assistant 消息、主动回复、时间线查询和群聊命令；
- 由 Chat 自己完成消息提交后的 preview 和交付能力调用；
- 提供 ChatScreen、路由、会话、群聊、消息气泡与输入区；
- 通过 conversation、messages、group、reply 各自的运行时端口接收 Host 注入的能力。
- 拥有语音消息的 transcript、播放状态、气泡展示和 T1/T3 原子提交；Speech 只负责 STT/TTS，Media 只负责 canonical 音频资产。
- 持有普通单聊工具包的三轮展开状态，与 T3 正式回复同事务提交；Host 负责分包与动态 schema 暴露，状态不代表工具权限。

单聊对话设置的名称、人设、头像与群聊管理员配置自动保存；输入草稿校验由页面负责，合法字段独立提交，错误在字段旁显示并保留输入。
通用提交确认复用 shared/ui，聊天及通话背景继续独立更新；当前契约见 [对话展示信息自动保存](../../../docs/architecture/conversation-settings-autosave.md) 与 [模型设置自动保存](../../../docs/architecture/model-settings-autosave.md)。

## 不负责

- AI Provider、HTTP 与流式传输底座由 `platform/ai` 负责；
- SQLite 连接、schema、migration 与读写调度由 `platform/persistence` 负责；
- Memory、Calls、RavenCat、Wallet 等业务规则归各自 Feature；
- 应用启动、跨 Feature 装配和具体外部能力实现归 `host/composition`。

## 出口与边界

### 普通公共出口

`src/features/chat/index.ts` 是外部 Feature 和 App 使用的唯一普通出口，包含：

- 会话、消息、群聊的公开命令、查询与稳定 DTO；
- AI 消息交付事实的订阅入口；
- `ChatScreen`、`BottomTabBar`、路由屏幕和 Chat router 入口。

当前 `ChatScreen` 由根 `index.ts` 显式导出，App 路由应直接使用
`import { ChatScreen } from '@features/chat'`；`presentation/shell/ChatScreen.tsx` 是实现路径，
不是跨 Feature 的深导入契约。

普通出口不暴露 `configure*`、`publish*`、`ProcessAIReply`、turn/projector、具体
repository 或 SQLite adapter。外部 Feature 不得自行拼接 persistence、session preview、
UI 刷新和事件发布，应调用完整的 Chat command（例如
`appendExternalAssistantMessage(s)`、`requestProactiveChatReply`）。

### Host-only composition

`src/features/chat/composition.ts` 仅供 Host 组合使用。它负责注入 Chat runtime、配置
delivery handler，提供执行宿主所需的内部入口，并暴露 Chat 自己的具体
SQLite repository 以便 Host 装配。这里的配置函数、执行入口和 repository/adapter 不是
普通公共接口，其他 Feature 不得依赖。

业务 SQL 仍位于 Chat 的 `infrastructure/` adapter；运行时 SQLite 读写必须经过
`@platform/persistence` 的 `databaseCoordinator`。

## 目录

```text
src/features/chat/
├── conversation/      # 会话领域、用例与 SQLite 适配器
├── messages/          # 消息领域、消息用例与 SQLite 适配器
│   └── events/        # Chat 内部消息事件
├── group/             # 群聊领域、用例与 SQLite 适配器
├── reply/             # 回复策略、持久化、投递与 Agent Runtime 适配
│   ├── agent/         # Chat Agent 模型网关、任务与投影器
│   └── delivery/      # AI 消息交付事实与回执
├── presentation/      # ChatScreen、路由、会话、群聊与消息界面
│   ├── messages/      # 消息时间线、消息气泡与输入区
│   ├── shell/         # ChatScreen、内部路由与入口 hooks
│   ├── conversation/  # 会话页面
│   └── group/         # 群聊页面
├── composition.ts     # Host-only 运行时装配出口
└── index.ts           # 普通公共出口
```

各子域保留自己的 `application/`、`domain/` 和 `infrastructure/`，但 Chat 顶层不再有
横向 `application/` 转发层。

### 单聊语音消息

用户语音先在事务外录制并由 Speech 取得稳定转写，结束录音后返回待校对 draft；此时没有 canonical 消息，不更新预览，也不触发 AI。用户确认最终转写后，才通过 Media prepared batch 与 canonical 用户消息在 T1 同事务提交。draft 持有临时录音文件；取消释放文件，发送失败保留可重试草稿，成功提交或 discard 后进入终态。AI 的 `send_voice_message` 是仅单聊暴露的隐藏 Agent Tool；TTS 与 backing prepare 在事务外完成，语音 intent 按 run-local sequence 在原有 T3 fence 内物化为 MediaAsset 与 assistant 消息。

语音正文是模型可见的 canonical transcript，但气泡、会话预览、通知和交付回调默认只显示 `[语音消息]`。`voice_played_at` 只在普通媒体播放器确认 started 后幂等写入，不能复用消息已读状态。

历史 AI 语音在模型上下文中表示为“ai语音转写：正文，发送语音需要调用工具”，每条转写旁都附带真实发送要求；附注不写入消息正文。普通聊天正文不会自动合成语音；本轮发送必须实际调用 `send_voice_message`，schema 尚未暴露时先展开 `chat` 工具包。基础提示词解释历史附注与真实语音的区别，工具说明负责调用步骤与失败语义。

### 会话列表与预热

单聊与群聊共用 `shared/utils/conversationListOrdering.ts`：置顶区优先，区内按真实可见消息活动时间与 `pinnedAt` 的较晚值倒序；普通区只认真实可见消息活动，无消息时回到创建时间，最后按创建时间与 ID 稳定排序。置顶写独立 `pinned_at`，取消置顶同时清空；打开会话不改变活动时间，清历史或删空后的隐藏消息不继续影响排序。

列表和 `presentation/shell/conversationPreloadCandidates.ts` 共用同一排序。已有会话立即进入页面，timeline cache 命中、缺失或预热失败只影响消息加载，不构成导航门槛。预热不创建单聊身份；热点集合随候选身份/顺序变化重算，消息事实变化（包括时间回退或清空）定向失效并重读；缓存遵循 LRU，不以打开页面制造列表活动事实。

## 运行链路

```text
presentation / @features/chat command
  -> conversation、messages、group、reply 各子域 application
  -> domain port
  -> Chat infrastructure（SQLite 经 databaseCoordinator）
     或 Host 注入的 AI / tool / call / delivery 能力
```

普通用户回复主链为：

```text
sendUserMessage
  -> canonical user commit
  -> Android execution host
  -> executeUserReplyTurn
  -> ProcessAIReply
  -> ChatAgentReplyFlow
  -> AgentRuntime
  -> AssistantTurnCommit
  -> assistant delivery
```

消息成功提交后，Chat 更新自身 UI 并交付 assistant 消息；Memory 不再通过逐消息事件摄取。

普通回复整批提交后，`reply/delivery/AssistantMessageArrival` 承接宿主注入的原生
到达进度。Tab/会话红点、实时列表预览和非流式多气泡时间线共享这一展示投影；
原始消息与持久预览仍保持完整提交。原生接口变更需要更新设备开发包，Metro 重载不能替代。

## 常见排查入口

单聊和群聊的消息长按菜单支持复制正文、手动改写、删除、引用和翻译。改写适用于已发送的普通文字与混合消息正文，保留发言者、附件和消息身份；语音、纯图片、表情包与状态卡不提供改写。改写正文和当前预览在同一事务提交，不改变会话活动时间，也不自动触发 AI 回复；编辑期间正文变化或消息删除时保留草稿并提示。

单聊「重写」只面向普通用户输入产生的最新已完成回复回合，后续存在新用户消息或当前正在回复时不提供入口；用户消息、群聊、主动消息及通话等旁路回复不支持。点击任一文字、语音或表情气泡，暂时隐藏整轮 canonical 回复、思考和工具记录，顶部显示「对方输入中」。页面只提交持久化重写意图，原 Android execution host 使用当前模型配置、原回合的全部现存用户输入和附件执行既有 Agent 流程。直接历史截到原输入，旧回复及旧工具记录不提供给新请求；已有摘要保留原样，允许含工具的回合重写和重复执行，已经发生的业务事实不撤销。

重写复用同一个回合 owner 与 T3 fence，回复游标不回退；成功时新消息、旧 canonical 条目删除和预览在同一事务交接。生成失败、空回复、取消或重写孤儿恢复均保留旧消息，不新增「已重写」标记或版本切换。新用户输入、手动编辑、删除和清历史撤销重写资格，迟到结果不能提交；旧语音等媒体候选仅在成功提交后交给 Media 裁决。验证入口：`npm run verify:chat-regeneration`。单条与多选分享均已接通。

单聊和群聊「多选」从长按菜单进入并选中起始消息，顶部显示「已选 N / 20 条」与取消，底部以删除和分享替换输入栏。输入草稿、附件和引用保留；Android 返回键先退出多选，失焦或切换会话清空选择。用户消息逐条计数，AI 按同一 run 的完整回复计一条，连续工具步骤、思考与正文联动选择；无 run 的现存历史按已有 logicalMessageId 归并，不猜测相邻消息归属。仅已发送的用户／AI 普通消息与媒体消息可作为选择入口，生成中的临时条目与独立业务卡片不参与选择。选择同轮任意气泡切换整轮状态，每轮只在第一个可见条目显示勾选控件；新消息不自动选择，多选期间不自动滚到底部。

单条长按「分享」与多选底栏「分享」共用目标选择、完整预览、可选附言与确认发送。一次发给一个其他 AI 单聊或群聊，最多 20 个选择单位；单条 AI 分享仍展开完整回复轮次。取消保留来源页选择及草稿，成功才退出多选；发送中禁止重复点击，失败保留预览。分享创建一条用户记录消息 `kind=shared_record`，非空附言在其后作为独立普通用户消息显示；两条及媒体引用沿用同一次单聊 canonical 提交／群用户消息与 plan 换代事务，以尾消息为输入上界，只启动一次回复。commit 后单聊宿主启动失败仍提示「记录已分享」，不把已提交消息当作失败重新发送；群聊继续沿用跨页面自动召唤。玻璃主题的记录卡沿用外层气泡，不额外叠加底色；Android 分享弹窗使用底部留白避让键盘，输入法收起后解除附言框焦点，避免透明系统栏下窗口未缩放或高度反馈导致闪动。

`SharedChatRecord` 保存原作者类别、姓名快照、稳定 agentId、时间、可见正文、附件和表情快照。整轮工具只保留可见历史状态，省略原始工具输入／结果与私有思考；语音保留转写。再次分享保留内部原作者，原消息改写或删除不改变快照；资产引用位于记录内部，仍由 Media 的 JSON 引用枚举裁决释放，旧 URI 在已有附件准备／发送事务中归入资产。

模型始终把分享当作用户提供的历史资料；每个接收者按自己的 agentId 生成「自己」，不按姓名猜测，也不把标记存进快照。当前输入、私聊未总结原文、群聊历史和管理员规划读取完整记录；摘要任务带 currentAgentId，要求保留重要发言的来源与原作者，避免把其他 AI 发言记成自己的。分享图片复用接收角色自己的视觉链路，并保留对应记录条目与原作者；历史读取不重复识别图片。验证入口：`npm run verify:chat-message-share`。

选择状态由共享 presentation hook 持有，删除用例在单次 databaseCoordinator 事务内按锚点读取完整轮次，不受历史分页和主题气泡合并影响；全部正文、思考和工具过程记录、单聊／群聊预览及重写资格撤销一起提交。独立业务卡片和工具已产生的业务事实不随聊天轮次撤销。commit 后再刷新时间线、通知执行宿主与释放媒体候选，失败保留选择。单条菜单删除保持原有逐气泡语义。验证入口：`npm run verify:chat-message-selection`。

- 发送与 optimistic message：`messages/application/SendUserMessage.ts`；
- 消息提交与会话 preview：`messages/application/MessagePersistence.ts`；
- 历史分页：`messages/application/MessageTimeline.ts`；
- AI 回复：`reply/application/ProcessAIReply.ts`；
- 群聊消息提交：`group/application/GroupMessageCommit.ts`；
- 群聊发言规划：`group/application/GroupSpeakerPlanning.ts`；
- 群聊发言任务：`group/application/GroupSpeechTaskExecution.ts`（持久队列逐项 CAS claim）；成员模型请求沿用角色资料的思维链开关，非流式与流式读取相同的 Provider 推理字段。
- 群聊动态任务追加：`group/application/GroupSpeechTaskAppend.ts`（AI 递归 @）；
- 群聊召唤编排：`group/application/GroupChatMessaging.ts`（薄计划编排）；顶部始终显示群名，召唤状态留在控制区。可见回复气泡与群预览在同一 fence 事务提交；前台正在查看会话时也失效列表预览与顺序。
- 管理员规划与成员发言共享 plan 的取消边界，强制终止／用户输入换代在持久终态提交后中止在途请求；取消不转化成管理员失败或全量召唤。
- 群聊强制终止：`group/application/GroupSpeechTermination.ts`（先持久撤销资格，commit 后再 abort）；
- 群聊发言队列浮层：`presentation/group/GroupSpeechQueueOverlay.tsx`（只投影持久 task 状态）；
- 页面入口：`presentation/shell/ChatScreen.tsx`（通过根 `index.ts` 对外）；
- Host 依赖装配：`src/host/composition/configureChatRuntime.ts`。

## 聊天摘要

聊天「更多」通过「相遇痕迹」菜单入口打开独立 Expo Router 页面（`chat/[aiId]/statistics`），与其他单聊管理功能共用原生 Stack；标题返回、安卓系统手势和返回键由同一路由栈处理，退出后回到「更多」，不另加页面级 BackHandler。页面直接聚合当前 AI 单聊中仍保存的已发送消息，不从摘要恢复统计，不受历史分页和清除历史的展示边界影响；物理删除的消息不再计入。用户消息逐条计数，AI 按完整 run 归并，没有 run 的历史分段按逻辑消息 ID 归并。字数只计用户／AI 正文 Unicode 字符（含标点和空白），语音计转写，思考、工具状态、业务状态卡和通话正文不计入。Token 从原始消息已保存的聊天调用用量聚合，同一调用的前言与工具状态去重，保留 Agent 循环用量；不额外累计摘要生成调用，缺失用量不估算。相遇时间直接使用 Assistants owner 已提供的 AIProfile.createdAt：AI 建表以来创建时间一直必填，创建时写入、更新设置不改写，备份恢复保留原值。聊天层信任该契约，不再查询首条消息、重复读取创建时间或增加旧数据兜底。天数为已度过的完整 24 小时，起始时间按设备本地时区显示到分钟。

聊天「更多」通过宿主导航打开独立摘要路由；摘要列表与新增／编辑均由 Expo Router Stack 承载，不再由菜单或列表持有页面弹窗。摘要正文与列表布局仍归 Chat presentation 所有。

summary/ 拥有用户维护、AI 只追加的永久摘要。菜单“聊天摘要”提供新增、编辑、删除和清空；删除／清除消息不联动删除既有摘要。单聊·主作为批次 N，总结期间保留全部未处理原文，提交段与 canonical 游标在同一事务交接。ChatTimelineSql.ts 与最小持久 run 锚点保证删除首项后排序和处理进度稳定；不保存来源正文副本。

普通单聊由 Host 注入全部摘要＋未处理原文，Current Input 单独保护。getChatSummaryContext 等稳定查询／命令位于根出口，模型 port、具体 Repository 和 worker 装配在 composition.ts。产品契约见 [Memory V3](../../../docs/memory-simplification-v3-implementation-spec.md)。

回复错误（`kind=error`）与已落库的工具终态（`type=toolStatus`）也是模型可见的历史资料。
自主唤醒复用普通单聊 Prompt 和完整摘要／未总结原文，只在末尾追加明确来源的唤醒输入。Chat 先保存开始记录，再准备并执行 Agent；流式思考和行动状态持续更新同一稳定条目，收到模型输出即记录响应证据，`type=agentActivity` 进入同一上下文。失败／取消保留半段原文，启动／回前台只将旧进程记录结算为中断，不重跑。响应证据不代表工具成功。过程记录不改写预览、未读或通知；真实语音／贴纸消息的媒体保存和消息引用同事务提交，随后沿用统一交付。

摘要游标不能越过仍在增长的条目，也不能越过尚无终态的自主 run；等待模型或工具时即使没有流式行，也必须保留整个 run 的原文，避免后续追加内容落到摘要游标之前。
`buildChatSystemEventModelText` 将它们标注为应用事件，以无指令权限的 `user` 上下文按 canonical 顺序传入，
不把 Chat 的 `senderType=system` 映射成 API 的高权限 `system`。摘要 N 按逻辑对话消息计数，同一 `logicalMessageId` 的分段合计一条，新发送的单聊整组图文共享该身份；范围内的应用事件
随同摘要与游标一起交接。工具记录只包含当时已保存的名称和批次状态，不能据此编造详细执行结果。
运行中、撤销或其他无模型语义的展示条目不进入上下文；同一 run 内仍由 Agent Runtime 回传真实工具调用与结果。

普通聊天与通话摘要均注入所属 AI 的真实人设，用自己的口吻简洁回顾与用户的共同经历，允许第一人称感受与符合关系的温度，同时保留重要事实、约定和未完成事项。事情讲清楚就停，不设目标字数；500 个 Unicode 字符仅为自动正文的硬上限，超长模型输出不提交，原文继续保留。已有摘要和用户维护不自动裁剪。

普通聊天与通话按统一时间线共同累计 N；通话中达标等待挂断，短通话继续累计。Calls 经 Host 端口提供仍可见的完整文本及接通／结束时间、类型、时长；这些事实仅作为本次总结输入，Chat 不为摘要段保存通话关联或事实副本。Chat 复用同一前台队列、模型请求、500 字校验和持久 claim；5000 字分片完成后一起交接。

处理进度与摘要正文分开持久化：普通消息使用 canonical cursor，通话使用会话级已处理 ID，两者均不绑定摘要段。提交正文与推进处理进度同事务完成；提交前保留待总结原文，提交后注入摘要正文与讨论时间。用户删段不复活原文或重新总结，清消息与删除源通话不删除已有摘要。清空摘要使旧 claim 失效并建立通话时间边界；跨边界的进行中通话只总结此后仍保留的文本，不复制来源正文。未接／拒接不生成交谈摘要。旧摘要通话关联表在启动升级中退休，已有正文与处理进度保持不变。

## 图片消息展示与发送

新用户图片与文件附件在事务外准备 MediaAsset batch，在原消息提交事务内物化稳定引用。提交失败补偿 canonical 准备文件；群聊保留当前输入草稿，单聊失败乐观气泡独立持有源文件供重发。成功后释放草稿源；取消、替换、失败气泡移除和页面退出都撤销各自持有，最后一个真实消费者退出后才删除文件。历史 committed legacy 文件不登记为草稿，不由此回收。用户/AI/群头像新写入也已切换稳定资产，确认头像后展示最终 URI 并回收 picker 副本。

一次发送中的每张普通图片独立保存为无气泡图片消息，文字（以及文件附件）保存在尾消息。单聊在同一个 T1 事务内提交整批消息、换代一次，commit 后只通知一次回复宿主；模型按原有固定输入区间同时读取这些独立消息。群聊同样在一次事务中提交完整批次，以尾消息作为计划换代和自动召唤的输入上界。引用和群聊结构化 @ 属于尾消息，乐观时间线与持久提交共享拆分及消息身份规则。

普通图片点击后全屏显示原图，支持双指缩放、双击放大／还原与放大后拖动；单指轻点退出，双击优先，双指触摸与已激活的拖动不会触发点击退出。关闭后销毁预览状态。表情包保持独立 Sticker 语义，只展示卡片，不提供点击预览。历史已提交的混合消息不做拆分迁移。

历史图片解析中显示加载状态，只有主图与缩略图均不可用时才显示“图片不可用”；各状态保持相同图片尺寸。列表回收按媒体引用隔离解析结果，并按消息身份重置预览；识别 metadata 的变化不重启图片加载。MediaAsset 的文件存在性由 resolver 保证，展示层只检查历史裸 URI，不重复校验资产或计算内容 Hash。回归验证：`npm run verify:chat-image-loading`。

## 图片识别模型选择

Chat 的 `chat_assistant_image_settings` 按角色保存视觉识别模型 ID，当前角色模型设置提供唯一选择入口。未选择时原图直接交给聊天模型；选择后先识别，再提供文字转述。聊天附件（包括群聊按目标角色组装的图片）、主动消息图片与通话摄像头截帧共用同一解析；已选择模型失效或识别失败时不自动改为直传。朋友圈和表情包系统保留各自的视觉选择。

群成员各自进行视觉处理，允许不同角色对同一张图片形成不同理解，不改为全群共享一次分析。文件读取继续保留 6000 字符和 CSV 前 12 行，分页工具与完整文件读取待产品决策。相册/拍照与文件选择器现有大小限制保留；暂不增加相册保存或外部文件分享入口。
模型资产仍由辅助模型中心持有，Host 装配 `ChatImageModels` 的窄端口；详见 [模型选择架构](../../../docs/architecture/auxiliary-model-selection.md)。
