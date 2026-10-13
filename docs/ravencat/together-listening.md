# Together Listening V1 当前架构与产品基线

> 本文描述 Together Listening V1 的当前产品与架构契约。Android、真实网易云服务和多端展示仍需设备验收。
>
> Together Listening 不是网易云官方“一起听”，也不属于 `neteaseMusic` Tool Package。它是 RavenCat 独立的跨 Feature 产品体验：用户与当前主理 AI 通过双向邀请进入显式 Activity，并由 Chat、Prompt、App 内 indicator、standard ongoing notification 和 Floating Layer 投影当前状态。
>
> V1 只支持网易云音乐。扩展到其他媒体产品前，不建立 generic media provider 产品抽象。


## 1. 产品语义

当前主理可在单聊与群成员回复中使用已授权的一起听工具，仍复用同一轮冻结快照与 Activity owner。群邀请卡使用目标群身份与公开参与者名称，首张投影受群任务持久资格约束；终止后的失败首投影不会复活卡片。群页的接受、拒绝、退出沿用 Chat 网关，后续消息与群列表预览由共同消息命令在同一事务交接。一起听仍表达用户与主理的活动，不把其他群成员自动加入，不新增后台唤醒。

Together Listening 表达用户与当前主理 AI 已经通过显式邀请和接受，共同进入一次一起听 Activity。

```text
NetEase MediaSession
= exact-package 播放事实与 transport control

Together Listening Activity
= invitation / participant / lifecycle truth

Presentation
= Chat timeline / App indicator / notification / Floating PANEL 投影
```

被动 MediaSession observation 不得自动 wake AI、发消息、创建邀请或进入 Together Listening。用户开始播放网易云，只表示下一次合法模型运行可以知道当前播放事实。

## 2. V1 范围

V1 复用 Device Control 已验证的网易云 exact-package MediaSession 能力：

- `mediaId / title / artist / album / durationMs`；
- playback state、position、speed 与更新时间；
- 本地播放时系统当前选中媒体路由的设备名称；远程播放只标记远程，不冒用本机输出；
- advertised actions；
- `pause / resume / next / previous` transport control。

Together Listening 不重新实现媒体观察或播放器控制，也不支持其他播放器、播客、听书、generic media provider arbitration、系统 PCM 捕获、假 waveform，或独立的 seek / queue / transport 内核。

`playing / paused / buffering / connecting` 可以继续使用；`stopped / none / error / no_active_session` 不能新建邀请，并会参与现有 Activity 的终态收口。是否处于网易云前台不是 eligibility 依据；后台保有合法 MediaSession 时仍可发起或继续 Activity。

## 3. Ownership

```text
Device Control / MediaSession
= exact-package playback facts + transport controls

Together Listening
= invitation / activity / participant / lifecycle / product rules

Chat
= timeline entry persistence、排序与 UI message projection

Prompt Host
= User Runtime Status 与 Current Shared Activity composition

Floating Layer / Notification
= app-external projection
```

Together Listening 可以在 Host composition 中消费 Device Control public primitive，但不得并入 `neteaseMusic` Tool Package，不得让 Device Control、Chat card、notification 或 Floating PANEL 成为 Activity truth，也不得因 MediaSession 进入 `playing` 自动创建 Activity。

## 4. Activity 与状态机

V1 是双向邀请制。无论用户还是 AI 发起，都必须经过另一方接受后才能进入 `active`。

```ts
type TogetherListeningPhase =
  | 'pending_user_response'
  | 'pending_ai_response'
  | 'active'
  | 'declined_by_user'
  | 'declined_by_ai'
  | 'ended';
```

同一 `activityId` 贯穿邀请、回应、active 与终态。V1 全局最多存在一个 non-terminal Activity：`pending_user_response / pending_ai_response / active`。

只有当前 Host AI 可以参与。Host 被替换、删除或失去 authority 时，现有 non-terminal Activity 必须进入终态，不得静默替换参与者。所有状态转换由 Together Listening application command 通过 Repository transaction / CAS 提交；Presentation 禁止直接 patch phase。

## 5. 双向邀请

```text
用户发起
→ 读取当前 Host 与网易云 eligibility
→ 创建 pending_ai_response 与用户侧 timeline card
→ AI 调用 respond_to_listening_invitation
→ accept 进入 active；decline 进入 declined_by_ai

AI 发起
→ invite_listening_together handler 读取最新事实
→ 创建 pending_user_response 与 AI invitation card
→ 用户接受进入 active；拒绝进入 declined_by_user
```

用户拒绝 AI 邀请后，post-commit follow-up 使用独立场景 `together_listening.post_user_decline`，以严格 JSON 在 `send_message | stay_silent` 中选择。它不暴露工具；失败不会回滚已提交的拒绝事实。只有 `send_message` 才通过 Chat 的外部 assistant message 入口落库。

## 6. Host AI Tools

Together Listening 提供三只 Host-only 工具：

```text
invite_listening_together
respond_to_listening_invitation
leave_listening_together
```

