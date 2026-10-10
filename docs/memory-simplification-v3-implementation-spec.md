# Memory V3 产品与架构契约

> 状态：当前产品契约／唯一实施依据，已接入生产代码；设备与真实模型验收尚未完成。
>
> 日期：2026-10-04（Asia/Shanghai）。
>
> 当前入口与验证范围见 [Memory README](../src/features/memory/README.md)。自动化验证不替代设备界面、真实模型与 Android 原生恢复验收。
>
> 文件定位：[当前实现索引](./memory-simplification-v3-reference-index.md)。

本文描述已接入生产的产品语义、所有权、检索、摘要、升级边界和验收要求。不恢复草稿、管理员、主题树、来源证据或独立 Memory Agent。

## 1. 产品目标与范围

长期记忆收敛为 AI × user pair pool 内的独立条目，正文可人工控制，embedding 可选。

相关能力分别是：

1. Recent Chat：尚未成功总结的 canonical 原始聊天上下文。
2. Conversation Summary：用户拥有的持久聊天摘要，AI 只追加新内容。
3. Passive Recall：用户配置关键词，当前用户输入命中时自动注入相关长期记忆。
4. Active Recall：聊天 AI 显式调用 recall_memory 搜索、翻页。
5. Long-term Memory：AI 显式调用 remember_memory，或用户手动创建。
6. 更新与遗忘：用户管理正文，AI 调用 update_memory 更新已有条目，在用户明确要求时调用 forget_memory 删除条目。

长期记忆与聊天摘要是两个系统。长期记忆保存值得长期保留的独立事实；摘要保存连续聊天的上下文，不要求内容值得永久成为 MemoryEntry。

长期记忆工具限定在普通一对一 Chat 的既有授权边界；通话只读参与被动召回，不因此开放群聊、通话、时刻或自主任务的长期记忆写入工具。主客窗口设计不等于这些场景已接通，具体边界见 §19。

## 2. 所有权与信任边界

| Owner | 职责 |
|---|---|
| Memory Feature | pair pool、MemoryEntry、用户创建／编辑／删除、新建／检索／更新／删除工具用例、trigger 与关系开关、lexical 检索、搜索结果队列、可选 embedding 与 worker、Memory UI |
| Chat Feature | canonical 上下文投影、摘要处理进度／claim、用户维护摘要、AI 追加摘要、日期锚点、摘要与未总结原文的查询 |
| Host | 注入可信身份、工具执行上下文、模型与生命周期；组装 Prompt；不复制业务状态 |
| platform | 模型／网络错误边界、SQLite bootstrap／migration／databaseCoordinator 等技术能力 |

模型参数、用户输入、模型输出在各自外部边界校验一次。Repository 负责持久化授权范围、事务与 CAS；已经形成的可信 DTO 不在下游重复解析、兜底或校验。

Memory、摘要和工具结果均是无指令权限的资料，正文中的提示词或工具外观文本不能获得执行权限。

## 3. 明确退役的旧设计

不再运行或新建：

- 自动逐消息提取、memory_drafts、中间草稿审核；
- Memory Administrator、memory_admin 专用模型配置、自动整理阈值；
- topic tree、topic overview、目录创建／合并／拆分；
- candidate / active / cooling、memory usage、MemorySessionRuntime；
- recent_memory_capsules 与旧 memory_session_context；
- F7 独立 search/read 检索 Agent、第二套 Agent loop；
- legacy / shadow / runtime mode；
- 写入时 searchKeywords、自动 trigger 提取、同义词模型；
- Memory 来源消息、sourceExcerpt、自动原文快照或证据关系；
- 无损旧记忆迁移与 migration archive；
- 摘要递归压缩、summary-of-summary、AI 重写已有摘要。

最终只保留一套 flat Memory 生产模型。旧树／管理员／草稿／粘连／胶囊／F7 生产路径已经删除，历史 SQL 不作为恢复旧产品语义的理由。

## 4. MemoryEntry 与 500 字上限

概念字段包括：

- id、poolId、content、可选 summary；
- rememberedAt、createdAt、updatedAt；
- contentRevision；
- 必要的 embedding 派生状态或派生表关联。

不包含 topicId、写入时 searchKeywords、sourceConversationId、sourceMessageIds 或原文副本。用户和 AI 可以把必要原话直接写进 content，系统不自动溯源。

