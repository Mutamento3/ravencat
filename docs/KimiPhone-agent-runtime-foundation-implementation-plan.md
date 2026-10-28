# Agent Runtime 当前架构契约

Agent Runtime 是 `model → tool → observation → model` 的统一执行内核。当前代码入口为 `src/platform/agentRuntime/`，具体工具和授权由 `src/host/composition/agent/` 装配。它不拥有产品事实提交、Android 执行生命周期或持久恢复。

## 1. 执行链与所有权

```text
Feature / Host 创建 task、runId 与初始 history
→ Host 冻结本次工具授权并装配 Registry
→ AgentRuntime → AgentRunLoop
→ 模型输出 → AgentToolExecutor → observation
→ 继续模型回合或最终输出
→ 产品 owner 决定持久提交与交付
```

普通 Chat 在用户 T1 commit 后委派 Android execution host；任务侧 claim 后调用现有回复链与 Runtime，最终回复由 Chat 的 T3 fence 提交。回合事实、supersede、crash orphan 和 startup recovery 属于 ConversationTurn；一次执行内部的 history、预算、工具循环和事件属于 Agent Runtime。详见[回合协调](architecture/conversation-turn-coordination-invariant.md)与[后台执行](architecture/chat-background-execution-invariant.md)。

runId 由发起任务的产品 owner 创建并传入，Runtime 不生成或替换。Runtime 只阻止同一进程内相同 runId 重复并发执行，不代替 SQLite 的业务 claim。

## 2. 单一模型与工具循环

- complete 与 stream 共享同一 loop；流式只改变事件传输形式。
- complete 网关透传 Runtime 禁止 reasoning 截断自动重试的请求契约；模型只返回思考并耗尽输出额度时，保留本次截断结果，不在客户端重新生成并隐藏第一次请求。
- 已返回的思考本身也是可保存内容，不要求模型额外返回正文。输出额度耗尽时，普通 Chat 经原有 T3 保存已收到的思考和部分正文，不替换成协议错误；该次截断不触发完成后的补充决策或续请求。
- 工具结果始终记录为 observation；需要续轮时进入下一次模型请求，续轮不重新编译业务 Prompt。
- 模型决定 observation 是否足够，Runtime 不根据内容相似度或同名同参调用推断任务完成。
- 语音与表情包发送工具要求模型通过 `on_success: finish | continue` 声明成功后意图，成功结果通过 `metadata.completionIntent` 转交 Runtime。整批成功且最后一个工具选择 `finish` 时，直接进入既有正常完成入口（含 `beforeComplete`），不追加模型回合；批次任一失败、参数非法或最后工具未选择结束时，继续回灌 observation。结束意图不截断同批后续工具，不代替业务 owner 的 canonical commit，也不丢弃模型已经输出的正文。
- 工具结果、未知结果和最终输出保持原来的业务含义；Runtime 不替 Feature 写消息、更新 preview 或发通知。

Calls 的 `ProcessCallAIReply.ts` 通过 Host 复用同一 AgentRunLoop、授权工具包与 MCP 装配。Calls 只投影各模型回合的正文到逐句 TTS，并持有通话取消与 aiSpeechText 提交；工具 observation 和思考不朗读。通话不暴露再次来电、普通消息发送及依赖 Chat 媒体 intent 的工具。

统一 Runtime 现已支持工具结果的 `modelImages` 附图：与文本 observation 一同记录在
tool history 中，模型网关先提交完整 tool_calls 结果批次，再追加图片观察输入。
complete / stream 使用同一组装路径；附图只属于本次模型观察，不产生用户 Chat 消息。
`view_image` 与 Calls 的 `lookAtUser` 使用此契约。`lookAtUser` 消费本次捕获结果，经原有视觉路由形成文本/附图后释放文件，OCR 事实保留，不再拥有独立续答循环。

## 3. 工具契约与权限

群成员回复使用同一 Registry、Executor、RunLoop 与 ChatAgent timeline。群任务将自身 ID 作为 run ID，群 owner 在每条正文／媒体物化事务内检查任务与 plan 的持久资格，取消后保留已提交事实、丢弃未提交意图。工具错误消息也使用装饰后的群提交 Repository，不能绕过 fence。模型调用与语音／图片准备均在事务外；Runtime 不拥有群进度或消息提交。

群场景逐项启用已授权语音、表情、图片及既有业务工具，保留主理与 owner 限制；`request_video_call` 明确禁止。Together Listening 主理工具沿用既有运行快照、Activity、授权与目标会话投影，无群专属隐私授权或后台唤醒机制。

Built-in 与 MCP 最终都通过同一 Registry、Executor 和 RunLoop。工具定义提供 name、description、inputSchema 与 execute，Runtime 不理解其后是 SQLite、Android、Memory、Moments 或远端网络。

