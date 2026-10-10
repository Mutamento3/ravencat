# Sticker Feature

本 Feature 拥有全局表情包收藏库、分组、收藏/最近使用、结构化标注状态、业务级模型配置、语义向量索引与混合搜索，不拥有图片文件生命周期，也不直接写入 Chat 消息。

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

- `STICKER_LIBRARY_MAX_COUNT`（500）是收藏库总量硬上限，在导入的 SQLite 事务内与 insert 一起判定；命中既有 MediaAsset 的重复内容复用不占新名额，也不受上限影响。
- `STICKER_LIST_LIMIT`（200）只是 UI / 普通列表查询的分页大小，语义检索候选集不使用它：`listReadyStickersForSemanticSearch` 返回当前过滤条件下的全部 ready Sticker，全量扫描只发生在本地检索内部，AI observation 仍然只拿到约 10 条。

## 公共入口

- `@features/stickers`：查询、用户命令、标注/向量队列命令、模型配置命令、Agent 工具 contract 与小程序页面。
- `@features/stickers/composition`：仅供 Host 装配 SQLite Repository、MediaAsset、辅助模型与 embedding 端口。

AI 搜索与分组浏览只消费 `annotation_status = 'ready'` 的表情包。动画表情不会进入静态识别模型；用户填写非空描述并手动完成标注后，才会进入 AI 可用集合。AI 通常先 `search_stickers`，分组浏览工具只在搜索不合适或用户明确要求时使用。