正文必须非空，单条上限为 **500 个 Unicode 码点**。保存时只去除正文首尾空白，不为检索改写 canonical 正文；去除首尾空白后的中英文、数字、标点、内部空格和换行均计入字符数。不是 500 个英文单词，也不是 500 token。

新建和编辑使用同一规则。UI 显示字符数，工具 schema／输入边界明确长度规则；超限返回可修正错误，不静默截断、不调用第二个模型压缩、不自动切成多条。用户或聊天 AI 自行缩句或按独立事实拆分。

summary 是独立的可选检索摘要，最多 50 个 Unicode 码点，不占正文的 500 字额度；去首尾空白后为空则保存为 NULL。迁移107给旧条目增加空摘要及空规范化投影，不改正文、时间、contentRevision 或有效向量，不自动调用模型补摘要。contentRevision 同时覆盖正文与摘要；任意一个编辑都推进 revision 并更新向量。

rememberedAt 表示记住该条目的时间，不是正文中事件发生的日期。用户编辑只更新 updatedAt／contentRevision，不自动把 rememberedAt 改成最新召回时间。

## 5. 显式写入与用户管理

AI 调用 remember_memory 时控制自然语言正文和可选摘要。工具成功即形成正式 MemoryEntry，不经过草稿、管理员或第二个提取模型。

pool、当前 AI 身份、系统时间以及执行幂等键由可信上下文提供，模型不能选择另一个 AI 的空间。用户在管理 UI 中也可以创建、编辑、删除所选空间的条目。

AI 调用 update_memory 时提供 memoryId 与更新后的完整 content，复用用户编辑命令；不能指定 pool 或其他 AI。目标 ID 来自已保存或检索结果，更新替换该条正文、保留条目 ID／rememberedAt，推进 contentRevision／updatedAt 并标记向量待更新。500 字规则与用户编辑相同；不存在或不属于当前空间的目标返回错误，不自动新建替代条目。聊天摘要没有此更新入口，AI 仍只能追加摘要。

更新工具可同时提供 summary；省略时保留已有摘要，空字符串清除摘要。记忆编辑页面同时维护摘要与正文。

协议空间支持单向转为当前 AI 的记忆。摘要与正文分别保存，不拼接前缀；编辑详情可以使用当前未保存的输入。Host 解析授权空间后，以同一短事务检查协议快照、调用两边 Repository 创建记忆并删除原协议；失败回滚，协议已被其他入口修改则拒绝转换，重复并发请求只有一个成功。commit 后发布记忆刷新与向量任务唤醒。成功后原协议退出常驻注入，记忆独立维护与按需召回，没有来源关系、同步或反向转换。

同一 run／tool-call 重投只提交一次，幂等约束由 Memory Repository 的原子写入保证；正文相同不是幂等键，不能压掉后来一次独立记录。

成功的工具提交独立于后续聊天最终回复提交。后续聊天失败或取消不回滚已经成功保存的记忆；取消阻止未提交工作，不能伪称已保存。

正文 commit 与派生任务分离：短事务写正文及其派生待处理状态，commit 后通知 UI／唤醒 embedding worker。事务内不请求模型或发布 subscriber。

## 6. 用户配置的被动关键词

Passive Trigger Keyword 是独立配置，不是每条 MemoryEntry 的标签，由用户手动维护，限定在对应 Memory pool 内。

例如 RavenCat、香蕉糖果、考研、Kimi、10月10日。当前用户输入包含 trigger 时，允许补入自动或手动关联的记忆。用户配置后的同名联想可接受，不增加语义分类器消除误触发。

输入、trigger、Memory 正文与摘要的匹配投影采用相同的 NFKC／大小写归一化与首尾空白处理；匹配是不区分大小写、兼容全半角的字面包含，不自动扩展同义词或英文词边界。canonical 正文与摘要本身不被 normalization 改写。

trigger 不得为空，规范化后的重复 trigger 在同一 pool 中合并。用户可用逗号、顿号、分号或换行批量添加，空项忽略，全部为空则拒绝。主动 keywords 也使用同一规范化规则，去除空项、去重后计算不同关键词命中数。

## 7. Trigger 关系与开关

