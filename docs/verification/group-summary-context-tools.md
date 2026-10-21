# 群摘要、主客上下文与群工具本地验证记录

本次范围已贯通设置、持久化、模型执行和消费路径；不包含页面编辑工具、用户状态盒子、新后台唤醒或昵称功能建设。昵称集成只消费现有公共投影，模型读取公开参与者名称及自己的备注。

## 模型与摘要

通用模型管理、从合法草稿复制及创建快速填入已复核；副本与来源独立。两级摘要共用持续引用，默认单聊当前模型／群管理员。引用失效不替换；切换选择、模型参数变化、停用或删除撤销旧任务资格，正文和处理进度保留。真实 SQLite 测试覆盖资格失效失败时资产编辑回滚，真实 Host 调用测试覆盖实际模型参数、默认额度、诊断及专用提示词。

群摘要沿用原 claim、两级交接、编辑、失败和查询流程，使用独立群触发条数。新建库、旧版升级、重启和完整快照恢复覆盖版本 126 的模型选择、群设置、正文与处理进度。

## 工具实际消费路径

| 工具 | 群中消费与边界 |
| --- | --- |
| send_voice_message | Speech 准备语音 → ChatAgent timeline → 群任务事务物化 MediaAsset 与当前群消息；未提交意图随取消丢弃 |
| search_stickers / list_sticker_groups / list_stickers_in_group / select_sticker | Sticker 原检索与用户／自身收藏边界；选择发送通过相同 timeline 交付当前群 |
| download_image / view_image | Media 原私有下载、素材引用和角色视觉路线；图片观察进入共同模型续轮，下载提交检查群任务资格 |
| set_ai_avatar | Assistants 头像 owner、CAS 与群任务持久资格；普通 AI 修改自己，当前主理 AI 可指定其他 AI |
| add_own_sticker / maintain_own_sticker | Sticker 原收藏、显式处理与向量 claim；群终止后拒绝副作用提交 |
| remember_memory / recall_memory / update_memory / forget_memory | 当前 AI 的 Memory 空间，原授权、稳定用户输入参与条件与工具限制 |
| search_chat_summaries | Chat 只读查询，默认当前会话，只允许自己的单聊与仍参加群，不能跨身份查摘要 |
| 协议、朋友圈、账本、联网工具 | 原 ToolContext 与 Feature command/query，沿用 AI 授权及工具自身业务范围 |
| 手机观察／控制、网易云子工具、AI 日程 | 原主理身份、持久授权、工具包及原生限制；群不获得额外权限 |
| Together Listening 三工具 | 原单轮运行快照与 Activity；主理邀请卡首投影检查群任务资格，群卡操作沿用网关，后续消息和预览提交到原目标群 |
| MCP 工具 | 相同 Registry／Executor／RunLoop、持久授权和取消信号，不另建群执行链 |
| request_video_call | 群场景明确禁止，其他通话限制保留 |
| 普通文字回复 | 群普通回复与自主唤醒最终正文均由 ChatAgent timeline 提交 |

终止在事务内撤销 plan／task，commit 后发出取消；共享 Runtime 停止后续工具执行。消息、媒体及图片副作用的持久 fence 在 JS 取消未抵达时仍拒绝旧任务写入，已提交消息保留。

## 已通过的本地检查

- TypeScript 与本次源码 ESLint；分层、别名、SQLite、循环依赖、样式及架构快照检查。
- 通用配置复制、辅助模型真实持久化、配置变更与摘要资格原子回滚。
- `verify:memory`：群两级交接、主客窗口、0、每群额度、来源摘要开关、退出群、当前输入、后续输入上界、只读进度及备份恢复。
- 数据库基线：新建库、保留历史版本升级、版本原子性、恢复与外键完整性。
- 群队列与 supersede：动态发言、逐条提交、媒体物化回滚、终止后无新消息、mention 调度同事务。
- Agent Runtime Chat／contracts、回复策略、群 Prompt 隐私、图片工具、Sticker、状态卡与外部消息提交、Together Listening 回归。
- 对话设置草稿：主值正整数、客值 0 与大于主值、独立自动保存与批量复制回滚。

脚本中冒充旧版本的当前 schema 已补为真实旧列集合；过期的 Headless 初始化 helper 源码形状断言已移除，未给生产代码添加兼容或测试专用路径。

## 尚未验收

真实模型服务的摘要质量、额度及缓存命中，实际视觉／TTS／MCP／联网返回，Android 群页面导航、键盘与媒体播放、原生权限操作、前后台终止体验，以及设备上的备份恢复。以上不能以本地模拟验证代替，不构建完整 APK。

本次提交包含功能实现、验证与文档，并按用户授权加入必需的 AppTextInput、KeyboardAvoidingContainer 及公共出口。其他窗口的页面输入／键盘迁移保留在工作树，不混入提交。提交候选在独立 Git 克隆中验证，不切换当前仓库状态；未推送、同步公开仓库或发布。
