# SQLite 持久化平台

本目录拥有数据库连接、初始化、schema、migration、全局调度和通用维护工具。

## 公共入口

```ts
import {
  databaseCoordinator,
  initDatabase,
  type DatabaseTransactionExecutor,
} from '@platform/persistence';
```

业务 Repository 的 port 与 SQLite adapter 均归所属 Feature；本目录不得重新导出业务 Repository。Feature 只能使用 `databaseCoordinator` 创建的 executor，原始连接仅属于 `sqlite/` 与 `runtime/`。

全局规则：写入单写者、读取最大并发 2、`bootstrap > surface > interactive > runtime > maintenance`，事务只允许使用回调传入的 executor。

Android 原生连接的关闭属于 Expo SQLite 模块生命周期。当前 16.0.10 的销毁逻辑清空缓存后返回同一个空列表，导致 React Native 重载时未关闭旧连接，旧事务可能持续持有写锁。`scripts/patch-expo-sqlite-teardown.cjs` 在 postinstall 中将待关闭列表改为独立快照，并让源码构建使用宿主的 NDK 版本；`package.json` 的 Android autolinking 指定 `expo-sqlite` 从源码编译，避免预编译 AAR 绕过补丁。上游修复进入依赖后删除补丁与这项源码编译配置。该修复需要进入原生开发壳，Metro 重载无法更新已安装的原生代码；当前进程残留的锁需通过完整进程重启释放，不能靠业务 retry 或增加 busy_timeout 掩盖。

数据库当前 schema 版本为 144，包含可回放通话记录、按 AI 选择的截图保存、两级摘要、固定上下文起点、角色私有表情与图片、按 AI 保存的单聊 Token 与行动步骤显示配置、独立消息收藏和用户 AI 昵称。新安装直接创建当前表、索引与触发器；108／116 保留旧词 ID、手动关联和开关，先完成记忆组升级；117 升级摘要结构；118 拆分摘要开关；120 以前升级表情所有权，122 以前补齐单聊 Token 配置；122 升至 123 时增加收藏表；123 升至 124 新增摘要任务与请求设置，保留原摘要及处理进度；124 升至 125 增加昵称列与修改历史，已有助手默认未设置昵称。138 升至 139 增加行动步骤显示列，默认开启，保留已有 Token 选择与消息。139 升至 140 增加可空的单聊流式偏好，NULL 跟随主题，0／1 分别为非流式／流式，旧角色默认跟随主题。升级均在同一事务保留业务正文与处理进度，不重放已经完成的迁移，更早且不满足支持结构的开发库不自动清空。

`schema.ts` 装配当前结构，`migrations.ts` 拥有版本判断与原子建库/升级，`defaultRecords.ts` 只补建缺失默认记录。普通启动不再运行旧表清理和 DDL；以后有真实结构变化时追加增量升级，不重编号或重放已发布升级。兼容范围和验证见 [数据库基线](../../../docs/database-baseline.md)。

恢复出厂清空数据时保留当前连接和 schema，但在清库事务提交后失效旧初始化缓存。Host 重挂后的 `initDatabase()` 必须重新执行现有 bootstrap，重建 Memory 模型设置、向量状态、语音选择等固定默认记录，再开放 Feature 和后台队列。Repository 继续信任这些默认记录的存在契约，不在读取侧补空值或创建第二套初始化路径。