Tool Registry / Catalog 永久注册这三只工具。合法 Host 模型场景下，schema 表达持久产品能力，不随 Activity phase 或瞬时 MediaSession 状态切换。

具体操作是否合法由 handler 在执行时读取最新 Host authority、Activity 与网易云 observation 后裁决，并返回 typed state error。Schema exposure 不构成可提交状态的证明。三只工具服从持久工具权限，只进入 Host 私聊回复与 `raven_cat.ai_schedule_trigger`；`post_user_decline` 不暴露工具。

## 7. Prompt awareness

User Runtime Status 与 Together Listening Context 是两个独立 block：

```text
【当前用户状态】
- 正在听歌：网易云音乐《歌曲名》— 歌手

【当前共同活动】
- 你与用户正在一起听网易云音乐。
- 当前正在一起听歌曲：《歌曲名》— 歌手

【当前歌词】
- 本轮播放位置 1:03 对应的一句歌词："当前播到的歌词"
```

普通播放只生成用户播放状态，不能据此推断共同活动。当前共同活动块始终明确表达当前主理 AI 的 `active`、等待邀请回应或没有正在进行的活动，覆盖历史对话和旧工具结果中的活动描述。`active` 时即使歌曲观察暂时不可用，也仍表达共同活动存在。Chat 与 autonomous / proactive prompt 都消费这些事实。

媒体输出与歌曲共享本轮快照：本地 session 读取 Android `MediaRouter2` 的系统选中路由名称，按系统原文呈现外放、有线耳机或蓝牙设备名称。这是系统媒体输出，不承诺第三方 App 的逐音轨路由；不通过设备名称猜测蓝牙耳机／音箱类别。原生输出观察失败时省略设备事实，不影响 Activity eligibility；远程 session 不读取或呈现手机路由。设备切换不会自动唤醒 AI，下一次合法模型 run 读取最新状态。

同一次模型 run 的准备阶段捕获一份 finalized runtime snapshot，供 User Runtime Status、Current Shared Activity 与运行准备共同消费。Tool handler 执行时仍读取最新事实，因为模型运行期间状态可能变化。MediaSession 变化只更新运行时事实，不自动 wake AI，也不写 Chat message。

邀请等待回应与 active 时，模型准备将歌词嵌入同一个运行时状态块。用户发起邀请的首轮即携带当前一句；AI 发起邀请或接受邀请的工具结果也携带当前一句，使当轮工具续轮立即可读。退出、普通播放和非参与 AI 不读取或注入歌词。indicator、通知投影与退出 command 不触发歌词请求。

Phone Tools 复用现有公开歌词 backend，按 MediaSession 提供的正整数歌曲 ID 读取 LRC，缓存当前歌曲的解析结果和在途请求。播放中以 position、speed 和更新时间推算本轮采样位置；暂停／缓冲时位置不自行推进。仅返回命中时间区间的一行，支持重复时间标签、毫秒和 LRC offset，空白时间标签表示当前没有歌词；响应被截断时不延续无法证明完整的末行。缺少可证明的歌曲 ID、进度或带时间戳歌词时标记当前句不可用，不按歌名搜索补配，不发送全文。歌词只作为引用资料，没有指令权限。

采样冻结在本轮模型准备时刻，后续每次合法模型运行重新定位，切歌／拖动进度按新播放快照处理。歌词变化不自动唤醒 AI，不逐句写 Chat 或 Activity 数据库。

## 8. Chat timeline

用户或 AI 发起邀请时均写入专属 Together Listening card。同一 `activityId` 使用稳定 `clientMessageId` 原地 patch：

```text
pending → active
pending → declined
active → ended
```

卡片只持久化 Activity lifecycle，不持久化当前歌曲、进度或 playback state。切歌、暂停和 position 更新不得高频写 Chat DB。

首张用户邀请仍作为 canonical user turn。非结束卡片阶段以应用历史事件进入 Chat 统一上下文与摘要；结束时在实际结束位置独立追加一条 `system` 事件，携带 Activity identity、结束原因与 lifecycle timestamp。旧卡原地更新和新事件在 Chat 同一事务内提交，结束事件按 Activity 稳定键幂等落库，不挂到原邀请 run，也不触发新用户回合或 AI 回复。用户退出时展示“你已退出一起听，本次一起听已结束。”；AI 退出时使用 Host 提供的 AI 显示名字。模型历史继续用“用户”表达用户退出，避免展示中的第二人称被解释为 AI；事件复用工具记录／回复错误的应用历史上下文通道。

结束后的旧卡不重复投影成历史事件。这样，即使原邀请卡已被摘要游标越过，结束事实仍属于后续原文；它不依赖旧卡是否还在近期窗口内，也不把原邀请正文重新解释为用户的新指令。历史卡片与结束事件都不能裁决当前是否仍在一起听。

AI 在 Agent run 内发起邀请时，card 使用当前 `turn_run_id` 作为 run-associated external timeline item；后续 lifecycle patch 不改变排序身份。用户发起的 card 是普通用户消息。