规范化后的 Memory 正文或摘要包含规范化 trigger 时自动关联；用户也可手动绑定同一 pool 内任意记忆，无需正文或摘要包含 trigger。两种关系取并集，一条 Memory 可绑定多个 trigger，输入命中任一开启的关系即可召回。关键词 UI 显示 trigger、关联总数、开启自动召回的数量，并可进入关联列表添加其他记忆；记忆编辑页可批量添加并绑定触发词。

“是否自动召回”属于 trigger ID × Memory ID 关系，不是 MemoryEntry 的全局字段。新匹配关系默认开启；关闭一个 trigger 的关联不影响其他 trigger。

自动匹配关系无需物化，只保存用户显式关闭的 override；手动关系存入 `memory_passive_associations`。正文或摘要编辑后重新计算 lexical 关联，手动关系与稳定 ID 对应的关闭 override 保留；trigger 或 Memory 删除时由外键清理对应关系和 override。关闭手动关系保留关联，便于重新开启；批量添加并绑定是同一事务，复用已有同名 trigger 并开启对应关系，失败全部回滚。

## 8. Passive Recall

每轮普通单聊 Prompt 组装前：

1. 读取当前用户输入，只使用本轮输入触发，不拼前 N 条历史。
2. 用统一规则匹配用户配置的全部 trigger。
3. 查询各 trigger 的关联 Memory，排除该关系的关闭 override。
4. 按 Memory ID 去重。
5. rememberedAt 新到旧、ID 固定顺序排序。
6. 取用户配置的“被动自动召回最大条数”，完整注入正文与摘要。

没有结果则省略整个 block。Passive Recall 不调用 embedding／LLM、不分页、不裁剪正文。

局部指代由未总结原文解决，较早连续性由聊天摘要解决，深入长期搜索由 recall_memory 解决。

## 9. Active Recall 输入

工具输入：

- query：可选的自然语言搜索句子，可直接是用户原话或 AI 想查找的描述；
- keywords：可选字面关键词数组；
- offset：可选非负整数，默认 0。

query 与有效 keywords 至少提供一个。不传 keywords 时允许纯向量搜索；只传 keywords 时可独立执行 lexical。不会额外请求 LLM 从 query 提取关键词，也不会自动把整句 query 当作 lexical 关键词。

模型不能传 limit、confidence、similarityThreshold、searchSessionId 或 durable cursor。

用户设置“AI 主动召回每页条数”，默认 10。AI 只能翻页或换查询，不能扩大单页条数。

## 10. Lexical 与 vector 路径

Lexical 直接匹配 MemoryEntry.content 或 summary 的规范化投影，至少包含一个关键词即入选。重复出现同一关键词、同时命中摘要与正文都不增加覆盖数。无 embedding 时仍可独立运行。

记忆向量的输入为非空摘要＋换行＋完整正文；没有摘要则仅用正文。摘要提供主题，正文保留细节，不能只向量化摘要。

有非空 query 且配置了可用 embedding 时：

1. 对 query 生成向量；
2. 取得当前 pool 的全部有效 Memory vectors；
3. 计算同一次搜索中的相似度；
4. 参与 §11 的补充分组。

有效向量必须匹配本次解析的模型指纹、正文 revision 和维度，不能混用新旧模型或旧正文向量。

query embedding 失败、模型不可用或没有有效 vectors 时，有 keywords 就返回 lexical 结果，并说明语义路径不可用。纯向量请求没有可用向量路径时明确返回不可用原因，提示改传关键词；不能伪装成成功执行搜索后没有记忆。

调用取消继续传播 cancellation，不把取消吞成成功的 lexical fallback。

不设置可信度或 cosine 阈值。相似度仅作本次搜索内的相对排序，不向 AI 描述为相关概率；最终相关性由聊天 AI 阅读判断。

## 11. 两组召回排序

全量候选按 Memory ID 去重后，分成两个组：

| 分组 | 条件 | 组内固定排序 |
|---|---|---|
| 第一组：Lexical | 至少命中一个 keywords，无论是否有向量 | 不同关键词命中数降序 → rememberedAt 新到旧 → ID 固定顺序 |
| 第二组：Vector-only | 没有 lexical 命中，但有本次搜索的有效向量 | 相似度降序 → rememberedAt 新到旧 → ID 固定顺序 |

