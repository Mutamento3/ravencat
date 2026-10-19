# Chat 功能

Chat 拥有单聊、群聊、消息时间线和回复引擎。外部 Feature 只能从
`@features/chat` 使用稳定公共能力，不得深导入 Chat 内部目录；Host 的运行时装配
才可以使用 `@features/chat/composition`。

应用底栏入口 `BottomTabBar` 按主题选择视觉：Daylight / Night 使用 Rolling Ball，Glass 使用 Melting Ball，Paper Note 使用 Ink Circle。三个变体共用 Tab 数据、触摸入口和未读角标，选择状态与页面导航仍由 App 的 Expo Router 布局持有。Ink Circle 的图标固定，SVG 墨迹在 UI 线程描绘、淡出，结束后不持续运行。

历史上翻在距已加载窗口顶部约三屏时开始预取，每页 15 条，首屏窗口独立维护。原生拖动起点用于建立方向基线，拖动与惯性结束位置也参与同一个分页判定，避免普通滚动回调被合并或暂缓后遗漏用户需求；数据落地和锚点修正不自行续页，保留单请求与最多一个排队需求。

FlashList 的安装补丁由 `scripts/patch-flash-list-scroll-settle.cjs` 维护：预测位移只能占用既有缓冲区，实际视口始终被渲染窗口覆盖；分页与迟到测量按稳定 key 保留阅读锚点，修正后同步更新 JS 窗口。`verify-chat-scroll-settle.mjs` 使用真实列表管理器与 Android 锚点控制器验证快速滑动、迟到布局和暂停期间的末次位置，不在页面叠加第二套滚动补偿。

## 职责

单聊／群聊摘要共用 `summary/` 的 claim、两级交接、编辑、失败处理与查询。总结模型在摘要设置选择，空引用表示单聊当前聊天模型或群管理员；通用配置持续引用，修改后后续调用跟随，失效不替换。群信息页提供一级、二级正文、设置与诊断，群触发条数独立于成员上下文窗口。契约见 [两级摘要](../../../docs/architecture/chat-summary.md)。

四项主客配置实际参与 Host Prompt 装载：单聊带自身主·单聊及已参加群的客·群聊；群聊带自身客·单聊、当前群主·群聊及其他已参加群客·群聊。每群独立额度、客值 0 排除原文与摘要、来源注入开关及输入上界均由现有查询落实。对话设置可一次性复制四项条数到所选／全部 AI，之后独立修改。契约见 [主客上下文](../../../docs/prompt/context-window-primary-secondary-design.md)。

群成员回复复用 Agent Runtime 与授权工具链。语音、表情意图通过共享 timeline 在当前群任务事务中物化；每条提交检查持久资格，终止后停止执行并丢弃未提交媒体。图片下载／看图／头像／收藏沿用原 owner 和群任务资格；协议、朋友圈、记忆、账本、联网、手机、日程及 MCP 仍执行各自授权和主理限制。视频通话在群中禁止。一起听仅当前主理可用，卡片与后续消息落在目标群，用户操作沿用已有 Activity 网关。

群头像通过 `getGroupAvatarForAssistant` 提供只读查询：普通 AI 仅可读取当前启用的成员关系所在群，主理资格由可信 Host 提供。头像选择与成员关系在同一次查询中裁决，不加载管理员凭据或成员资料；Host 将结果接入应用设置工具和 Media 视觉读取。群聊回复中可省略群 ID 读取当前群，其他场景必须指定。当前群的身份背景提供工具参数 `group_id`，跨会话群背景已有的 `conversationId` 同样可用于定位。

