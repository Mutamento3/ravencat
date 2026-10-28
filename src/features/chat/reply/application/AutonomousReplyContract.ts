/** 自主唤醒的显式静默信号；只匹配整段最终正文，不解释自然语言。 */
export const AUTONOMOUS_SILENT_REPLY = '[[NO_MESSAGE]]';

export function isAutonomousSilentReply(text: string): boolean {
  return text.trim() === AUTONOMOUS_SILENT_REPLY;
}
