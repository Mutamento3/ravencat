# 记忆系统 Feature

Memory V3 已接入生产。产品契约见 [实施规格](../../../docs/memory-simplification-v3-implementation-spec.md)，代码定位见 [引用索引](../../../docs/memory-simplification-v3-reference-index.md)。

## 产品入口

- /memory：AI×用户空间以星空中的恒星呈现，点星星打开记忆／触发词面板，正文列表按需渲染。新建／编辑、触发词关联详情与右上角设置均通过 App 适配为独立 Expo Router 页面。
- 单条正文最多 500 个 Unicode 字符，去首尾空白；不自动缩句、拆分、摘录或建立来源关系。
- 独立摘要选填、最多 50 个 Unicode 字符，不占正文额度；摘要与正文都参与字面检索、触发词关联和向量化。迁移107只给旧记忆增加空摘要，不改写正文、时间、revision 或已有向量。
- 协议空间可单向转存到当前 AI 的记忆空间。Host 用同一事务创建正文／摘要与向量待处理状态并删除原协议；失败全部回滚，commit 后再通知 UI 与 embedding worker。转换后不再常驻注入，没有来源联动或反向转换。
- remember_memory／recall_memory／update_memory／forget_memory 复用唯一 Agent Runtime。空间、run 和新建幂等键来自可信执行上下文；更新工具按记忆 ID 复用正文编辑命令，保留记住时间并自动更新向量。
- 被动召回只匹配本次输入；主动检索 lexical 优先、vector-only 补充，完整排序后固定 run 内队列并分页。
- 触发词以关联组管理：一次输入的多个词保存为一组，可同时选择同空间的一条或多条记忆，支持 1:1、1:n、n:1、n:n。词只在组内按规范化去重，跨组允许重复；命中任一词即带入本组开启的记忆，多组、多词命中按记忆 ID 去重。列表展示完整词集合与关联数量，详情可编辑词集合、添加记忆和维护组内关系开关。
- 新组默认只关联手动选择的记忆，可按组开启“正文或摘要包含任一词时自动关联”。手动关系在正文修改、再次启动和备份恢复后保留，删除任一端时清理；关闭一组的关系不影响其他组。117 升级将旧触发词逐条转成保留原 ID 的单词组，继续开启自动文本关联，保留旧手动关系和关闭事实，不自动猜测或合并旧组。
- embedding 可选。正文或摘要编辑自动重建，模型指纹＋内容 revision＋claim 由 Repository 原子比较；自动最多三次，终态可在详情手动重试。更新工具省略摘要时保留，空字符串时清除。
- /memory/settings 集中提供召回数量与向量模型选择，首页不再重复展示模型入口。向量模型仍用弹窗选择，展示当前选择及不可用状态；选择保存于 Memory 自有 `memory_model_settings`，所有记忆空间共用。配置管理进入辅助模型中心的 embedding 路由。
- 聊天两级摘要由 Chat 独立拥有，在聊天菜单管理；记忆工具包提供 Chat 的 search_chat_summaries，只按当前 AI 身份查询摘要，不复制成 MemoryEntry。两级独立维护、支持关闭与整批 token 归纳，当前产品契约见[对话两级摘要](../../../docs/architecture/chat-summary.md)。

## 所有权

domain 定义正文与排序规则、Repository port；application 拥有用户命令、查询、召回队列及 embedding use case。SQLite adapter 只通过 databaseCoordinator 提交事实。

index.ts 暴露稳定命令／查询／DTO／UI／工具；composition.ts 仅供 Host 装配具体仓储、模型端口和后台任务。Host 的前台队列处理唤醒、取消、reset／restore quiesce，业务状态仍在 Memory。

旧主题树、草稿、管理员、会话粘连、近期胶囊、来源关系和 F7 独立检索路径均已退出。尾部升级定向清理退休数据与绑定，不删除通用模型资产或其他 Feature。

## 星空呈现与资源预算

`presentation/MemoryGalaxy.tsx` 只拥有视觉交互，复用现有空间查询与选中命令。恒星不伪造记忆数量；数量来自打开空间后的真实快照。`MemorySpacePanel.tsx` 使用 FlatList 管理正文与触发词，导航仍由 App 适配。

`GalaxyBackground.tsx` 用 3 个静态渐变椭圆和 3 条远星／微尘路径绘制银河，不依赖图片资源，不随屏幕面积增加图元。近景仅有 28 个星点，分为 3 层闪烁，只更新层透明度；轻触期间才计算星点避让。同时最多绘制 6 个空间，更多空间分页。恒星轨道与拖动／缩放共用视口坐标，初始状态和复位均完整展示当前组。动画在 Reanimated UI 线程执行，不逐帧更新 React state，不创建 3000×3000 的旋转世界或实时模糊星云。

Screen 统一拥有装饰动效的生命周期：页面失焦、应用后台或面板打开时取消星空动画并停止流星计时器；开屏期间不同时播放星空，开屏光点尺寸有界；系统减少动态效果时跳过开屏、闪烁、自转、避让与流星。流星仅更新 transform 和 opacity，离开页面时取消未完成动画。

`galaxyStarField.ts` 用固定种子独立采样位置、尺寸与亮度，避免等差坐标造成整齐斜列。远星、微尘和近景分开采样；刷新、打开面板或改变视口不会重新洗牌。

性能预算是实现上的开销限制，并非各机型帧率承诺；正式流畅度、功耗仍需 Android 真机测量。

## 验证

npm run verify:memory 在隔离 SQLite 验证正文／摘要边界、空间隔离、幂等、关联组的多对多与同名词、组内开关、冻结分页、向量 CAS／三次上限、摘要交接／用户维护、第二次启动及 V3 快照恢复；也验证旧触发词迁组、旧记忆摘要迁移与协议转存的事务回滚、并发唯一成功和过期快照拒绝。另验证真实 Prompt 组装的旧预设、稳定前缀和无裁剪行为。npm run verify:database-baseline 覆盖 108／116 的生产升级入口及失败回滚。