- 管理单聊会话、消息、群聊及其领域模型和仓储端口；
- 摘要模块拥有聊天与通话的统一时间线、逻辑消息计数和原文交接。通话中达到门槛等待挂断，短通话继续累计；长原文每次最多5000字，全部分片成功后原子追加摘要与处理进度。Calls 的只读事实通过 Host 装配到同一数据库快照，不复制通话消息。
- 编排用户消息、外部 assistant 消息、主动回复、时间线查询和群聊命令；
- 由 Chat 自己完成消息提交后的 preview 和交付能力调用；
- 提供 ChatScreen、路由、会话、群聊、消息气泡与输入区；
- `useAgentTransientTimeline` 在合并前统一处理 canonical 与运行片段的到达投影，只确认已到达的 canonical 行，避免 SQLite 读回与原生到达通知交错时气泡消失、重现；交接不依赖滚动或绘制回执。
- 消息事件的全量刷新重读当前已加载身份覆盖的持久窗口，不复用首屏最近 20 条查询。SQLite 在同一读取快照内解析窗口身份，排除乐观发送 ID，保留其余历史并反映真实删除；发送和回复收尾不应通过裁切历史移动列表位置。
- 展开的思维链／行动步骤卡片中，每条思维链正文使用一个 Android 原生文字选区，可跨段落、列点和代码块拖动手柄选取复制。Markdown 保留标题、行内格式和列点，表格以文字分栏显示；工具状态与其他思维链不合并进当前选区。
- 思维链／行动步骤的展开意图由当前会话列表按稳定身份保存，列表项回收或重建后恢复各自状态；切换或重新进入会话时重置。滚动尺寸仍由每个实例重新测量，收起的行动步骤不投影正文节点。
- 文字选择的焦点不触发聊天列表／卡片滚动，折叠前由原生适配释放选区再卸载正文；输入区只根据真实键盘事件占位，自动转移的焦点不借用历史键盘高度。原生边界见 [原生文字选择](../../../modules/native-text-selection/README.md)。
- FlashList 分页定位修正期间只暂停消费滚动事件，恢复时必须处理末次原生位置；否则手势恰在暂停期间结束时，渲染窗口会停留在旧位置并持续空白。`postinstall` 通过 `scripts/patch-flash-list-scroll-settle.cjs` 修正依赖的事件所有者，保留最新 SyntheticEvent 的生命周期，不重放中间事件、不新增等待计时器。升级列表依赖时审查此补丁；行为验证为 `npm run verify:chat-scroll-settle`。
- 消息列表的持续贴底、触摸暂停和新消息提示统一由 `useChatBottomFollow` 拥有；视口变化与消息布局提交只向它请求跟随。同一帧合并请求，触摸期间保留请求，用户上翻、历史消息定位、切会话及卸载取消请求。FlashList 负责阅读锚定、初始定位和短列表底部排布，不开启自动追尾；分页只读取真实滚动活动。
- 消息下方的用量提示显示 API 返回的总量、输入、输出及缓存命中率（缓存命中 / 输入）；缓存统计随消息 metadata 保存，没有数据的旧消息或服务商显示「未提供」。多气泡仍只在用量尾段展示。对话设置可按角色关闭单聊提示，默认开启；paper-note 与 moon-kimi 固定关闭并冻结开关，切回其他主题恢复用户选择。
- 通过 conversation、messages、group、reply 各自的运行时端口接收 Host 注入的能力。
- 拥有语音消息的 transcript、播放状态、气泡展示和 T1/T3 原子提交；Speech 只负责 STT/TTS，Media 只负责 canonical 音频资产。
- paper-note 与 moon-kimi 的单气泡流式策略在执行宿主重读配置时同样生效，不依赖页面发送参数。展示合并只处理普通文字；同一模型轮次下的语音、表情等独立消息保留自身元数据。paper-note 按类型隐藏普通思维链，正文即使与思考文字相同也照常展示。
- 持有普通单聊工具包的持续展开状态，由 AI 主动打开或关闭，与 T3 正式回复同事务提交；Host 负责分包与动态 schema 暴露，状态不代表工具权限。
- Agent 异常终态的错误消息保留错误码、run 编号与模型已返回的工具名／执行结果码，随现有错误气泡持久化，重启后可查看和复制。诊断不保存工具参数、Prompt、正文或 observation，也不把未知结果写成成功或自动重试；取消与 supersede 仍不产生错误气泡。

单聊对话设置的名称、人设、头像、上下文可见条数、多气泡回复与群聊管理员配置自动保存；输入草稿校验由页面负责，合法字段独立提交，错误在字段旁显示并保留输入。
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
├── favorites/         # 独立消息收藏快照、命令与 SQLite 适配器
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