Host 冻结工具暴露面，Runtime 校验当前 allowlist 与 schema，Feature execute 裁决真正的业务前置条件。未知、未授权和非法参数都不执行。

事务中的业务拒绝由拥有事务的 Repository 或 Host 组合出口恢复类型，再由工具转换成具体 `modelContent`；未知异常保留完整诊断，模型只收到通用失败提示。Runtime 不根据 Feature 错误类型判断业务结果。`code`、`retryable` 用于结构化结果和诊断，不写入模型的 tool history，也不驱动自动重试。

| 结果 | 后续语义 |
| --- | --- |
| 未知或未授权工具 | 回灌明确错误并关闭工具，进入最终回答 |
| JSON/schema 参数非法 | 回灌可修正错误，保留工具能力供模型修正 |
| 普通业务失败 | 作为 observation，让模型解释、改参数或结束 |
| 取消或真实运行错误 | 按 Runtime 终态收口，禁止开始下一轮 |

不根据 risk 元数据自动弹通用确认框；来电、记忆遗忘等真实交互由对应 Feature 的产品契约负责。没有 generic confirmation/foreground suspend-resume，也没有第二份 permissionSnapshot。

## 4. 预算、工具时限与重复调用

Chat 固定为 **30 个工具回合、每回合最多 3 次、总计 30 次**，支持模型每次观察一个工具结果后再决定下一步；增加往返轮数不增加工具调用总额度。其他调用方仍显式提供自己的预算，Runtime 回合硬上限为三十。同一 step 的工具按模型返回顺序串行执行。单批超过 3 次时整批不执行，返回 `TOOL_BATCH_LIMIT_EXCEEDED` 供模型修正，避免部分副作用。

工具回合或总额度耗尽后，尚未通过发送工具意图完成的 run 追加无工具模型回合，由模型根据已有 observation 给出最终正文；预算耗尽不是运行错误。

正常模型请求不逐步播报剩余额度或催促最终输出，预算仍由 Runtime 的同一份计数与硬限制裁决。仅在工具阶段实际结束时追加收口指令；拆包后的能力由当前 schema 与 observation 表达，不重写首轮系统上下文中的展开状态。

同一模型回合提出的整批工具共享 **10 分钟 wall-clock deadline**，不按工具数量叠加。模型请求与最终回答不计入这个工具时限，Runtime 不设置整个 Agent run 的任务过期时间。工具超过批次时限后回灌 `TOOL_EXECUTION_TIMEOUT`，表示结果未知，不自动重试。

Runtime 不用参数指纹阻止重复调用，不猜测工具幂等性。one-per-run、持久幂等键和副作用去重由真实 Feature owner 保证。

## 5. 取消、终态与事件

模型请求与工具执行都接收 AbortSignal。取消阻止后续执行，不撤销已经由 Feature 成功提交的事实；晚到结果是否可提交由产品 revision/claim/fence 裁决。

Host 在工具提交事务中确认持久运行资格已失效时，使用 `AgentRuntimeTerminalError('SUPERSEDED')` 表达明确终态。Executor 保留这个控制信号，包括被一层事务异常作为 `cause` 包装的情况，停止同批后续工具及下一轮模型请求；不根据普通 `AbortError` 的名称推断运行终态。已取消的 signal 仍按原有取消原因收口。

Runtime 状态只存在于当前宿主进程；事件供调用方观察模型增量、工具开始/结果和终态，不构成第二套产品状态数据库。诊断按 runId 关联，禁止记录凭据、完整 Prompt 或私人正文。

不引入 durable Agent checkpoint、tool receipt ledger、unknown-outcome reconciliation、通用审批框架或第二套后台恢复。需要持久收据的业务由 Feature 持有。

## 6. MCP 工具来源

MCP 是工具 adapter，不是另一套 Agent 主线。Host 从当前 Server、工具 grant、快照和 Chat policy 冻结受控定义；非空时只注册 `mcp_list_tools` 与 `mcp_call_tool` 两个 meta-tool。

list 从本轮快照返回服务、工具与 schema，不联网；call 命中冻结定义并在触网前复用 shared schema validator 校验远端 arguments。具体远端工具不是独立 Registry entry。初始 Prompt 只含服务摘要，不发送整套远端 schema。

协议、连接测试与取消由[当前 MCP 契约](architecture/mcp-chat-injection.md)持有；长期记忆工具由[Memory V3](memory-simplification-v3-implementation-spec.md)持有，不恢复 F7 独立检索 Agent。

## 7. 验证

按修改范围使用 `verify:agent-runtime`、`verify:agent-runtime:contracts`、`verify:mcp:chat` 与对应 Feature 行为验证，保护授权、schema、预算、observation、取消和提交边界。Android execution host 与真实外部工具需所属 Feature 的设备/服务验收，Runtime 单元测试不能替代它们。
