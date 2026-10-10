import { temporarySpeechAudioStore } from '@platform/device';
import type { SpeechConnectionConfig, SpeechDelivery } from './domain/SpeechProvider';
import { readSpeechMetadata } from './application/SpeechProviderCatalog';
import { synthesizeSpeechAudio } from './infrastructure/SpeechSynthesisGateway';

/** 输入来自已校验资产或表单快照；只生成临时音频，不拥有消息提交或播放。 */
export async function synthesizeConfiguredSpeech(params: {
  configuration: SpeechConnectionConfig;
  text: string;
  delivery?: SpeechDelivery;
  signal?: AbortSignal;
}): Promise<{ audioUri: string; mimeType: string }> {
  const response = await synthesizeSpeechAudio(params.configuration, readSpeechMetadata(params.configuration.metadataJson), params.text, params.delivery ?? {}, params.signal);
  if (!response.success) throw new Error(response.error!);
  const audio = await temporarySpeechAudioStore.writeBase64Audio({ base64: response.audioBase64, mimeType: response.mimeType, prefix: 'tts' });
  // 取消之后才完成的网络响应仍由生成方清理，不转交已退出的 consumer。
  if (params.signal?.aborted) {
    await temporarySpeechAudioStore.deleteIfExists(audio.uri);
    throw new Error('语音合成已取消');
  }
  return { audioUri: audio.uri, mimeType: audio.mimeType };
}