用户语音先在事务外录制并由 Speech 取得稳定转写，结束录音后返回待校对 draft；此时没有 canonical 消息，不更新预览，也不触发 AI。用户确认最终转写后，才通过 Media prepared batch 与 canonical 用户消息在 T1 同事务提交。draft 持有临时录音文件；取消释放文件，发送失败保留可重试草稿，成功提交或 discard 后进入终态。AI 的 `send_voice_message` 在单聊与群聊按既有授权暴露；TTS 与 backing prepare 在事务外完成，语音 intent 按 run-local sequence 在单聊 T3 或群任务提交事务内物化为 MediaAsset 与 assistant 消息。

语音正文是模型可见的 canonical transcript，但气泡、会话预览、通知和交付回调默认只显示 `[语音消息]`。`voice_played_at` 只在普通媒体播放器确认 started 后幂等写入，不能复用消息已读状态。

历史 AI 语音在模型上下文中表示为“ai语音转写：正文，发送语音需要调用工具”，每条转写旁都附带真实发送要求；附注不写入消息正文。普通聊天正文不会自动合成语音；本轮发送必须实际调用 `send_voice_message`，schema 尚未暴露时先展开 `chat` 工具包。基础提示词解释历史附注与真实语音的区别，工具说明负责调用步骤与失败语义。

`send_voice_message` 与 `select_sticker` 必须传入 `on_success`：回复已完整时选择 `finish`，还有语音、表情包、文字或其他操作时选择 `continue`。整批工具成功且最后一个工具选择 `finish` 后，Runtime 直接结束，Chat 将已准备的输出按原有 timeline 和 T3 fence 提交，无需模型补充“已发送”或空正文。任何工具失败仍回灌模型，失败召回不自动重试；同批前面的 `finish` 不会截断后面的工具。

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

### 消息收藏

单聊和群聊长按已发送的用户／AI 消息可收藏当前单条气泡，不展开 AI 整轮回复。所有主题保留长按入口，Moon Kimi 的内联操作继续展示；文件卡与语音卡由自己的触控入口打开同一菜单。表情包不提供翻译；通话状态与通话来源文本不提供翻译、引用和收藏；过程记录、业务卡片、分享记录和生成中的消息不参与收藏。

「我 → 个人」下方的「收藏」进入独立页面，提供全部、文本、音频、图片、txt/md 分类，按收藏时间倒序并使用稳定游标分页。图文与文件配文保存完整快照，按附件分类；表情包转换为普通图片展示，语音保留音频和转写，详情可查看完整正文、图片、文件并取消收藏。

`favorites/` 拥有快照、Repository port、命令与 SQLite adapter；Host 注入收藏仓储，App 持有具体路由。收藏不对消息、会话或角色建立级联外键，原文后续改写或删除不影响快照。重复收藏保留同一条及原收藏时间；收藏与消息删除在数据库事务内裁决。旧附件在事务外使用现有 Media prepared batch 准备，最终资产与收藏同事务提交。收藏引用进入 Media 的枚举、回收与备份清单，取消收藏提交后才裁决释放候选。收藏语音复用聊天播放器，以独立身份播放，不再更新原消息的已播放状态。

新上传文档仅支持 TXT/MD；正文最多 6000 个 Unicode 字符，超限明确拒绝，不再静默截断，预览摘要仍独立截短。旧 CSV/JSON 的查看与资产迁移保留，不与新上传资格共用白名单。验证入口：`npm run verify:chat-favorites`。

### 其他消息操作

单聊与群聊引用保存当时的正文、附件、语音转写和表情包快照。引用区可预览图片、打开文件和播放音频；引用语音使用独立播放身份，不改写原消息的已播放状态。媒体引用随消息 metadata 进入现有资产枚举与回收，原消息删除或改写不影响已发送快照。模型侧只提供被引用媒体的类型、名称和 `mediaAssetId`，由 AI 关联历史上下文，不因引用再次读取图片或发送文件正文、音频内容。旧消息仅有 `reply_to_text` 时继续显示已有文本。

