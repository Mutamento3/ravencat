/** OpenAI 兼容语音接口适配器。 */
import { normalizeAIBaseURL } from '@platform/ai';
import { audioBytesToBase64 } from './speechAudioEncoding';
import { readSpeechHttpError } from './SpeechHttpError';
import type { SpeechAudioFormat, SpeechSynthesisRequest, SpeechSynthesisResponse } from '../domain/SpeechProvider';

export interface OpenAISpeechClientConfig {
  baseURL: string;
  apiKey: string;
  model: string;
}

const MIME_BY_FORMAT: Record<SpeechAudioFormat, string> = {
  mp3: 'audio/mpeg',
  opus: 'audio/ogg',
  aac: 'audio/aac',
  flac: 'audio/flac',
  wav: 'audio/wav',
  pcm: 'audio/pcm',
};

export class OpenAISpeechClient {
  private readonly baseURL: string;
  private readonly apiKey: string;
  private readonly model: string;

  constructor(config: OpenAISpeechClientConfig) {
    this.baseURL = normalizeAIBaseURL(config.baseURL);
    this.apiKey = config.apiKey;
    this.model = config.model;
  }

  async synthesize(params: SpeechSynthesisRequest): Promise<SpeechSynthesisResponse> {
    const text = String(params.text || '').trim();
    if (!text) {
      return this.createSynthesisError('TTS input text is empty');
    }

    const responseFormat = params.responseFormat || 'mp3';

    try {
      const response = await fetch(`${this.baseURL}/audio/speech`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        signal: params.signal,
        body: JSON.stringify({
          model: this.model,
          input: text,
          voice: params.voice || 'alloy',
          response_format: responseFormat,
          ...(params.speed ? { speed: params.speed } : {}),
          ...(params.instructions ? { instructions: params.instructions } : {}),
        }),
      });

      if (!response.ok) {
        throw await readSpeechHttpError(response, '语音合成', this.apiKey);
      }

      const audioBase64 = audioBytesToBase64(await response.arrayBuffer());
      if (!audioBase64) {
        throw new Error('Invalid TTS response: empty audio payload');
      }

      return {
        success: true,
        audioBase64,
        mimeType: MIME_BY_FORMAT[responseFormat],
        error: null,
        model: this.model,
      };
    } catch (error) {
      return this.createSynthesisError(error instanceof Error ? error.message : 'TTS request failed');
    }
  }

  private createSynthesisError(error: string): SpeechSynthesisResponse {
    return {
      success: false,
      audioBase64: '',
      mimeType: '',
      error,
      model: null,
    };
  }
}

export function createOpenAISpeechClient(config: OpenAISpeechClientConfig): OpenAISpeechClient {
  return new OpenAISpeechClient(config);
}
