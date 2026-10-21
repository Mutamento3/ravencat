# 主动伴随

AI 日程是唯一的定时自主唤醒能力，Self Wake 已退役。当前业务不变量见 [主动伴随架构](../../../docs/ravencat/proactive-companion.md)。

- `AIScheduleApplication` 校验模型输入、时间和来源。
- `SQLiteAIScheduleRepository` 在事务中维护状态机、开关及 claim。
- `AIScheduleProjectionOwner` 提交启停意图后同步 keyed Android 投影。
- 日程工具默认同时写入系统日历；缺权限在提交前报错，用户可显式选择仅内部提醒。设置入口位于「权限与后台运行」，日历副作用与 AI 唤醒共用投影 owner 的恢复入口，系统提醒不依赖应用进程存活。
- `RunHeadlessAISchedule` 取得当前主理身份与执行权后，进入 `RunHostAutonomousAgent`，复用普通单聊 Prompt、Chat 执行、工具及存档。
- 正常终态的最终正文由 Chat 直接提交为消息；最终正文完整等于 `[[NO_MESSAGE]]` 时安静结束。思考、工具前言与失败／中断原文保留为行动记录，不额外发送。
- `ProactiveLifeReadQueries` 组合日程与 Chat 响应证据，提供页面和聊天定位。

关闭主动伴随暂停并保留计划；重新开启只恢复未来安排，错过的不补跑。已取得执行权的 run 由当前有界执行宿主收口。中断保留已经存档的模型输出与步骤，不重放行动。

跨 Feature 依赖公共根出口，具体装配使用 `composition.ts`。原生运行时与 Overlay FGS 独立；开关不能建立常驻服务。
