# SQLite 并发、事务与启动契约

当前入口为 `src/platform/persistence/`；连接、schema、migration、初始化与全局调度属于 Platform。业务 SQL、row mapping、Repository port 与 SQLite adapter 属于对应 Feature。入口概述见[持久化平台 README](../src/platform/persistence/README.md)。

## 1. 所有权

| 所有者 | 职责 |
| --- | --- |
| databaseCoordinator | 全局任务调度、读写隔离、事务执行、barrier 与诊断 |
| Feature Repository | SQL、数据映射、业务原子写入、唯一约束与 CAS |
| Feature application | 业务流程、幂等含义、任务终态与 commit 后副作用 |
| Host | bootstrap、首屏、运行时恢复、维护和 reset/restore 的组合顺序 |

Feature、Host、App 与 Shared 不获取原始 SQLite connection。Repository 通过 `@platform/persistence` 的唯一生产 `databaseCoordinator` 取得 executor；公共出口不转发业务 Repository。

协调器不理解 assistantId、sessionId、poolId，不自动合并业务写入、推断幂等或恢复失败业务。数据库串行执行不能替代业务 claim：读取状态、await 模型后再写入的竞争仍由 owner 的事务、CAS、fence 或唯一约束解决。

## 2. 调度与公平性

```text
bootstrap > surface > interactive > runtime > maintenance
```

- 所有 write、transaction 与独占写作用域共享单写者调度。
- read 默认最大并发为 2；写入执行期间没有其他 read/write 插入。
- 有 write/barrier 等待时，不再补入新的并发 read，避免读取持续占用而饿死写者。
- 活跃任务不可抢占；优先级只决定下一个待执行任务，同等得分按入队顺序执行。
- 等待时长提升防止低优先级永久饿死；maintenance 分短批次，批次结束重新排队。
- barrier 等待此前任务全部完成，后续任务不能越过它。它是明确顺序边界，不是 sleep。

surface 服务最小可见状态；interactive 服务消息、会话和通话等用户等待的操作；runtime 服务业务恢复；maintenance 服务可延后的向量、摘要和清理。不把历史 backlog 整体塞进一个高优先级任务。

## 3. Executor 与事务

`openTaskExecutor(meta)` 为 Repository 操作绑定 name、priority、feature 与可选 traceId；非事务 SQL 仍逐条经协调器调度。业务原子组合必须进入 `transaction()` 或 executor 的 `withExclusiveTransactionAsync()`。

事务 callback 只使用传入的 `DatabaseTransactionExecutor`：

```text
事务内：SQL、短小纯计算、row/entity mapping、业务不变量检查
→ commit
→ UI/cache 更新
→ public fact/domain event
→ 派生任务（后续写入再次经 coordinator）
```

事务内禁止网络/模型、文件 IO/Hash、Android 调用、通知、TTS/ASR、timer、UI 等待、subscriber、跨 Feature 发布或进入另一个业务队列。事务执行期间不得调用外层 executor 再排一项任务，也不得嵌套事务。

`withExclusiveWriteScopeAsync()` 是单个调度器写任务，不自动执行 SQLite BEGIN；仅用于需要独占连接作用域的已有技术操作，不能冒充业务原子事务。

依赖刚写入的数据，应使用同一事务读取、事务返回值或明确 barrier。`DatabaseReadTaskMeta.consistency` 表达普通读取或等待此前写入，不用 timeout 猜 commit。

Chat 消息与 session preview、MediaAsset 与业务引用、群聊 claim 与执行状态等属于各 owner 的原子组合。对外事件和文件清理一律在事实 commit 后执行。

## 4. Bootstrap、恢复与首屏

Host 先完成数据库与待处理恢复事务，再开放依赖它的 Feature：

```text
数据库 bootstrap
→ 最小可见表面
→ Chat 首屏可读
→ 运行态 recovery
→ 前台空闲维护
```

原生装配不能把“恢复流程已经返回”当作“普通数据库已初始化”：没有 restore action 的路径也必须等待当前 generation 的 bootstrap。普通 Chat、Calls 与 Together 通知动作通过 Host 的 `ensureHostDatabaseReady()` 共用“恢复门 → 普通 bootstrap”，Repository 不重复建立启动门。

恢复门拥有数据库 generation、文件激活与 stable settings 的事务终态，详见[备份恢复契约](backup-and-restore-implementation-plan.md)。reset/restore 前 Host 取消并等待旧 worker，开放新 generation 前重新 bootstrap 固定默认记录。Repository 信任已建立的默认记录，不在读取侧创建第二套初始化。

数据库核心初始化失败时不能开放业务读取或后台队列，也不能以零行/默认值掩盖。启动维护不阻塞聊天首屏，不用定时延迟安排启动顺序。

## 5. 错误与诊断

SQLite 是外部边界；协调器统一分类并携带操作上下文传播错误。当前协调器不自动重试；metadata 中的幂等描述不代表已授权 retry。调用点不得增加 busy retry、sleep、同步查询替代、无限 busy_timeout 或吞掉锁错误。

事务诊断必须具有 committed/rolled_back 终态。任务记录 name、优先级、queuedAt、startedAt、耗时及 transactionId/traceId 等关联信息；开发诊断区分取得连接、SQL 操作与 continuation 等待，不能把连接或 JS 冻结误判为慢查询。

不得记录 API Key、Prompt、聊天正文或完整 SQL 参数。长事务、未终结事务和持续排队应在真正的 owner/调度边界定位。

## 6. 验证与设备边界

- `architecture:sqlite`：连接访问、Repository 与调度边界。
- `verify:sqlite-coordinator`：单写者、读取上限、公平性、barrier、事务与诊断。
- `verify:startup-recovery`：Host 启动顺序与恢复行为。
- 所属 Feature 行为验证：业务原子提交、回滚、claim、CAS、fence 和共享引用。

只运行修改涉及的检查。Android 冷启动、前后台切换、真实 statement 生命周期、并发压力、restore/reset 与进程中断需真机验收；本地 Node/SQLite 验证不能宣布设备锁问题已关闭。Expo 原生生命周期补丁的原因与升级删除条件见平台 README，不在业务调用处补重试。
