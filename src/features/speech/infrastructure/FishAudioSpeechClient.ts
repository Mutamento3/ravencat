import type {
  SpeechConnectionConfig,
  SpeechDelivery,
  SpeechMetadata,
  SpeechSynthesisResponse,
} from '../domain/SpeechProvider';
import { audioBytesToBase64 } from './speechAudioEncoding';
import { readSpeechHttpError } from './SpeechHttpError';

/** Fish 原生协议的模型属于请求头，音色属于 reference_id；不经过 OpenAI 兼容适配。 */
export async function synthesizeFishAudio(
  config: SpeechConnectionConfig,
  metadata: SpeechMetadata,
  text: string,
  delivery: SpeechDelivery,
  signal?: AbortSignal,
): Promise<SpeechSynthesisResponse> {
  const format = metadata.audioFormat ?? 'mp3';
  const speed = delivery.speed ?? metadata.speed;
  const response = await fetch(`${config.baseURL.replace(/\/+$/, '')}/tts`, {
    method: 'POST',
    signal,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey}`,
      model: config.model,
    },
    body: JSON.stringify({
      text,
      reference_id: metadata.voiceId,
      format,
      ...(speed != null ? { prosody: { speed } } : {}),
      ...(metadata.temperature != null ? { temperature: metadata.temperature } : {}),
      ...(metadata.topP != null ? { top_p: metadata.topP } : {}),
      ...(metadata.latency != null ? { latency: metadata.latency } : {}),
      ...(metadata.normalize != null ? { normalize: metadata.normalize } : {}),
    }),
  });
  if (!response.ok) {
    throw await readSpeechHttpError(response, 'Fish Audio', config.apiKey);
  }
  const audio = await response.arrayBuffer();
  if (!audio.byteLength) throw new Error('Fish Audio 返回了空音频');
  return {
    success: true,
    audioBase64: audioBytesToBase64(audio),
    mimeType: format === 'wav' ? 'audio/wav' : 'audio/mpeg',
    model: config.model,
    error: null,
  };
}
