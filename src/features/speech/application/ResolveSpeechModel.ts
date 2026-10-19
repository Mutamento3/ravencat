/** 解析明确选择的语音模型，consumer 只描述调用场景。 */
interface SpeechModelConfig {
  capabilityKind: string;
  modelConfigId: string;
  modelConfigName: string;
  baseURL: string;
  apiKey: string;
  model: string;
  temperature: number | null;
  topP: number | null;
  maxTokens: number | null;
  metadataJson: string | null;
}

type SpeechModelResolver = (params: {
  capabilityKind: SpeechCapabilityKind;
  assistantId?: string | null;
}) => Promise<SpeechModelConfig | null>;

let speechModelResolver: SpeechModelResolver | null = null;

export function configureSpeechModelResolver(resolver: SpeechModelResolver): void {
  speechModelResolver = resolver;
}

export type SpeechCapabilityKind = 'stt' | 'tts';

export type SpeechModelConsumer =
  | 'call'
  | 'chatVoiceMessage'
  | 'generic';

export interface ResolveSpeechModelParams {
  capabilityKind: SpeechCapabilityKind;
  assistantId?: string | null;
  consumer?: SpeechModelConsumer;
}

export interface ResolvedSpeechModel extends SpeechModelConfig {
  capabilityKind: SpeechCapabilityKind;
  consumer: SpeechModelConsumer;
}

export async function resolveSpeechModel(
  params: ResolveSpeechModelParams
): Promise<ResolvedSpeechModel | null> {
  if (!speechModelResolver) {
    throw new Error('语音模型解析器尚未配置');
  }

  const model = await speechModelResolver({
    capabilityKind: params.capabilityKind,
    assistantId: params.assistantId,
  });

  if (!model) {
    return null;
  }

  return {
    ...model,
    capabilityKind: params.capabilityKind,
    consumer: params.consumer || 'generic',
  };
}

export function resolveSpeechToTextModel(
  params: Omit<ResolveSpeechModelParams, 'capabilityKind'>
): Promise<ResolvedSpeechModel | null> {
  return resolveSpeechModel({
    ...params,
    capabilityKind: 'stt',
  });
}

export function resolveTextToSpeechModel(
  params: Omit<ResolveSpeechModelParams, 'capabilityKind'>
): Promise<ResolvedSpeechModel | null> {
  return resolveSpeechModel({
    ...params,
    capabilityKind: 'tts',
  });
}