单聊和群聊的消息长按菜单支持复制正文、手动改写、删除、引用和翻译。所有操作保留固定槽位，不可用项置灰禁用，语音转文字也不临时插入；全部操作均不可用时不显示菜单。改写适用于已发送的普通文字与混合消息正文，保留发言者、附件和消息身份；语音、纯图片、表情包与状态卡不支持改写。改写正文和当前预览在同一事务提交，不改变会话活动时间，也不自动触发 AI 回复；编辑期间正文变化或消息删除时保留草稿并提示。

单聊「重写」只面向普通用户输入产生的最新已完成回复回合，后续存在新用户消息或当前正在回复时不提供入口；用户消息、群聊、主动消息及通话等旁路回复不支持。点击任一文字、语音或表情气泡，暂时隐藏整轮 canonical 回复、思考和工具记录，顶部显示「对方输入中」。页面只提交持久化重写意图，原 Android execution host 使用当前模型配置、原回合的全部现存用户输入和附件执行既有 Agent 流程。直接历史截到原输入，旧回复及旧工具记录不提供给新请求；已有摘要保留原样，允许含工具的回合重写和重复执行，已经发生的业务事实不撤销。

重写复用同一个回合 owner 与 T3 fence，回复游标不回退；成功时新消息、旧 canonical 条目删除和预览在同一事务交接。生成失败、空回复、取消或重写孤儿恢复均保留旧消息，不新增「已重写」标记或版本切换。新用户输入、手动编辑、删除和清历史撤销重写资格，迟到结果不能提交；旧语音等媒体候选仅在成功提交后交给 Media 裁决。验证入口：`npm run verify:chat-regeneration`。单条与多选分享均已接通。

单聊和群聊「多选」从长按菜单进入并选中起始消息，顶部显示「已选 N / 20 条」与取消，底部以删除和分享替换输入栏。输入草稿、附件和引用保留；Android 返回键先退出多选，失焦或切换会话清空选择。用户消息逐条计数，AI 按同一 run 的完整回复计一条，连续工具步骤、思考与正文联动选择；无 run 的现存历史按已有 logicalMessageId 归并，不猜测相邻消息归属。仅已发送的用户／AI 普通消息与媒体消息可作为选择入口，生成中的临时条目与独立业务卡片不参与选择。选择同轮任意气泡切换整轮状态，每轮只在第一个可见条目显示勾选控件；新消息不自动选择，多选期间不自动滚到底部。

单条长按「分享」与多选底栏「分享」共用目标选择、完整预览、可选附言与确认发送。一次发给一个其他 AI 单聊或群聊，最多 20 个选择单位；单条 AI 分享仍展开完整回复轮次。取消保留来源页选择及草稿，成功才退出多选；发送中禁止重复点击，失败保留预览。分享创建一条用户记录消息 `kind=shared_record`，非空附言在其后作为独立普通用户消息显示；两条及媒体引用沿用同一次单聊 canonical 提交／群用户消息与 plan 换代事务，以尾消息为输入上界，只启动一次回复。commit 后单聊宿主启动失败仍提示「记录已分享」，不把已提交消息当作失败重新发送；群聊继续沿用跨页面自动召唤。玻璃主题的记录卡沿用外层气泡，不额外叠加底色；Android 分享弹窗使用底部留白避让键盘，输入法收起后解除附言框焦点，避免透明系统栏下窗口未缩放或高度反馈导致闪动。

`SharedChatRecord` 保存原作者类别、姓名快照、稳定 agentId、时间、可见正文、附件和表情快照。整轮工具只保留可见历史状态，省略原始工具输入／结果与私有思考；语音保留转写。再次分享保留内部原作者，原消息改写或删除不改变快照；资产引用位于记录内部，仍由 Media 的 JSON 引用枚举裁决释放，旧 URI 在已有附件准备／发送事务中归入资产。

模型始终把分享当作用户提供的历史资料；每个接收者按自己的 agentId 生成「自己」，不按姓名猜测，也不把标记存进快照。当前输入、私聊未总结原文、群聊历史和管理员规划读取完整记录；摘要任务带 currentAgentId，要求保留重要发言的来源与原作者，避免把其他 AI 发言记成自己的。分享图片复用接收角色自己的视觉链路，并保留对应记录条目与原作者；历史读取不重复识别图片。验证入口：`npm run verify:chat-message-share`。

