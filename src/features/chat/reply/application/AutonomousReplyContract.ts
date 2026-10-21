/** 自主唤醒的显式静默信号；只匹配整段最终正文，不解释自然语言。 */
export const AUTONOMOUS_SILENT_REPLY = '[[NO_MESSAGE]]';

export function isAutonomousSilentReply(text: string): boolean {
  return text.trim() === AUTONOMOUS_SILENT_REPLY;
}

/** 控制信号不作为正文展示；尚未收齐的标记也不产生过程占位。 */
export function autonomousActivityText(text: string): string {
  if (isAutonomousSilentReply(text)) return '本次选择不发送消息';
  if (AUTONOMOUS_SILENT_REPLY.startsWith(text.trim())) return '';
  return text;
}