第一组全部在第二组之前。向量不改变第一组的顺序，不存在“已向量化即双命中优先”的第三层规则。

例：A 命中 3 词无向量，B 命中 1 词且语义接近，C 无字面命中但语义最接近，顺序为 A → B → C。纯向量请求只有第二组。

lexical SQL 和 vector 路径不得先用最终 page size 截断。先完成全量候选、去重、两组排序，再分页。本地个人数据规模先使用简单完整检索，不为假设规模引入 ANN／外部向量库。

## 12. 本次搜索队列与分页

首次搜索固定完整排序结果及用于返回的内容，保存在当前 Agent run 内。相同 pool、query 和规范化 keywords 的连续翻页读取同一队列，不逐页重新 embedding、查库排序或按最新正文重组结果。该队列属于 Memory，用可信 run ID 隔离，不由模型选择另一个 run。

首次创建队列时同时固定用户 page size。后续设置变化、后台向量完成、条目编辑等不改变已开始搜索的队列；新的搜索才读取最新状态。

offset = 0 开始新搜索；更换 query／keywords 开始新搜索。同一 run 的当前搜索后续用 nextOffset 翻页，返回 hasMore；有后页时 nextOffset = 当前 offset + 本次固定 page size。

没有匹配的当前搜索队列时，非零 offset 返回可修正错误，提示从 0 开始，不悄悄建立另一份结果。run 终止、取消或换搜索时释放旧队列，不写数据库、不跨 run 恢复、不建立持久搜索会话。

分页不裁剪正文，不用 token budget 静默减少条目。

## 13. 召回设置与 token

Memory 设置提供两个独立值：

- 被动自动召回最大条数：固定本轮自动注入条数上限，不翻页；
- AI 主动召回每页条数：默认 10，控制单次工具结果条数，可翻页。

两者不能合并成一个 Memory limit。当前默认值与 UI 档位见§27，不在工具内部另设隐含额度。

摘要、被动 Memory、主动 recall **不新增强制 token 裁剪或自动缩句**。保留现有 token 统计与超量提醒；用户通过正文维护和条数设置控制成本。

当前 Prompt Compiler 的预算只报告超量，不自动删内容，不能宣称已有裁剪保证。历史摘要按 §22 全部注入，不静默丢较早段，也不递归压缩。

## 14. Embedding 状态与有效性

复用现有全局 embedding capability，不新增每 AI provider binding。没有配置时记忆创建、编辑、lexical、passive、UI 都正常。

每条 Memory 的派生状态可表达：

- not_requested：没有请求条件；
- pending：等待生成；
- retry_wait：等待有界重试；
- ready：模型指纹／正文 revision／维度全部有效；
- stale：保留的向量已过期；
- failed：终态失败，用户可手动重试。

除 failed 外主列表静默，不显示成功徽标。状态是同一派生任务的表达，不为六个名字创建多套状态机。

正文编辑成功后自动重新向量化。旧向量可以保留，但已不匹配新 contentRevision，不能继续参与当前搜索；新向量成功后替换，失败不回滚正文。没有可用模型时等待后续配置启用，不把正文编辑当失败。

模型变化使旧向量 stale；既可 lexical，也可 passive；配置可用后由 Memory worker 重建。

## 15. Worker 与三次上限

Memory 自己拥有 worker／持久任务状态，可参考 Sticker 的装配模式，不依赖 Sticker Repository、业务状态或 worker。

worker 短事务领取任务，事务外请求模型，短事务提交。Repository 原子比较条目存在性、contentRevision、捕获的模型指纹与任务 claim；不匹配就丢弃晚到结果，不能写回旧正文向量或复活已删除条目。

同一正文 revision × 模型指纹的自动任务 **最多尝试 3 次，包含首次请求**。第三次失败后进入 failed，停止自动请求并向用户显示失败／“重新向量化”。明确认证、模型不存在、输入过长或响应契约错误可以更早进入 failed。

取消、reset、restore、worker shutdown 不计入失败次数。重启／回前台不能重置已经失败的次数；手动重试或新的正文／模型版本才开始新一轮尝试。backoff 数值属于实现参数，不改变三次总上限。

冷启动、前台、正文 commit 和模型配置变化提供真实唤醒入口；不永久 silent retry。后台任务可取消，reset／destructive restore 前 abort＋await quiesce，晚到请求还受 generation fence 约束。