选择状态由共享 presentation hook 持有，删除用例在单次 databaseCoordinator 事务内按锚点读取完整轮次，不受历史分页和主题气泡合并影响；全部正文、思考和工具过程记录、单聊／群聊预览及重写资格撤销一起提交。独立业务卡片和工具已产生的业务事实不随聊天轮次撤销。commit 后发布 `messagesDeleted`，统一时间线订阅按实际删除 ID 移除条目，保留已加载历史、分页边界与阅读位置；删除前发出的同步查询也不得复活这些 ID。统计、固定上下文与悬浮预览消费同一删除事实重读自己的投影。执行宿主通知与媒体候选释放留在 commit 后，失败保留选择。单条菜单删除保持原有逐气泡语义。验证入口：`npm run verify:chat-message-selection`、`node scripts/verify-chat-message-commit.mjs`。

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
- 冷启动由 Host 调用群计划中断收口：旧进程遗留的 pending/preparing/running 计划及未完成任务同事务标为失败，保留已发消息与已完成任务，不自动重跑；本进程从召唤读取/claim 前登记 owner，重建页面不误中断仍在执行的计划。
- 群聊发言队列浮层：`presentation/group/GroupSpeechQueueOverlay.tsx`（只投影持久 task 状态）；
- 页面入口：`presentation/shell/ChatScreen.tsx`（通过根 `index.ts` 对外）；
- Host 依赖装配：`src/host/composition/configureChatRuntime.ts`。

## 聊天摘要

聊天「更多」通过「相遇痕迹」菜单入口打开独立 Expo Router 页面（`chat/[aiId]/statistics`），与其他单聊管理功能共用原生 Stack；标题返回、安卓系统手势和返回键由同一路由栈处理，退出后回到「更多」，不另加页面级 BackHandler。页面直接聚合当前 AI 单聊中仍保存的已发送消息，不从摘要恢复统计，不受历史分页和清除历史的展示边界影响；物理删除的消息不再计入。用户消息逐条计数，AI 按完整 run 归并，没有 run 的历史分段按逻辑消息 ID 归并。字数只计用户／AI 正文 Unicode 字符（含标点和空白），语音计转写，思考、工具状态、业务状态卡和通话正文不计入。Token 从原始消息已保存的聊天调用用量聚合，同一调用的前言与工具状态去重，保留 Agent 循环用量；不额外累计摘要生成调用，缺失用量不估算。相遇时间直接使用 Assistants owner 已提供的 AIProfile.createdAt：AI 建表以来创建时间一直必填，创建时写入、更新设置不改写，备份恢复保留原值。聊天层信任该契约，不再查询首条消息、重复读取创建时间或增加旧数据兜底。天数为已度过的完整 24 小时，起始时间按设备本地时区显示到分钟。

聊天「更多」通过宿主导航打开独立摘要路由；摘要列表与新增／编辑均由 Expo Router Stack 承载，不再由菜单或列表持有页面弹窗。摘要正文与列表布局仍归 Chat presentation 所有。

summary/ 拥有一级、二级永久摘要、开关、token 归纳阈值与查询工具。菜单“聊天摘要”提供两级查看、编辑、删除和清空；两级独立维护，不因另一层编辑或删除自动更新。单聊·主作为一级批次 N，总结期间保留全部未处理原文；一级达到 token 阈值时领取当时全部待归纳摘要，含刚新增的一批，成功提交二级正文和来源标记后才替换上下文。ChatTimelineSql.ts 与持久 run 锚点保持原文交接顺序，不保存原文副本。

生成开启时 Host 读取剩余原文；暂停且无固定时绕过摘要游标读取最近 N 条逻辑消息。已有摘要是否注入独立控制。对话设置可返回消息列表，由长按菜单固定具体消息起点；固定范围包含起点到最新全部原文，暂停两级生成但保留原游标与近期参数，页面显示当前起点与逻辑对话数。取消、删除或清空起点后恢复近期窗口，生成需手动开启并沿原进度续接。全部设置按 AI 的 canonical 单聊保存，不跨 AI 生效。Current Input 单独保护。search_chat_summaries 由 Chat 拥有并放入记忆工具包，按时间与关键词查询，两级和已归纳原记录均可查，删除正文立即退出后续检索。稳定命令／查询在根出口，模型 port、具体 Repository 和 worker 装配在 composition.ts。当前契约见[对话两级摘要](../../../docs/architecture/chat-summary.md)。