Chat card 的历史时长由 canonical lifecycle timestamp 推导：

```ts
durationMs = endedAtEpochMs - activatedAtEpochMs
```

不得从 message timestamp、MediaSession position 或 card 插入时间推算。Active card 不启动 live duration ticker；会话 preview 保持稳定 lifecycle 文案。

## 9. 实时媒体事实与终态

Activity 与播放状态保持正交：切歌不改变 Activity id，暂停、缓冲、观察失败以及权限或元数据暂时不可用不制造组合 phase，也不结束 Activity。

`no_active_session / playback_stopped / playback_none / playback_error` 等明确媒体终态、Host authority 丢失、factory reset，或冷启动恢复发现残留状态不可继续时，由 canonical lifecycle command 将 Activity 收口为 `ended`。

进入终态后，Chat card patch 为终态，Prompt 明确注入当前没有正在进行的一起听活动，App indicator、standard notification 与 Floating projection 清除。

## 10. Presentation

### 10.1 Chat Activity Card

Chat card 记录邀请与生命周期，提供接受、拒绝和退出入口，并在终态保留历史摘要。它不显示实时歌曲、播放进度或 active 实时时长。

### 10.2 App 内 indicator

App 内 indicator 只在 Activity 为 `active` 时显示，跨普通路由挂载；全屏 Calls route 可以临时隐藏，但不能结束 Activity。

它展示用户与 Host AI identity、当前 Together 状态、媒体摘要和 live Activity duration。Duration 由 `activatedAtEpochMs` 在前台本地计算，不新增 SQLite 字段或高频写入。Indicator 支持返回精确聊天、canonical user leave，以及 expanded / collapsed 的水平吸附交互。

### 10.3 Standard ongoing notification

Notification 只投影 `active` Activity，使用稳定 ID、LOW channel 与系统 chronometer。内容表达 Together 状态与 Host AI，不复制 MediaSession observer，也不展示无法保证 freshness 的歌曲进度。

点击进入精确聊天；leave action 通过 durable pending response 与 Headless fallback 汇入 canonical `leaveTogetherListeningByUser`。Dismiss suppression、冷启动 reconciliation 与 factory reset 清理由 notification owner 负责，不反向改变 Activity truth。

### 10.4 Floating Layer capsule

Together Listening 与 Floating Layer 是 peer features。Host 把窄 projection DTO 投给既有 Floating Layer PANEL；Together 不创建第二个 WindowManager owner、service 或 bubble，也不因 `active` 自动启动或展开 Floating Layer。

Host 始终同步 active projection，未开启悬浮窗或缺少权限时只保存原生展示缓存；之后 Service attach 即恢复当前一起听状态。结束 Activity 时同样清除缓存，悬浮窗开关不参与 Activity 投影的接收或清理。

PANEL 只消费 Activity/chat identity、AI/user identity 与 `activatedAtEpochMs`，并在资料更新后重投影自定义头像。既有面板以 `CHAT / TOGETHER` pager 承载两种内容；Together active 时可以进入 TOGETHER 页，结束时不会破坏普通 CHAT 页。

时长由 native ticker 展示；打开聊天使用精确 identity，收起复用既有 collapse intent。App 前台时 Host suppression 与原生 Activity lifecycle fail-safe 共同隐藏悬浮窗口；未知前后台状态 fail-closed。Floating cache 只是 projection cache，不能决定 Activity lifecycle。

App 外 V1 不声称 Android Live Update、promoted ongoing notification 或 OEM 私有胶囊能力。

## 11. 退出语义

用户可从 Chat card、App indicator 或 notification action 退出；AI 可调用 `leave_listening_together`。所有入口最终汇入同一个 canonical leave command：

```text
active → ended
```

Source 只记录 provenance，不创造不同的结束流程。外部 notification action 校验精确 Activity / Host / chat identity；所有入口最终都重新读取 current Activity 与 Host authority，迟到 action 不能结束新的 Activity。

## 12. 与网易云手机能力的关系

网易云能力提供公开结构化数据、官方 App exact-song route、MediaSession observation 和 transport control。Together Listening 在这些能力之上拥有独立的邀请与 Activity lifecycle，不是 `neteaseMusic` package child 或 Device Control product state。

## 13. 长期不变量检查

- V1 是否仍为 NetEase-only？
- MediaSession fact、Activity truth 与 presentation 是否保持分离？
- 是否仍需显式邀请和接受才能进入 `active`？
- 播放变化是否没有自动 wake AI 或写 Chat message？
- Tool schema 是否表达持久能力，由 handler 裁决当前状态？
- 同一模型 run 是否消费一致 snapshot，Tool 执行时是否读取最新事实？
- Chat card 是否只记录 lifecycle，不承载 volatile media state？
- 所有退出入口是否汇入同一 canonical command？
- Host 变更、factory reset 与明确媒体终态是否可靠收口？
- Notification 与 Floating PANEL 是否始终只是 projection？
