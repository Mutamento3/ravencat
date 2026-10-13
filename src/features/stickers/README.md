# Sticker Feature

本 Feature 拥有用户与各 AI 的表情包收藏、用户分组/收藏/最近使用、结构化标注状态、业务级模型配置、语义向量索引与混合搜索，不拥有图片文件生命周期，也不直接写入 Chat 消息。

## 真实链路

```text
本地图片选择
→ 导入边界识别是否为动画
→ MediaAsset 在事务外准备文件与 Hash
→ 同一事务提交 MediaAsset + Sticker 引用
→ 静态图进入 pending；GIF / 动态 WebP / APNG 进入 manual_required
→ 前台 Host 空闲时单任务 claim
→ Sticker Recognition Model（引用辅助模型中心 ocr 类配置）生成结构化语义
→ complete / fail / 中断 release（semantic 语义字段变化时 semanticRevision +1）
→ embedding pending 信号
→ 前台 embedding worker 按批生成向量并原子 upsert sticker_embeddings
```

发送链路由 Chat 拥有：Sticker 只提供发送时的值快照，用户发送和 AI 的 `select_sticker` 意图都必须经过 Chat canonical commit。删除收藏项会级联删除其向量，但不删除 MediaAsset，也不改写历史消息。

## 模型引用边界

- 辅助模型中心是唯一的模型资产持有者（Base URL / API Key / model name）。
- Sticker System 只在 `sticker_system_config` 单例行中保存 `recognitionModelConfigId` / `embeddingModelConfigId`。
- Recognition 只接受 enabled 的 `ocr` 类配置，Embedding 只接受 enabled 的 `embedding` 类配置；两者都由 Sticker-owned resolver 解析，不读取 capability binding，也不做 legacy adoption。
- 识别 prompt 与 JSON contract 属于 Sticker（Host 的 StickerAnnotationModelGateway 注入），不复用 OCR consumer 的任务 prompt。
- 向量有效性 = 模型 ID + 模型配置 updatedAt 指纹 + semanticRevision + 查询维度，四者同时匹配才参与搜索；embedding 失败不影响 Sticker ready 状态，搜索始终保留 lexical fallback。
- 首页展示的当前模型来自 `getStickerSystemModelSelection()`（application query），与 picker 的候选列表相互独立：候选列表只在打开 picker 时加载，而展示状态每次进入页面都会按绑定模型重新判定 active / disabled / deleted / capability_mismatch。
- 切换模型持久化成功后会立即发出对应队列的 pending 信号，让已积压的标注 / 向量任务立刻恢复，不必等待重新前台或冷启动。

## 容量与检索范围

- `STICKER_LIBRARY_MAX_COUNT`（500）是每个收藏库的硬上限，在导入的 SQLite 事务内与 insert 一起判定；同一收藏库重复内容复用不占新名额，也不受上限影响。
- `STICKER_LIST_LIMIT`（200）只是 UI / 普通列表查询的分页大小，语义检索候选集不使用它：`listReadyStickersForSemanticSearch` 返回当前过滤条件下的全部 ready Sticker，全量扫描只发生在本地检索内部，AI observation 仍然只拿到约 10 条。

## 公共入口

- `@features/stickers`：查询、用户命令、标注/向量队列命令、模型配置命令、Agent 工具 contract 与小程序页面。
- `@features/stickers/composition`：仅供 Host 装配 SQLite Repository、MediaAsset、辅助模型与 embedding 端口。

分组浏览只消费用户库中 `annotation_status = 'ready'` 的表情包。搜索返回用户可发送表情与自己的收藏；自己的未标注/失败项也可按词面定位，再显式识别或修正语义。只有 ready 表情能发送，缺向量不妨碍词面检索和发送。动画表情只能由用户导入并填写语义，不进入静态识别模型。

## AI 收藏与维护

群成员回复沿用相同授权工具及用户库／自身库边界。发送意图由 Chat 共享 timeline 交付到当前群；收藏维护的提交资格由 Host 接入群任务 owner，终止后拒绝继续写入，不复制表情工具或发送流程。

`owner_assistant_id IS NULL` 表示用户库；每个 AI ID 表示其独立收藏库。同一素材在各库有独立的语义及向量。用户界面和用户命令只访问用户库；AI 读取用户与自己，编辑/删除只能作用于自己的记录。共享图片本身仍可供所有 AI 查看。

`add_own_sticker` 从已有媒体 ID 收藏静态图，可直接使用聊天图片说明中的 `mediaAssetId`；联网图片先由 `download_image` 下载取得 ID。复用全局表情识图模型，再自动尝试一次向量化。失败保留记录、阶段和原因，不进入用户前台 worker，也不自动重试。重复收藏返回现有状态。`maintain_own_sticker` 支持 inspect / recognize / embed / edit / delete；编辑使旧向量按语义版本失效，重新向量化必须显式调用。搜索、选择与维护结果都会提醒缺向量状态。

AI 模型调用在 Agent 工具内等待并共享取消信号。`ai_sticker_tasks` 的持久 claim 与语义版本挡住重复和迟到结果；Chat 副作用提交还在同一事务里检查回合 fence。新消息已撤销旧回合时，即使 JS 取消尚未抵达，也不能保存旧结果。旧执行实例遗留的 processing 项只在显式调用时接管，不启动后台重试。

验证：`npm run verify:ai-image-tools`、`node scripts/verify-stickers-v2.mjs`。设备上的真实模型请求和新消息打断需另行验收。
