import { readSpeechHttpError } from './SpeechHttpError';
import type {
  SpeechConnectionConfig,
  SpeechDelivery,
  SpeechMetadata,
  SpeechSynthesisResponse,
} from '../domain/SpeechProvider';
import { audioBytesToBase64 } from './speechAudioEncoding';

/** ElevenLabs 的音色位于 URL，表达标签进入合成输入而不进入 Chat 正文。 */
export async function synthesizeElevenLabs(
  config: SpeechConnectionConfig,
  metadata: SpeechMetadata,
  text: string,
  delivery: SpeechDelivery,
  signal?: AbortSignal,
): Promise<SpeechSynthesisResponse> {
  const tag = delivery.audioTag ?? metadata.audioTag;
  const voiceSettings: Record<string, unknown> = {};
  const mapping = {
    stability: 'stability',
    similarityBoost: 'similarity_boost',
    style: 'style',
    speakerBoost: 'use_speaker_boost',
    speed: 'speed',
  };
  for (const [key, apiKey] of Object.entries(mapping)) {
    if (config.model.startsWith('eleven_v4') && !['stability', 'similarityBoost'].includes(key)) continue;
    const value = key === 'speed' ? (delivery.speed ?? metadata.speed) : metadata[key];
    if (value != null) voiceSettings[apiKey] = value;
  }
  const response = await fetch(
    `${config.baseURL}/text-to-speech/${encodeURIComponent(String(metadata.voiceId))}?output_format=${metadata.outputFormat ?? 'mp3_44100_128'}`,
    {
      method: 'POST',
      signal,
      headers: { 'Content-Type': 'application/json', 'xi-api-key': config.apiKey },
      body: JSON.stringify({
        text: tag && tag !== 'auto' ? `[${tag}] ${text}` : text,
        model_id: config.model,
        voice_settings: voiceSettings,
        ...(metadata.languageCode ? { language_code: metadata.languageCode } : {}),
      }),
    },
  );
  if (!response.ok) {
    throw await readSpeechHttpError(response, 'ElevenLabs TTS', config.apiKey);
  }
  const audio = await response.arrayBuffer();
  if (!audio.byteLength) throw new Error('ElevenLabs 返回了空音频');
  return {
    success: true,
    audioBase64: audioBytesToBase64(audio),
    mimeType: 'audio/mpeg',
    model: config.model,
    error: null,
  };
}
