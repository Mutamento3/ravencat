/**
 * 上下文可见条数（主客动态装载）的共享默认值。
 *
 * 所有权属于 assistants（AIProfile 的模型行为设置），这里只放兜底常量：
 * AI 未配置或配置缺失时，各装配调用点与 PromptHistoryBuilder 用这些值兜底，
 * 取代旧的 DEFAULT_RECENT_WINDOW_LIMIT = 10。
 * 设计见 docs/prompt/context-window-primary-secondary-design.md。
 */

/** 单聊上下文作为当前交互主场时的可见条数。 */
export const DEFAULT_PRIVATE_CONTEXT_PRIMARY_LIMIT = 30;

/** 单聊上下文作为客体注入其他场景时的可见条数。 */
export const DEFAULT_PRIVATE_CONTEXT_SECONDARY_LIMIT = 10;

/** 群聊上下文作为当前交互主场时的可见条数。 */
export const DEFAULT_GROUP_CONTEXT_PRIMARY_LIMIT = 40;

/** 群聊上下文作为客体注入其他场景时的可见条数。 */
export const DEFAULT_GROUP_CONTEXT_SECONDARY_LIMIT = 5;
