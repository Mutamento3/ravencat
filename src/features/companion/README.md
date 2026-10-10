# 主动伴随

AI 日程是唯一的定时自主唤醒能力，Self Wake 已退役。当前业务不变量见 [主动伴随架构](../../../docs/ravencat/proactive-companion.md)。

- `AIScheduleApplication` 校验模型输入、时间和来源。
- `SQLiteAIScheduleRepository` 在事务中维护状态机、开关及 claim。
- `AIScheduleProjectionOwner` 提交启停意图后同步 keyed Android 投影。
- `RunHeadlessAISchedule` 取得当前主理身份与执行权后，进入 `RunHostAutonomousAgent`，复用普通单聊 Prompt、Chat 执行、工具及存档。
- `ProactiveLifeReadQueries` 组合日程与 Chat 响应证据，提供页面和聊天定位。

关闭主动伴随暂停并保留计划；重新开启只恢复未来安排，错过的不补跑。已取得执行权的 run 由当前有界执行宿主收口。中断保留已经存档的模型输出与步骤，不重放行动。

跨 Feature 依赖公共根出口，具体装配使用 `composition.ts`。原生运行时与 Overlay FGS 独立；开关不能建立常驻服务。