回复错误（`kind=error`）与已落库的工具终态（`type=toolStatus`）也是模型可见的历史资料。所有工具统一保留调用记录，包括通话、语音发送和表情包查询／发送；媒体消息与通话卡片不替代工具历史。工具意图提出时建立批次状态，参数或授权拒绝也保留失败状态。通话提交后停止模型续轮，已经完成的工具记录仍通过 canonical 提交进入后续上下文。
自主唤醒复用普通单聊 Prompt 和完整摘要／未总结原文，只在末尾追加明确来源的唤醒输入。Chat 先保存开始记录，再准备并执行 Agent；流式思考和行动状态持续更新同一稳定条目，收到模型输出即记录响应证据，`type=agentActivity` 进入同一上下文。失败／取消保留半段原文，启动／回前台只将旧进程记录结算为中断，不重跑。响应证据不代表工具成功。过程记录不改写预览、未读或通知；真实语音／贴纸消息的媒体保存和消息引用同事务提交，随后沿用统一交付。

摘要游标不能越过仍在增长的条目，也不能越过尚无终态的自主 run；等待模型或工具时即使没有流式行，也必须保留整个 run 的原文，避免后续追加内容落到摘要游标之前。
`buildChatSystemEventModelText` 将它们标注为应用事件，以无指令权限的 `user` 上下文按 canonical 顺序传入，
不把 Chat 的 `senderType=system` 映射成 API 的高权限 `system`。摘要 N 按逻辑对话消息计数，同一 `logicalMessageId` 的分段合计一条，新发送的单聊整组图文共享该身份；范围内的应用事件
随同摘要与游标一起交接。工具记录只包含当时已保存的名称和批次状态，不能据此编造详细执行结果。
运行中、撤销或其他无模型语义的展示条目不进入上下文；同一 run 内仍由 Agent Runtime 回传真实工具调用与结果。

普通聊天与通话摘要均注入所属 AI 的真实人设，用自己的口吻简洁回顾与用户的共同经历，允许第一人称感受与符合关系的温度，同时保留重要事实、约定和未完成事项。一级、二级均只返回纯正文，不要求 JSON 输出包装；模型请求边界负责非空与截断检查，Chat 直接提交正文。提示词要求每段一级正文控制在 500 个 Unicode 字符以内、写得更短更好；实际不以字数拒绝有效正文，不截断或重复请求。两级真正失败后最多自动重试一次，旧任务已用完预算时在队列准备阶段暂停；手动重试单独执行一次。

普通聊天与通话按统一时间线共同累计 N；通话中达标等待挂断，短通话继续累计。Calls 经 Host 端口提供仍可见的完整文本及接通／结束时间、类型、时长；这些事实仅作为本次总结输入，Chat 不为摘要段保存通话关联或事实副本。Chat 复用同一前台队列、模型请求和持久 claim；5000 字分片完成后一起交接。

处理进度与摘要正文分开持久化：普通消息使用 canonical cursor，通话使用会话级已处理 ID，两者均不绑定摘要段。提交正文与推进处理进度同事务完成；提交前保留待总结原文，提交后注入摘要正文与讨论时间。用户删段不复活原文或重新总结，清消息与删除源通话不删除已有摘要。清空摘要使旧 claim 失效并建立通话时间边界；跨边界的进行中通话只总结此后仍保留的文本，不复制来源正文。未接／拒接不生成交谈摘要。旧摘要通话关联表在启动升级中退休，已有正文与处理进度保持不变。

## 图片消息展示与发送

