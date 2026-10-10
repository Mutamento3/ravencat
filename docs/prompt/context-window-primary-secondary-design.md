# 上下文主客配置与摘要门槛

本文定义现有四项上下文配置的归属与适用范围。普通单聊、通话实时回复和去电决策使用全部已有摘要与未总结原文；不是最近 N 条硬截断。摘要的生成、处理游标与原文交接统一见 [Memory V3 §18～22](../memory-simplification-v3-implementation-spec.md#18-聊天摘要的产品契约)。

## 1. 当前范围

单聊·主已用于聊天与通话的共同摘要门槛 N。群聊两个配置可编辑和持久保存，尚不参与群聊上下文装载；跨场景客体注入不因配置字段存在而自动开放。

## 2. 主客相对性

主表示上下文来源就是当前交互主场，客表示同一来源作为其他场景的背景。主客是来源与场景的关系，不是第二套消息或摘要。

| 来源 | 主 | 客 |
| --- | --- | --- |
| 一对一会话 | 单聊与通话共享的来源 | 其他场景读取该会话背景时的展示配置 |
| 群聊会话 | 当前群场景 | 其他场景读取群背景时的展示配置 |

尚未接通的客体与群聊装载不能从表中推导为已实现。

## 3. 持久化所有权

Assistants 的 AIProfile/ai_assistants 持有四个模型行为设置；不保存到 Prompting 编排表：

| 字段 | 默认值 |
| --- | ---: |
| privateContextPrimaryLimit | 30 |
| privateContextSecondaryLimit | 10 |
| groupContextPrimaryLimit | 40 |
| groupContextSecondaryLimit | 5 |

共享默认常量位于 `src/shared/prompt/contextWindowLimits.ts`，只是配置默认值，不授予新的查询能力或建立新的业务 owner。

## 4. 普通单聊、通话与自主执行

Chat 拥有摘要处理状态与 canonical 投影，Host 经 `PromptHistoryBuilder` 装配全部摘要和未处理原文。通话是当前一对一来源的延续，转写与普通消息共用同一摘要计数，不再使用通话事件 over-fetch 或“最后 N 条”覆盖未处理原文。

AI 日程只有一次正常自主执行，没有独立的先客后主决策模型或 `raven_cat.proactive_decision` 链。自主执行按当前任务与会话边界读取上下文，不额外开放群聊客注入。

## 5. 计数与原文保护

有正文的 canonical user/assistant 消息与通话真实转写参与摘要计数；系统状态、工具事实和 TTS 分句不重复占额度。Current Input 单独保护，不在历史中再次出现。

摘要提交前保留完整待处理原文，提交后才按同一事务的 watermark 交接。N 不授权在等待摘要时裁剪原文，也不增加自动 token 裁剪。

## 6. 摘要生成与客展示

通话中达到 N 等待终态，短通话继续累计；长原文最多5000字顺序分片，全部成功后原子追加摘要和进度。AI 只追加，用户可维护旧段；删除消息不删除已有摘要。

摘要属于来源会话。客展示配置不改变生成批次、处理游标或旧摘要，不触发重切、递归压缩或重新生成。

## 7. 设置 UI

`src/features/assistants/presentation/management/AIModelSettings/ContextWindowSection.tsx` 展示单聊·主、单聊·客、群聊·主、群聊·客四个正整数输入，走现有表单和模型设置命令保存。

群聊两个字段标注“暂未生效”，允许编辑、保存，不禁用。页面草稿边界验证输入；Repository 和下游信任保存契约，不重复补值。自动保存行为见[模型设置契约](../architecture/model-settings-autosave.md)。

## 8. 验证与范围边界

相关验证保护四项配置的保存、摘要门槛、真实对话计数、统一 Chat/Calls 上下文、完整未处理原文和 Current Input。群聊·主、单聊/其他场景的群聊·客及跨场景单聊·客装载仍需独立产品范围；不借文档整理实现这些能力。