## 16. Embedding 错误与 UI

平台 embedding 外部边界提供能可靠识别的稳定错误 DTO，涵盖认证、模型不可用、速率限制、网络、超时、服务错误、输入过长、非法响应、维度不匹配或 UNKNOWN。

不根据字符串猜造原因，不把 query 请求失败批量标成条目 failed。可恢复请求按三次上限重试；原因不明保留安全诊断。

终态失败时告知用户，在条目列表／详情显示“重新向量化”；详情可显示模型、失败时间、可读原因与诊断摘要，不堆 HTTP 原始错误或 provider 栈。无法可靠识别时显示“向量化请求失败，未能取得更详细原因”。

## 17. Forget 与空间授权

forget_memory 仅在用户明确要求时删除当前可信 pool 的 MemoryEntry。Repository DELETE 必须同时带 pool 条件，不能只按 targetId 删除。用户管理入口同样带所选空间授权范围。

delete_topic 和草稿忽略语义退出，不给 V3 新建草稿抑制流程。删除正文同时清理其派生向量／任务与关系 override；在途 worker 不能重新插回已删条目。

## 18. 聊天摘要的产品契约

Conversation Summary 归 Chat，是用户拥有的持久记录，不是随原始消息失效的缓存，也不是长期 MemoryEntry。

- 用户可以创建、编辑、删除和清空摘要。
- AI 可以读取已有摘要作背景，追加本批新聊天的摘要。
- AI 永远不改、覆盖、重排或删除已有摘要，不生成整个摘要的替换文本。
- 用户删掉的已处理摘要不因原始消息仍在就被自动重建。
- 删除消息、清空聊天历史不删除或失效已有摘要，不代表与 AI 重新开始。
- 消息可见范围／history clear generation 不得用作摘要删除 generation。
- 全应用 reset／destructive restore 仍遵循全应用生命周期，不等同于清消息。

不保存原文副本、不建立逐条 source evidence 表或溯源 UI。保留处理范围／游标只是防止重复追加、确定摘要与原文切换的内部状态。

普通聊天和通话共用 Chat 的时间线、计数、前台队列、模型与持久 claim。Calls 提供原始转写、系统事件及通话状态；用户转写和 AI 完整回复分别占一条，OCR、接通／挂断等应用事实不占 N。短通话挂断时不足 N，继续累计后续聊天，不独立调用摘要模型。通话进行中即使达到 N，也保留全部未总结原文，等待终态；冷启动故障恢复沿用 Calls 原有状态机收口。

领取范围先按统一时间线选取 N 条逻辑对话；跨入已结束的电话时，范围延伸到该通话结束，不留下半通电话等待下一次凑数。新原文每次最多发送 5000 个 Unicode 码点，优先在完整消息间分批；单条超限时才标明续段拆分。各分片依次生成最多 500 字的新段，已有摘要和此前分片的新增正文只作只读背景，不做摘要的摘要。5000 字不包含人设、系统指令、已有摘要等背景，不等同于整个请求的 token 上限。

同一领取范围的所有分片生成成功后，短事务一起追加各段、推进普通聊天游标并标记本批完整通话；任一分片失败或取消，整批原文继续保留。每个分片开始前以 claim／generation／租期 CAS 续租，原有单请求时限不延长。通话事实仅作为生成输入，摘要段保存独立正文和讨论时间，不保存通话关联或事实副本；会话级已处理通话 ID 仅用于防止重复总结，不绑定摘要段。升级退休旧关联表，既有摘要正文、顺序与处理进度保留，不自动重算。删除源通话、清消息不删除摘要，用户删段不重建；清空摘要使旧 claim 失效并建立新的通话时间边界，只处理边界后保留的文本。

## 19. N 与主客窗口

单聊与通话的摘要触发门槛 N 复用当前 AI 的“单聊·主”设置。N 表示累计多少条未处理的 context-eligible 逻辑消息后可以领取总结，不是通话中的强制截断点，也不意味着永远注入最后 N 条原文。用户和 AI 的消息分别计数，不是一来一回算一条；同一 `logicalMessageId` 的分段合计一条，无逻辑 ID 的独立消息各算一条。新发送的单聊整组图文共享逻辑 ID，历史未记录该身份的图文不推测合并。

