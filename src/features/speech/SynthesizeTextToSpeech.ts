/** 将文本合成为可播放的语音文件。 */
import { resolveTextToSpeechModel, type ResolvedSpeechModel, type SpeechModelConsumer } from './application/ResolveSpeechModel';
import { synthesizeConfiguredSpeech } from './SynthesizeConfiguredSpeech';
import type { SpeechDelivery } from './domain/SpeechProvider';
import type { ErrorDisplayInfo } from '@platform/ai';

export interface SynthesizeTextToSpeechParams {
  text: string;
  assistantId?: string | null;
  consumer?: SpeechModelConsumer;
  speed?: number | null;
  signal?: AbortSignal;
  delivery?: SpeechDelivery;
  modelSnapshot?: ResolvedSpeechModel | null;
}

export interface SynthesizeTextToSpeechResult {
  success: boolean;
  audioUri: string | null;
  mimeType: string | null;
  modelConfigId: string | null;
  modelConfigName: string | null;
  model: string | null;
  rawError: string | null;
  errorInfo: ErrorDisplayInfo | null;
}

export async function synthesizeTextToSpeech(
  params: SynthesizeTextToSpeechParams
): Promise<SynthesizeTextToSpeechResult> {
  const text = String(params.text || '').trim();
  if (!text) {
    return buildSynthesisFailure('TTS 文本为空', null, null);
  }

  const speechModel = params.modelSnapshot !== undefined ? params.modelSnapshot : await resolveTextToSpeechModel({
    assistantId: params.assistantId,
    consumer: params.consumer || 'generic',
  });
  if (!speechModel) {
    return buildSynthesisFailure('未配置可用的 TTS 模型', null, null);
  }

  try {
    const audio = await synthesizeConfiguredSpeech({ configuration: speechModel, text, delivery: params.delivery ?? (params.speed == null ? {} : { speed: params.speed }), signal: params.signal });

    return {
      success: true,
      audioUri: audio.audioUri,
      mimeType: audio.mimeType,
      modelConfigId: speechModel.modelConfigId,
      modelConfigName: speechModel.modelConfigName,
      model: speechModel.model,
      rawError: null,
      errorInfo: null,
    };
  } catch (error) {
    const rawError = error instanceof Error ? error.message : 'TTS 合成失败';
    return buildSynthesisFailure(rawError, speechModel.modelConfigId, speechModel.modelConfigName);
  }
}

function buildSynthesisFailure(
  rawError: string,
  modelConfigId: string | null,
  modelConfigName: string | null
): SynthesizeTextToSpeechResult {
  return {
    success: false,
    audioUri: null,
    mimeType: null,
    modelConfigId,
    modelConfigName,
    model: null,
    rawError,
    errorInfo: { title: '语音合成失败', message: rawError, type: 'speech_synthesis' },
  };
}