新用户图片与文件附件在事务外准备 MediaAsset batch，在原消息提交事务内物化稳定引用。提交失败补偿 canonical 准备文件；群聊保留当前输入草稿，单聊失败乐观气泡独立持有源文件供重发。成功后释放草稿源；取消、替换、失败气泡移除和页面退出都撤销各自持有，最后一个真实消费者退出后才删除文件。历史 committed legacy 文件不登记为草稿，不由此回收。用户/AI/群头像新写入也已切换稳定资产，确认头像后展示最终 URI 并回收 picker 副本。

一次发送中的每张普通图片独立保存为无气泡图片消息，文字（以及文件附件）保存在尾消息。单聊在同一个 T1 事务内提交整批消息、换代一次，commit 后只通知一次回复宿主；模型按原有固定输入区间同时读取这些独立消息。群聊同样在一次事务中提交完整批次，以尾消息作为计划换代和自动召唤的输入上界。引用和群聊结构化 @ 属于尾消息，乐观时间线与持久提交共享拆分及消息身份规则。

昵称仅属于用户界面。新引用和分享条目在生成快照时，按结构化 @ 的稳定目标 ID 生成独立 `modelText`，公开名称目录只取助手 `name`；界面正文 `text` 保留原称呼。模型的引用、分享记录和摘要共用这份公开正文，再次转发保留它，不重新从界面文字猜身份。分享来源标题 `sourceName` 只用于卡片和预览，不进入模型；作者标识继续使用公开名称与稳定 agentId。用户普通正文不通过昵称字典替换。`verify:chat-message-share` 验证跨 AI 分享、群昵称引用、再次转发和摘要输入的隔离。
旧引用或分享没有保存公开投影、且正文含 `@` 时，模型只收到身份信息缺失的占位说明；界面原文不变。旧快照丢失了结构化提及目标，不能按当前备注猜身份，也不能把原文当成已经公开化的内部数据。

普通图片点击后全屏显示原图，支持双指缩放、双击放大／还原与放大后拖动；单指轻点退出，双击优先，双指触摸与已激活的拖动不会触发点击退出。关闭后销毁预览状态。表情包保持独立 Sticker 语义，只展示卡片，不提供点击预览。历史已提交的混合消息不做拆分迁移。

历史图片解析中显示加载状态，只有主图与缩略图均不可用时才显示“图片不可用”；各状态保持相同图片尺寸。列表回收按媒体引用隔离解析结果，并按消息身份重置预览；识别 metadata 的变化不重启图片加载。MediaAsset 的文件存在性由 resolver 保证，展示层只检查历史裸 URI，不重复校验资产或计算内容 Hash。回归验证：`npm run verify:chat-image-loading`。

## 图片识别模型选择

Chat 的 `chat_assistant_image_settings` 按角色保存视觉识别模型 ID，当前角色模型设置提供唯一选择入口。未选择时原图直接交给聊天模型；选择后先识别，再提供文字转述。聊天附件（包括群聊按目标角色组装的图片）、主动消息图片与通话摄像头截帧共用同一解析；已选择模型失效或识别失败时不自动改为直传。朋友圈和表情包系统保留各自的视觉选择。

群成员各自进行视觉处理，允许不同角色对同一张图片形成不同理解，不改为全群共享一次分析。文件读取继续保留 6000 字符和 CSV 前 12 行，分页工具与完整文件读取待产品决策。相册/拍照与文件选择器现有大小限制保留；暂不增加相册保存或外部文件分享入口。
模型资产仍由辅助模型中心持有，Host 装配 `ChatImageModels` 的窄端口；详见 [模型选择架构](../../../docs/architecture/auxiliary-model-selection.md)。

摘要任务、失败重试与调用诊断由 summary/ 持久保存，一级／二级独立计数、共用 claim。主列表只有一个二级集中编辑入口，一级只显示未归纳记录；二级页用一个正文框编辑，已归纳来源跨批次按时间排列，展开可编辑，调用信息仍保留。合并正文和来源关联同事务提交，拒绝覆盖编辑期间的新二级；失败详情仍可静默排队重试。页面共享主题表面并适配原生玻璃。摘要设置独立路由保存阈值、等待时间与输出额度，输入自动保存，离开先确认草稿。详见[任务与页面契约](../../../docs/architecture/chat-summary.md)。
