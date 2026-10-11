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

数据库已收口到 schema 基线 116。新安装直接创建当前表、索引与触发器；当前公开版的 `user_version=108` 数据库通过保留数据的升级进入基线。开源前开发库不再重放历史迁移，结构不满足支持范围时阻断初始化，不自动清空用户数据。

`schema.ts` 装配当前结构，`migrations.ts` 拥有版本判断与原子建库/升级，`defaultRecords.ts` 只补建缺失默认记录。普通启动不再运行旧表清理和 DDL；以后有真实结构变化时追加增量升级，不重编号或重放已发布升级。兼容范围和验证见 [数据库基线](../../../docs/database-baseline.md)。

恢复出厂清空数据时保留当前连接和 schema，但在清库事务提交后失效旧初始化缓存。Host 重挂后的 `initDatabase()` 必须重新执行现有 bootstrap，重建 Memory 模型设置、向量状态、语音选择等固定默认记录，再开放 Feature 和后台队列。Repository 继续信任这些默认记录的存在契约，不在读取侧补空值或创建第二套初始化路径。
