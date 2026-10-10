# 本地备份与恢复

当前入口、结构和验证见 [Backup README](../src/features/backup/README.md)。本文只保留备份格式、信任边界与恢复事务的专项约束。

## 产品范围

- 创建、列举、删除本地完整备份；固定保存到 `下载 / RavenCat`。
- 新备份无需密码，完整配置随数据库保存，API 地址、Key、App ID、Secret 均为明文。
- 不保留旧加密包恢复、密码管理、Keystore 密码缓存或 GitHub 远端预留。
- 旧包仍可在列表删除。外部文件通过一次性 SAF 单文件授权导入。
- 不整体备份 SharedPreferences；原生唯一用户真相通过所属 owner 的 stable settings port 导出。
- 系统权限、缓存、诊断和可再生运行时投影不进入备份。

## Format V2

```text
RAVENBKP magic
→ 4 字节大端 header 长度
→ UTF-8 JSON header：formatVersion=2, cipher=none
→ ZIP：manifest.json、database/raven.db、settings/stable-settings.json、长期文件
```

清单记录备份时间、App 版本、数据库契约、来源平台，以及每个 entry 的相对路径和字节长度。ZIP CRC 负责检查文件意外损坏；无需单独预读媒体计算 SHA-256。CRC 不承担加密或防篡改认证。

原生格式 owner 在恢复输入边界验证 magic、版本、清单、数量、长度、空间、路径、重复项、缺失项和 ZIP CRC；拒绝路径穿越和展开数据超出清单声明长度。数据库 contract 必须与当前版本完全相同，不隐式兼容尚未迁移的旧库。

创建方信任已经取得的一致快照、媒体文件生命周期与严格设置导出契约，流式打包一次后发布，不通过恢复流水线重新解包自产备份。低压缩等级减少已压缩图片、音频的重复压缩成本。

## 创建与文件生命周期

```text
Backup Runtime mutation claim
→ 完成相关旧媒体迁移
→ withMediaFileLifetime
→ databaseCoordinator 独占快照
→ 读取快照引用并核对 backing 存在与长度
→ owner 稳定设置导出
→ 流式打包
→ MediaStore pending 写入、关闭、发布
→ 删除临时快照与产物
```

Snapshot 的 SQL 通过 coordinator 执行；文件 IO、压缩与 MediaStore 不在 SQLite 事务内。持有媒体删除边界保证已提交 backing 在打包期间存在，不阻塞正常业务事实提交。通话快照等排除项仍遵守其所属 owner 的备份契约。

MediaStore 列表只展示当前应用可访问的文件。中断发布的 pending 项按所属应用、目录、MIME、文件名前缀、年龄和单次上限有界清理。删除由 Downloads Target 执行，UI 先显示文件名并确认。

## 恢复事务

先在私有 staging 完成格式、SQLite `integrity_check` / `foreign_key_check`、stable settings 与媒体引用校验，任何失败都不触碰当前数据。

```text
staging 验证完成
→ 导出当前稳定设置到私有 rollback
→ journal prepared
→ 退出进程
→ 冷启动 applying：移动原数据库、WAL/SHM 和媒体到 rollback
→ 激活 incoming 文件
→ activated
→ 启动门执行真实 initDatabase 与全部设置恢复
→ committed
→ 删除 staging 与 rollback
```

`committed` 是唯一成功提交点。`applying` / `activated` 中断或失败时通过 `rolling_back → rollback_settings → rolled_back` 补偿；终态 GC 可重入，清理失败不反转事务结果。

恢复前不再使用完整备份流水线生成额外下载文件。私有 rollback 已保留当前数据，采用文件移动避免复制、Hash、压缩和发布的重复成本；完成后自动删除。

## 恢复后 SQLite 原生报错

当前 Expo SDK 54 的 `SharedObjectRegistry` 存在注册表部分读取不加锁的问题。依赖源码的写入与删除加锁，但 `toNativeObject` 及 JS 对象转换读取未加锁；扩容期间可能误判仍存活的对象已释放。上游复现见 [Expo #50855](https://github.com/expo/expo/issues/50855)。该机制与恢复后首条消息日志吻合，具体设备仍需复测确认。

`scripts/patch-expo-shared-object-registry.cjs` 在 postinstall 为上述两个读取入口补齐相同的锁，不改变业务查询调度、增加 retry 或吞掉错误。依赖升级已包含修复后应删除补丁；源码变化时补丁明确失败并要求审查。

原生改动需进入新安装的应用二进制，Metro 刷新无法替换已安装的 Kotlin 实现。定向 Kotlin 编译与单元验证不能替代恢复后首条消息的设备复验。
