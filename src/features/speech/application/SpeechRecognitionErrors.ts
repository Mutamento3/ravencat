import type { ErrorDisplayInfo } from '@platform/ai';

/** STT 提供方的具体识别错误不能被聊天模型的通用文案覆盖。 */
export function getSpeechRecognitionErrorInfo(message: string): ErrorDisplayInfo {
  return { title: '语音识别失败', message, type: 'speech_recognition' };
}
