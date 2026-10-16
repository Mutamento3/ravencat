# 普通聊天 Android 执行宿主

页面提交用户消息后启动 `ConversationTurnExecutionTask`，宿主等待协调器完成回合。提交资格与崩溃恢复属于持久化回合状态，服务不建立第二份业务队列。

Service 仅在本次任务期间进入 specialUse 前台执行并持有独立有界 CPU 锁，终态后停止。原生确认前台启动后才返回 true；拒绝与五秒启动回执超时返回 false。九分钟软截止取消 JS 并由 Coordinator 完成 T4，T3 同时检查单调时钟截止；十分钟原生边界保留。Android 不重投旧 Intent，恢复仍由原 Repository 负责。详细限制见 `docs/architecture/chat-background-execution-lifetime.md`。

用户任命或撤销主理 AI 后，同一服务通过独立的 `HostRelationshipReplyTask` 承担一次即时回复。该任务等待现有 Chat 主动回复命令结束，不进入 canonical 用户消息回合，不依赖设置页存活。Intent 只携带 AI ID、变更类型和发生时间；Host 在执行时读取当前配置和权限，将操作通知作为模型本轮 user 输入，不创建用户聊天气泡或系统提示条。这是即时的提交后沟通，不另建持久队列、启动恢复或自动重试；原生唤醒失败不回滚已提交的主理关系。

React Native 0.81.5 的新架构 `CoreReactPackage` 未注册 `HeadlessJsTaskSupport`。真机检查确认模块为 null：JS Promise 完成后无法通知原生结束任务，服务、唤醒锁和 `START_REDELIVER_INTENT` 启动记录持续滞留，进程重启时重投已经结束的请求。

`HeadlessJsTaskSupportPackage` 通过 `plugins/withHeadlessJsTaskSupport.js` 注册 React Native 自带模块，不复制任务完成、超时或重试实现。使用 Java 引用框架的 Kotlin internal 实现，避免另建收尾桥接。此注册需要进入原生安装包，Metro 重载不能更新原生模块。升级依赖后，若新架构已经注册该模块，删除此 Package 和 config plugin，避免重复注册。

验证应覆盖多个并发宿主任务：完成一个不能提前停止仍在执行的任务，全部结束后 Service 和启动记录应消失；随后进程重启不重投旧请求。后台回复仍须完成架构文档规定的三次真机验收。
