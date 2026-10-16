# 普通聊天宿主的有界 Android 生命周期

本实现保留原 `ConversationTurnHeadlessTaskService → ConversationTurnExecutionTask → ConversationTurnCoordinator` 所有权，不新增第二个执行宿主，也不依赖 Overlay FGS。

## 平台类型与启动

普通 Agent Loop 包含模型往返和工具操作，本项目将整个用户请求的执行期映射到 `specialUse`，并在 Manifest 声明具体用途。这是工程用例判断，不代表已取得应用商店审核结果。[Android 类型说明](https://developer.android.com/develop/background-work/services/fgs/service-types)中的 `remoteMessaging` 面向跨设备消息接力，`shortService` 约三分钟；`dataSync` 适合数据传输，但不能概括完整 Agent 工具执行。`specialUse` 仍受前台服务启动资格限制，不会获得后台任意启动权限。

用户可见页面发送及合法交互触发可以请求启动；恢复仍只委派既有宿主。系统拒绝或原生启动回执五秒超时返回 false，不启动页面执行，不自动重试。Service 必须先成功进入前台，才确认启动并交给 RN。过期启动回执的迟到 Intent 不执行。参见 [Android 后台启动限制](https://developer.android.com/develop/background-work/services/fgs/restrictions-bg-start)。

Android 13 由 ServiceCompat 按平台支持的类型启动；Android 14+ 使用声明的 specialUse 类型与权限。执行通知与 assistant 回复通知分属不同事实，前者只表示原生任务存活，后者仍由 AIMessageDeliveryCoordinator 决定。关闭回复通知权限不等于撤销执行所有权。

## 截止与收口

一次原生请求的软截止为九分钟，覆盖启动门与该任务的串行会话执行；原有 RN 十分钟 task timeout 保留为最终原生收口边界。软截止通过原生挂起回执取消 JS，不能将 RN timeout 本身当作模型取消。两端使用单调时钟，T3 在原事务中检查宿主授予的截止点；过期时整体回滚，包括游标 CAS 与媒体物化。

Coordinator 在宿主取消后先汇集指定 run 已收到的展示回执，再完成 T4。即使底层网络或工具暂不响应 abort，也不无限等待旧 Promise 才撤销 owner。迟到执行有完成／异常消费者，仍受原 fence、signal 和截止点约束。T3 已提交时，T4 不回退 committed 或游标，只封闭未交付展示尾部。

Service 持有独立、有时限的 CPU WakeLock，避免只依赖 RN 跨 Service 共享且不计数的静态锁。正常任务仍由 RN task completion 结束 Service；并发任务结束一个不停止其余任务。原生硬边界负责停止没有及时结束的宿主。`START_NOT_STICKY` 禁止 Android 重投旧 Intent；持久恢复只归 ConversationTurn Repository。

任何前台服务都不能保证不被用户停止、厂商冻结或低内存杀死。重启后依据持久展示资格恢复；已开始工具的孤儿失败收口，不自动重放工具。已经发出的工具副作用不能通过 abort 回滚，结果未确认时不得声称工具成功。

## 验证边界

原生单元测试覆盖启动拒绝、启动超时、迟到启动、并发完成隔离、截止终态不可改为成功，以及完成早于桥接观察的次序。JS 测试覆盖宿主取消传播、底层不响应 abort 时先 T4、T3 过期零提交与 prepared backing 清理、T3 后超时仅关闭展示。

真机仍必须按 Protected Contract 连续三次执行 Home 后后台完成场景，并分别测试 Overlay OFF/ON、屏幕关闭、网络断开、VPN、进程死亡、通知权限关闭和 Android 启动拒绝。没有这些设备证据，不宣称后台冻结已经解决。模块原生改动需要更新安装包，Metro 重载不包含这些改动；本任务未构建完整 APK。