主客的含义是来源相对于当前场景的地位，见 [主客窗口设计](./prompt/context-window-primary-secondary-design.md)：

- 单聊·主用于单聊来源的生成批次。
- 客窗口只控制该来源未来作为其他场景背景时的展示，不改变它的处理游标、N 或摘要内容，不按客窗口重切旧批次。
- 当前群聊主客／跨场景客注入尚未完整接通；V3 不顺带实现这些入口或把私聊摘要开放给其他参与者。

N 修改只影响下一批，已领取批次固定其 N／范围。不能把同一会话切场景当成重新总结的理由。

## 20. 摘要生成与原文交接

按统一时间线，从 durable 处理进度之后领取完整的 N 条 eligible 逻辑消息，保留原始分段，并按 §18 在通话结束处闭合范围：

1. 短事务固定批次、范围、N、claim／revision。
2. 事务外以领取时的已有摘要作只读背景，按最多 5000 字新原文依次生成新增摘要；每个分片请求前续租。
3. 模型输出边界验证新增结果；不允许修改旧记录。
4. 全部分片成功后，短事务原子追加摘要，并推进聊天游标与通话处理标记；同一范围最多一个 winner。
5. Prompt 查询同一事实快照的摘要与尚未总结原文。

例如 N = 20：

- 只有 1～19：注入原文 1～19；
- 收齐 1～20：启动总结，原文仍保留；
- 此时又产生 21～25：总结未完成时保留原文 1～25；
- 成功后：摘要 1（覆盖 1～20）＋原文 21～25；
- 后续总结 21～40，成功后：摘要 1＋摘要 2＋原文 41 之后的尾部。

不能先移除原文再等摘要，也不能继续取最后 N 条后因为 overlap 扔掉整段摘要。失败不推进游标、不阻止聊天；保留尚未总结的原文，后续重试。这段原文可暂时超过 N，不强制裁剪。

一个批次追加摘要和处理进度必须原子提交；并发、重启、用户清空摘要、reset／restore 都不能让旧 claim 重复追加或覆盖用户内容。现有摘要正文修改不会被 AI 写回的旧快照覆盖。

自动新增正文注入所属 AI 的真实人设，以自己的口吻简洁回顾与用户的共同经历，允许第一人称感受与符合人设和真实关系的温度。按主题保留重要事实与变化、约定、结论、未完成事项及有意义的关系／情绪变化，省略重复表达与动作流水账，不补写未发生的事实或把自己的感受当成用户的情绪。事情讲清楚就停，不设目标字数或最低字数；500 个 Unicode 码点仅为硬上限，中英文、标点、空格与换行均计入。模型输出边界去首尾空白后校验，超限不提交、不推进游标、不截断正文；原文继续保留。已有摘要与用户手动维护不受自动生成上限限制。

## 21. Canonical 口径与最小持久状态

摘要与 raw 使用 Chat 提供的同一 context projection／计数口径，排除 reasoning、transient、未完成或撤销输出。分段与 logical message 的计数不能在两侧各自猜测。

Chat 的 `senderType=system` 不等于模型 API 的高权限 `role=system`。已持久化的回复错误和工具终态作为应用事件资料，
以带明确来源标记的 `user` 上下文保留在 canonical 顺序中。工具事件只表达保存过的名称与批次状态，不重建 Agent history，
不推断未提供的具体结果；同一 run 内的真实 tool call／result 仍由 Runtime 拥有。
N 只计逻辑对话消息，事件不占额度；达到 N 后，同一逻辑消息的后续分段和范围内事件一起进入本批，直到下一条逻辑对话之前。
摘要模型把这类来源识别为 `speaker=application`，摘要段的 messageCount 记录本批逻辑对话数量，游标覆盖本批完整范围。旧摘要的计数元数据保留生成时的口径，不重算已处理范围。

游标不能只比较 SQLite 数字 ID，也不能每次 row_number 重新编号；遵循 Chat canonical run 锚点／turnItemIndex／稳定历史顺序。Current Input 的 canonical 来源要一起保护，不能在 raw 与独立输入位置重复注入。

最小 durable 状态：

- conversation、摘要处理 generation、已处理 canonical cursor、revision、必要 claim；
- 追加摘要的稳定 ID、顺序、正文、创建／用户编辑时间；
- 批次闭合范围、消息数、当批 N、系统时间范围／时区等必要元数据。

