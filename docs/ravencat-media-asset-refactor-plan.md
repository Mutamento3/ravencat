# MediaAsset 与媒体生命周期契约

Media Feature（`src/features/media/`）拥有持久媒体身份、catalog、resolver、准备文件与生命周期裁决。Chat、Calls、Profile、Moments、Sticker 等引用资产，并各自拥有业务语义。跨 Feature 只使用 `@features/media`；具体 Repository、backing 与业务端口由 Host 装配。

## 1. 稳定资产身份

MediaAsset 保存 id、storageBackend、storageKey、SHA-256、MIME、最终字节数、可选尺寸/时长、ready/missing 和时间戳。

- `storageKey` 是 backing 内部的不透明相对定位键，不是 file/content URI、绝对路径或设备根目录。
- resolver 根据 backend + key 生成当前设备的运行时 URI；backend 标识与 key 的解释不得悄悄改变。
- Hash 对最终持久化完整字节计算，不对转码前 picker 源文件计算。Hash 是 metadata，不是全局身份；候选复用仍核对字节数、MIME 和必要内容，不跨 backend 强制唯一。
- ready 表示已识别且应可读取的持久内容；missing 保留已知 metadata，表示该资产 backing 缺失。
- 从未读成功的旧 URI 不能伪造 Hash/大小或登记为 missing。旧不可读选择由所属 Feature 保持明确状态，允许用户清除或重选。

transcript、Sticker annotation、头像归属、retention 和备份策略不进入 MediaAsset。远端 URL、bundle/native resource、临时缓存不因“界面用到它”就成为长期资产。

## 2. 准备、原子引用与补偿

```text
事务外准备文件、最终 metadata 与 reservation
→ databaseCoordinator transaction
  创建/复用 catalog + 提交业务引用
→ commit
→ finalize prepared batch
→ UI/public fact/派生任务
```

业务 Repository 与 Media Repository 使用同一个 transaction executor；Media 不嵌套事务，SQL 内不读文件、Hash、压缩、调用模型或原生能力。

prepared batch 成功后 `finalizeAfterCommit()`；事务回滚后 `discardAfterRollback()`，尚未 staged 时 `discard()`。补偿只处理本次准备的文件，不能删除已被其他事实接管的共享 backing。commit 后清理失败不撤销已经成立的业务事实。

canonical storageKey 在文件第一次可能被目录枚举看到之前 reserve，先 reserve 再 copy；commitPrepared 或 delete 才解除。reservation 属于文件生命周期，不能在 UI 或调用点用 delay 代替。

## 3. 引用所有权与删除

当前 live reference 覆盖 Profile 壁纸/时刻封面、Calls 背景、用户/AI/群头像、Moment 图片、Sticker，以及 Chat 附件、缩略图、语音与 Sticker snapshot。Chat snapshot 仍可能持有 live 资产引用，不因为它叫 snapshot 就忽略。

不维护一份可漂移的 refCount。业务删除只撤销自身事实，再由 Media 根据全部真实引用裁决：

```text
同一删除事务收集候选 + 删除业务引用
→ commit
→ targeted release 的独占事务重新检查所有引用源
→ 无引用 catalog row 删除并 commit
→ 事务外删除 backing
```

仍被其他 owner 引用的资产保留。catalog 删除后文件删除失败只留下可再次发现的 physical orphan，不保留指向已删除文件的假引用。所有文件操作限 RavenCat-owned backing，不删除外部 picker/gallery/document URI。

交互入口只对本次候选 targeted release，不做全库目录/metadata 扫描。全库 `auditMediaAssetClosure()` / `cleanupMediaAssetOrphans()` 是诊断与显式维护入口，不进入启动关键路径，不新增周期 GC、LRU、quota 或全库 Hash。

## 4. 审计与物理清理

审计区分 orphan catalog、physical orphan、dangling reference、不可解析引用来源与不可用 backing。普通读取不顺便改写 catalog；显式 cleanup 在事务外探测文件，并在事务内仅把 locator 仍匹配的已知资产标为 missing。

physical orphan 枚举只扫描 canonical create 独占的 `catalog/media/` 和 `catalog/images/`。legacy category 仍有裸 URI consumer 时不能按“没有 catalog row”盲删，Factory Reset 由 Host 统一清理所属路径。

物理快照会过期。真正删除之前重新检查 reservation 与当前 catalog 是否接管该 locator；不能删除 audit 后才准备或提交的 live backing。

存在 dangling reference 时，destructive physical orphan cleanup fail-closed，只报告不删除。不能从 assetId 猜回 storageKey 来尝试修补，因为 sanitize 和扩展名映射并非可逆。

## 5. 当前业务使用边界

| 使用方 | 当前事实 |
| --- | --- |
| Profile | SQLite 持有壁纸、会话覆盖和时刻封面资产选择；theme/页面只消费 Host 投影；替换/清除使用 owner 的 revision/CAS |
| Calls | 背景是稳定资产引用；lookAtUser 快照只服务本轮，成功/失败/取消/通话终态及时销毁，旧进程残留冷启动清理，不建长期资产 |
| Moments | 发布同事务提交 Moment、audience、媒体引用和 Inbox；图片理解是独立持久语义快照，不进入 Media catalog |
| Sticker | 收藏库保存模型 binding、识别和向量状态；文件生命周期复用 Media，发送由 Chat canonical commit |
| Chat 语音 | 用户录音/ASR/校对后在 T1 同事务提交音频资产与消息；AI TTS prepared intent 在原有 T3 fence 内物化 |

Calls TTS cache 等可再生临时资源不长期化。悬浮装扮的完整资产接入不属于已完成媒体能力，不因历史路线编号而恢复另一套 catalog。

## 6. 备份、迁移与 reset

资产身份不决定备份范围。Backup 通过业务 owner/reference 选择长期媒体；临时 Calls 快照默认排除，包内数据库副本也不保留有效临时 URI。备份在持有文件删除边界期间取一致 SQLite snapshot，再核对 backing，文件 IO 不在事务中。

恢复保留资产 ID 和 backend-relative key，由目标设备 resolver 生成运行时 URI。缺失/损坏的有效引用在 staging 边界拒绝，不把不完整备份静默恢复为成功，详见[备份契约](backup-and-restore-implementation-plan.md)。历史头像/附件仍有真实裸 URI consumer 时，既有来源根重定位继续由对应 owner 负责，不为将来假想需求增加兼容。

本机旧选择的迁移必须先提交持久事实，再清理旧设置，允许中断后续跑；不可读项如实保留，不能先删后迁。reset 由 Host 先 quiesce worker、提交清库，再清理所属 backing/cache/temp；后置清理失败不能伪装成业务事务回滚。

## 7. 验证

按修改范围运行媒体、所属 Feature 与备份行为验证，保护共享引用、prepare/rollback、reservation、晚到提交、stale audit、dangling fail-closed、替换/删除竞态与 reset 后置清理。设备文件访问、MediaStore、真实恢复和跨设备 backing 仍需 Android 验收。测试不冻结 helper 或源码形状。
