import type {
  SpeechConnectionConfig,
  SpeechDelivery,
  SpeechMetadata,
  SpeechSynthesisResponse,
} from '../domain/SpeechProvider';
import { createMiniMaxSpeechClient } from './MiniMaxSpeechClient';
import { createOpenAISpeechClient } from './OpenAISpeechClient';
import { synthesizeElevenLabs } from './ElevenLabsSpeechClient';
import { getSpeechParameters } from '../application/SpeechProviderCatalog';

/** 正式合成与表单测试共用协议适配，不在 Assistants 复制请求构造。 */
export function synthesizeSpeechAudio(
  config: SpeechConnectionConfig,
  storedMetadata: SpeechMetadata,
  text: string,
  delivery: SpeechDelivery,
  signal?: AbortSignal,
): Promise<SpeechSynthesisResponse> {
  // 旧资产可能保留其他模型的参数；请求只投影当前模型声明的字段，不重复校验。
  const metadata: SpeechMetadata = { provider: storedMetadata.provider };
  for (const field of getSpeechParameters(storedMetadata.provider, config.model))
    metadata[field.key] = storedMetadata[field.key];
  switch (metadata.provider) {
    case 'minimaxT2aV2':
      return createMiniMaxSpeechClient({
        baseURL: config.baseURL,
        apiKey: config.apiKey,
        model: config.model,
        voiceId: metadata.voiceId as string,
        speed: metadata.speed as number | null,
        vol: metadata.vol as number | null,
        pitch: metadata.pitch as number | null,
        languageBoost: metadata.languageBoost as string | null,
        audioFormat: metadata.audioFormat as 'mp3' | 'wav' | 'flac' | null,
        sampleRate: metadata.sampleRate as number | null,
        bitrate: metadata.bitrate as number | null,
        channel: 1,
        emotion: metadata.emotion as string | null,
      }).synthesize({ text, speed: delivery.speed, emotion: delivery.emotion, signal });
    case 'elevenlabs':
      return synthesizeElevenLabs(config, metadata, text, delivery, signal);
    case 'openai':
    case 'openaiCompatible':
    case 'openrouter':
      return createOpenAISpeechClient({
        baseURL: config.baseURL,
        apiKey: config.apiKey,
        model: config.model,
      }).synthesize({
        text,
        voice: metadata.voiceId as string | null,
        speed: delivery.speed ?? (metadata.speed as number | null),
        instructions: delivery.instructions ?? (metadata.instructions as string | null),
        signal,
      });
    default:
      throw new Error('当前提供方不支持语音合成');
  }
}