不要求 chat_summary_segment_sources，不为摘要复制聊天事实。用于处理进度的范围不作为消息 FK 删除摘要的依据。

用户编辑／删除已处理摘要不倒退游标。清空摘要在当前聊天边界建立新处理起点，并使在途旧 claim 失效，后续只追加新消息，不自动补回清空前的摘要。

用户删除／清空消息不回退摘要进度，不触发已有摘要重算；旧摘要继续注入。模型已经收到的本批输入只是一次任务快照，不持久化成原文档案。

## 22. 日期与稳定 Prompt 前缀

总结输入的每条消息带系统提供的真实 timestamp、speaker、canonical 顺序与正文，给出明确日期／时区锚点；已有摘要仅作只读背景，本批输入是追加依据。

区分：

- 讨论时间：由系统消息时间范围提供；
- 事件时间：来自对话明确提到的事实／计划，不能用发消息日期替换。

“10 月 4 日讨论 10 月 10 日考试”保留考试日期；“昨天去医院”必须依据那条消息的日期锚点解释，不能相对未来阅读时的今天。不确定就保留不确定性，不编造绝对日期。跨日来源不压成同一天。日期表示稳定，不随下一轮当前时间或设备时区变化重写旧摘要。

普通单聊、通话实时回复及去电决策共享同一摘要与未总结原文查询，注入顺序：

1. 稳定系统指令、人设、用户身份等已有稳定块；
2. 全部已有聊天摘要，按稳定追加顺序；
3. 被动 Memory（有命中时）；
4. 尚未成功总结的普通消息与完整通话资料，按统一时间线；
5. 本轮动态上下文、通话状态与输出要求；
6. Current Input（排除历史中的同一条用户消息／通话转写）。

通话规则放在历史之后，不改写共同的人设和摘要前缀。通话只读参与被动记忆召回，匹配当前真实用户转写，不开放 Calls 的长期记忆写工具，也不新增 embedding 沉淀流程。通话接通后的起始事实内容保持稳定，挂断仅追加结束事实，不把起始条目改成带终态的新文本。

无摘要／被动 Memory 时省略对应块。主动 recall 属于本轮 tool result，追加到 Agent run history。

已有摘要的文字、顺序和格式保持稳定；AI 只在末尾追加，不能每轮重新措辞、重编号或加入动态当前日期标题。用户编辑旧内容时才相应改变前缀。这样延长可复用的稳定前缀，不承诺模型服务每次必命中缓存。

## 23. UI

Memory 保留小程序入口／AI 空间选择，提供扁平列表、详情、手动新建、编辑、删除、500 字计数、trigger 管理／关系开关、两个召回条数设置和 terminal embedding 失败重试。

删除主题目录、topic overview editor、草稿状态、管理员手动整理、自动阈值、memory_admin binding、candidate／active／cooling 展示。

Chat 提供用户维护摘要的入口，明确摘要不会随清消息删除；AI 的自动能力只追加，用户可管理已有内容。摘要不套用 MemoryEntry 的 500 字上限。

## 24. 定向数据库升级与旧链退出

用户已确认没有需保全的旧 Memory 数据。施工时可定向清除／覆盖旧 Memory 数据与旧结构，不迁移 entries、overview、drafts、sources、tags、旧 vectors，不建立 archive。

保留仍有意义的 pair pool／AI 身份和其他 Feature 数据。禁止把此授权扩大成 clearDB、全应用 reset、删除聊天、模型资产、Sticker／媒体／Calls 数据。

使用独立 V3 canonical 物理表名。历史 migrations 会重放建表／topic_id SQL，不能原地把旧 memory_entries 改成 flat 表。在 bootstrap 尾部收口旧 Memory 结构与退休配置，配合明确版本标记；既不重新导入旧记忆，也不在每次启动清空新数据。不得改写已发布历史 SQL 或新增双运行模式绕过。

memory_admin 配置只清退休 capability 的绑定／入口，不能删除通用模型资产或其他能力的 binding。旧 Prompt 引用只清退休 Memory definition／scenario，不删除其他用户自定义提示词。

