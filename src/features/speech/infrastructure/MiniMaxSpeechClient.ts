/** MiniMax 语音合成接口适配器。 */
import { readSpeechHttpError } from './SpeechHttpError';
import { normalizeAIBaseURL } from '@platform/ai';
import type {
  SpeechSynthesisRequest,
  SpeechSynthesisResponse,
} from '../domain/SpeechProvider';

export type MiniMaxT2AAudioFormat =
  | 'mp3'
  | 'pcm'
  | 'flac'
  | 'wav'
  | 'pcmu_raw'
  | 'pcmu_wav'
  | 'opus';

export interface MiniMaxSpeechClientConfig {
  baseURL: string;
  apiKey: string;
  model: string;
  voiceId: string;
  speed?: number | null;
  vol?: number | null;
  pitch?: number | null;
  languageBoost?: string | null;
  audioFormat?: MiniMaxT2AAudioFormat | null;
  sampleRate?: number | null;
  bitrate?: number | null;
  channel?: number | null;
  emotion?: string | null;
}

interface MiniMaxT2AResponse {
  data?: {
    audio?: string;
    status?: number;
  } | null;
  extra_info?: {
    audio_format?: string;
  };
  trace_id?: string;
  base_resp?: {
    status_code?: number;
    status_msg?: string;
  };
}

const MIME_BY_FORMAT: Record<MiniMaxT2AAudioFormat, string> = {
  mp3: 'audio/mpeg',
  pcm: 'audio/pcm',
  flac: 'audio/flac',
  wav: 'audio/wav',
  pcmu_raw: 'audio/basic',
  pcmu_wav: 'audio/wav',
  opus: 'audio/ogg',
};

export class MiniMaxSpeechClient {
  private readonly endpoint: string;
  private readonly apiKey: string;
  private readonly model: string;
  private readonly voiceId: string;
  private readonly speed: number | null;
  private readonly vol: number | null;
  private readonly pitch: number | null;
  private readonly languageBoost: string | null;
  private readonly audioFormat: MiniMaxT2AAudioFormat;
  private readonly sampleRate: number | null;
  private readonly bitrate: number | null;
  private readonly channel: number | null;
  private readonly emotion: string | null;

  constructor(config: MiniMaxSpeechClientConfig) {
    this.endpoint = resolveMiniMaxT2AEndpoint(config.baseURL);
    this.apiKey = config.apiKey;
    this.model = config.model;
    this.voiceId = config.voiceId;
    this.speed = config.speed ?? null;
    this.vol = config.vol ?? null;
    this.pitch = config.pitch ?? null;
    this.languageBoost = normalizeText(config.languageBoost);
    this.audioFormat = config.audioFormat || 'mp3';
    this.sampleRate = config.sampleRate ?? null;
    this.bitrate = config.bitrate ?? null;
    this.channel = config.channel ?? null;
    this.emotion = config.emotion ?? null;
  }

  async synthesize(params: SpeechSynthesisRequest): Promise<SpeechSynthesisResponse> {
    const text = normalizeText(params.text);
    if (!text) {
      return this.createSynthesisError('TTS input text is empty');
    }

    if (!this.voiceId) {
      return this.createSynthesisError('MiniMax TTS voice_id is empty');
    }

    try {
      const response = await fetch(this.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        signal: params.signal,
        body: JSON.stringify({
          model: this.model,
          text,
          stream: false,
          output_format: 'hex',
          ...(this.languageBoost ? { language_boost: this.languageBoost } : {}),
          voice_setting: {
            voice_id: this.voiceId,
            ...(params.speed || this.speed ? { speed: params.speed || this.speed } : {}),
            ...(this.vol ? { vol: this.vol } : {}),
            ...(this.pitch !== null ? { pitch: this.pitch } : {}),
            ...((params.emotion ?? this.emotion) && (params.emotion ?? this.emotion) !== 'auto' ? { emotion: params.emotion ?? this.emotion } : {}),
          },
          audio_setting: {
            format: this.audioFormat,
            ...(this.sampleRate ? { sample_rate: this.sampleRate } : {}),
            ...(this.bitrate ? { bitrate: this.bitrate } : {}),
            ...(this.channel ? { channel: this.channel } : {}),
          },
        }),
      });

      if (!response.ok) throw await readSpeechHttpError(response, 'MiniMax TTS', this.apiKey);
      const data = await response.json() as MiniMaxT2AResponse;

      const statusCode = data.base_resp?.status_code ?? 0;
      if (statusCode !== 0) {
        throw new Error(`MiniMax TTS code=${statusCode}: ${data.base_resp?.status_msg || '服务商未提供错误描述'}`);
      }

      const audioHex = normalizeText(data.data?.audio);
      if (!audioHex) {
        throw new Error('Invalid MiniMax TTS response: missing audio payload');
      }

      const responseFormat = normalizeAudioFormat(data.extra_info?.audio_format) || this.audioFormat;
      return {
        success: true,
        audioBase64: hexToBase64(audioHex),
        mimeType: MIME_BY_FORMAT[responseFormat],
        error: null,
        model: this.model,
      };
    } catch (error) {
      return this.createSynthesisError(error instanceof Error ? error.message : 'MiniMax TTS request failed');
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

export function createMiniMaxSpeechClient(config: MiniMaxSpeechClientConfig): MiniMaxSpeechClient {
  return new MiniMaxSpeechClient(config);
}

function resolveMiniMaxT2AEndpoint(baseURL: string): string {
  const normalized = normalizeText(baseURL).replace(/\/+$/, '');
  if (normalized.endsWith('/t2a_v2')) {
    return normalized;
  }
  return `${normalizeAIBaseURL(normalized)}/t2a_v2`;
}

function normalizeText(value: string | null | undefined): string {
  return String(value || '').trim();
}

function normalizeAudioFormat(value: string | null | undefined): MiniMaxT2AAudioFormat | null {
  const normalized = normalizeText(value);
  return Object.prototype.hasOwnProperty.call(MIME_BY_FORMAT, normalized)
    ? normalized as MiniMaxT2AAudioFormat
    : null;
}

function hexToBase64(hex: string): string {
  const compactHex = hex.replace(/\s/g, '');
  if (!compactHex || compactHex.length % 2 !== 0 || /[^0-9a-f]/i.test(compactHex)) {
    throw new Error('Invalid MiniMax TTS response: audio is not valid hex');
  }

  const byteCount = compactHex.length / 2;
  const bytes = new Uint8Array(byteCount);
  for (let index = 0; index < byteCount; index += 1) {
    bytes[index] = parseInt(compactHex.slice(index * 2, index * 2 + 2), 16);
  }

  const maybeBuffer = (globalThis as any).Buffer;
  if (maybeBuffer?.from) {
    return maybeBuffer.from(bytes).toString('base64');
  }

  let binary = '';
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary);
}
