/** 时间属于应用元数据，不能写进 assistant 正文成为可模仿的回复范例。 */
export function renderPromptMessageWithTimestamp<T extends { createdAt?: string }>(
  message: T,
  enabled: boolean,
): (Omit<T, 'createdAt'> | { role: 'system'; content: string })[] {
  const { createdAt, ...body } = message;
  if (!enabled || createdAt === undefined) return [body];
  const timestamp = new Date(createdAt).toISOString().slice(0, 19) + 'Z';
  return [{
    role: 'system',
    content: `【下一条消息的记录时间】${timestamp}\n系统元数据，非消息正文或回复格式；无明确要求禁止在回复中附加时间戳。`,
  }, body];
}