升级失败必须暴露并停止新运行时，不能捕获错误后假称完成。验证新装、旧结构升级、第二次 bootstrap、新数据保留、FK 完整与故障回滚。更老结构／备份也按定向清旧政策处理，不承诺旧记忆无损恢复。

## 25. Backup、reset 与恢复门

V3 正文、派生向量／任务、trigger、override 和 Chat 摘要／处理状态进入现有完整 DB backup，不为此添加原文档案。

旧备份的 Memory 数据走 §24 清旧升级，新备份的 V3 记忆和摘要应真实恢复；不能每次 restore 都清掉 V3。恢复后向量依模型指纹、contentRevision、维度判断 ready／stale，lexical 立即可用。

Memory embedding 与 Chat summary worker 都在 reset／destructive restore 前 quiesce，旧请求受 generation／claim fence 约束；恢复门和 bootstrap 完成后再启动。原生备份契约保持既有严格验证，不为 V3 随意放宽或随意 bump 版本。



## 26. 验收不变量

- 用户和 AI 新建／编辑 Memory 正文统一上限 500 字，不自动截断、不自动溯源。
- 不配置 embedding，用户 CRUD／remember／lexical／passive／forget 都可独立工作。
- 同一 tool-call 重投不重复写入，已成功记忆不因后续聊天失败撤销。
- trigger 由用户配置，按当前输入触发，关系开关不跨 trigger 生效。
- 主动 keywords 可省略；纯向量不可用不能伪称无结果。
- lexical 组优先且按覆盖数排序；有效向量只补充 vector-only，不优待已向量化的弱 lexical。
- 全量候选排序后分页，同一次搜索的后页复用固定队列；AI 没有 limit。
- 不强制 token 裁剪，不静默删历史摘要；条数设置与单条上限仍生效。
- 正文编辑自动重建，旧向量失效；晚到请求不能覆盖新 revision 或复活已删条目。
- 自动最多 3 次，取消不算失败，终态告知用户，成功默认静默。
- 摘要属于 Chat，用户可维护；AI 只追加，不修改／删除已有记录。
- 清消息、删消息不影响已有摘要；用户删除摘要不会自动补回。
- 摘要提交与处理进度原子交接，没有摘要等待造成的原文空洞。
- 摘要与 raw 使用同一 canonical 顺序／口径，Current Input 不重复。
- 讨论日期与事件日期区分，旧摘要日期／格式保持稳定。
- 定向清旧不触碰其他 Feature，新数据经第二次启动／V3 backup restore 保留。
- reset／restore 后没有旧 worker 回写；旧树／管理员／草稿／F7 不再参与生产。

验证保护真实行为、并发和边界，不锁定源码字符串、文档标题、用例数量或 helper 形状。只运行相关检查，未经要求不构建完整 APK。

## 27. 当前参数

| 参数 | 当前实现 |
|---|---|
| 被动自动带入 | 默认 5，档位 0／3／5／10／20 |
| 主动每页条数 | 默认 10，档位 5／10／20／50；队列首次创建时固定 |
| Memory retry | 首次失败后 30 秒，第二次失败后 120 秒；第三次或可靠永久错误终止 |
| Memory 模型请求／claim | 60 秒请求时限，120 秒 claim lease；取消不计失败 |
| 摘要模型 | 复用该 AI 的聊天模型、温度／topP／maxTokens；单聊·主为 N |
| 摘要请求／claim | 120 秒请求时限，180 秒 claim lease；失败保留原文，前台 120 秒后重试 |
| 向量序列化 | 有限非零数值数组 JSON；指纹＋正文 revision＋维度有效 |
| Chat canonical 锚点 | Chat 保存最小 run 排序锚点，删除首项不会移动摘要处理游标；无正文副本 |
| SQLite／helper 归属 | Memory／Chat 各自 Repository port 与 adapter；schema／尾部升级在 platform/persistence |
| Prompt 接入 | 普通单聊固定摘要／被动位置由 Host 补入旧预设，摘要追加保留稳定字节前缀 |

500 字上限、三次自动尝试、两组排序、无强制 token 裁剪、无自动来源、摘要只追加／清消息保留、run 内搜索队列和清旧政策均为已定产品契约。

按修改范围选择 npm run verify:memory、verify:prompt、verify:agent-runtime，以及相关 Chat／Calls／备份／reset 检查；各命令属于独立验证入口，不代表整套设备验收已完成。
