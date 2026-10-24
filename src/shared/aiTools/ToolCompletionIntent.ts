/**
 * 用户可见输出工具（语音、表情包等）共用的 on_success 语义。
 *
 * 完成意图是本轮协议而不是单个工具的局部参数，所以完整规则只随工具运行要求
 * 注入一次；参数层只留最短语义，避免每个工具的 schema 各带一份长文。
 */
export const COMPLETION_INTENT_PARAMETER = {
  type: 'string' as const,
  enum: ['finish', 'continue'] as const,
  description: 'finish 结束本轮；continue 继续',
} as const;

/** 完成意图的完整规则，仅在暴露带 on_success 的工具时注入一次。 */
export const COMPLETION_INTENT_RULE =
  '带 on_success 的工具：finish 表示本次回复已完整，系统结束本轮、不再请求你；continue 表示还要发送其他内容或继续操作。同批多个工具按顺序执行，只有最后一个工具的 finish 决定结束；任何工具失败都会继续请求你。仅补充“已发送”这类状态说明不构成继续理由，也无需为可能失败提前选 continue。';
