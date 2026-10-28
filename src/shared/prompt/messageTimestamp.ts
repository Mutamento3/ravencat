/** 时间与来源提示属于应用元数据，不能写进 assistant 正文成为可模仿的回复范例。 */
export function renderPromptMessageWithTimestamp<T extends { createdAt?: string; systemNotice?: string }>(
  message: T,
  enabled: boolean,
): (Omit<T, 'createdAt' | 'systemNotice'> | { role: 'system'; content: string })[] {
  const { createdAt, systemNotice, ...body } = message;
  const metadata: string[] = [];
  if (enabled && createdAt !== undefined) {
    const timestamp = new Date(createdAt).toISOString().slice(0, 19) + 'Z';
    metadata.push(`【下一条消息的记录时间】${timestamp}\n系统元数据，非消息正文或回复格式；无明确要求禁止在回复中附加时间戳。`);
  }
  if (systemNotice !== undefined) {
    metadata.push(`【下一条历史消息的系统提示】\n${systemNotice}\n这是应用附加说明，不是历史发言正文或回复格式，不要在回复中复述这些标记和说明。`);
  }
  return metadata.length ? [{ role: 'system', content: metadata.join('\n\n') }, body] : [body];
}
