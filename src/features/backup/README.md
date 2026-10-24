# Backup Feature

Backup 负责完整本地备份、恢复和列表删除，不拥有 SQLite 连接。

## 当前流程

创建备份不需要密码，包含聊天、长期媒体、完整数据库配置（包括数据库中的 API 地址、Key、App ID 和 Secret）以及稳定设置。SecureStore 中的联网搜索 Key 和 MCP Token 不导出；恢复后若本机不存在对应凭据，需要重新填写。

```text
设置 → 备份与恢复
→ 通过 databaseCoordinator 创建 SQLite 一致快照
→ 检查快照引用的长期媒体并导出稳定设置
→ Android 流式打包 Format V2（未加密，低压缩等级）
→ MediaStore 原子发布到 下载 / RavenCat
```

媒体内容只在打包时读取，不预先计算 SHA-256，也不创建后再整包解压自检。ZIP 在写入时计算 CRC，恢复读取时自动检查 CRC；备份清单记录文件路径与长度。

列表提供恢复与删除（带确认）。旧加密包可以删除，不再支持恢复。重装或换机复制的文件可能没有本应用的 MediaStore ownership，此时通过“选择外部备份包”授权单个文件。

恢复完全替换当前数据，不合并：

1. 校验 V2 格式、文件路径与长度、ZIP CRC、SQLite 完整性和外键；
2. 在 staging 检查各 owner 的设置与媒体引用；
3. 导出当前稳定设置，登记 journal 并退出应用；
4. 冷启动在 React Native 和 SQLite 打开前，将原数据库、WAL/SHM 与媒体移动到私有 rollback 目录，激活新数据；
5. 启动门完成真实 bootstrap 与稳定设置恢复后提交 `committed`；
6. 成功后自动清理 staging 和 rollback；失败或提交前中断则恢复旧数据及设置。

不再额外生成一份下载目录中的恢复前备份。私有 rollback 就是本次恢复的临时保护副本，文件移动避免重复读写全部媒体。终态清理可在下次冷启动继续执行。

Format V2 要求 `databaseContractVersion` 与当前版本相同。所有文件校验在恢复触碰当前数据前完成。

## 所有权

- `application/`：创建、恢复用例与 Runtime 契约；
- `domain/`：产物、存储 Target、Archive Builder、Restore Gateway；
- `infrastructure/`：Android 适配、Downloads Target、稳定设置来源；
- `composition.ts`：Host 装配具体实现的出口；
- `modules/backup-storage/`：流式格式、MediaStore、staging 和冷启动激活；
- Host：媒体生命周期持有、恢复启动门与跨 Feature owner 装配。

当前只有本地备份，没有 GitHub 入口或远端占位。

## 旧缓存图片选择修复

备份页提供「清除旧缓存图片选择」，经用户确认后，由 Host 通过各业务 owner 清除仍指向 Android 应用私有缓存的旧通话背景、壁纸和时刻封面引用，恢复默认。缓存中仍可读取的旧图片也属于清除范围；已迁入 MediaAsset 的选择、长期目录中的旧图片、消息和附件均不受影响，不删除缓存目录或媒体文件。

Calls 只清除一次性迁移中尚未独立改选的旧背景；Profile 壁纸和封面通过既有 revision/事务提交，避免覆盖并发改选。完成后刷新壁纸投影并发布封面资料更新。各 owner 独立提交，某项失败时已完成的清除保留，再次执行只处理剩余旧引用。修复与创建、恢复、删除备份共享 Runtime mutation claim，不在正常备份中自动清除选择。

## 验证

`verify:backup-local-target`、`verify:backup-coverage`、`verify:backup-restore` 验证应用用例；`verify:backup-artifact` 验证 SQLite 完整性。`:backup-storage:testDebugUnitTest` 验证真实 Kotlin 格式往返、完整配置与媒体、CRC、截断、路径越界和数据库契约。

MediaStore、冷启动文件切换和恢复后首条消息仍需真机验收。
