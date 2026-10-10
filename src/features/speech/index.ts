/** 语音识别与语音合成功能公共出口。 */
export * from './application';
export * from './SynthesizeTextToSpeech';
export * from './StartRealtimeSpeechToText';
export * from './VoiceMessageTranscription';
export { synthesizeConfiguredSpeech } from './SynthesizeConfiguredSpeech';
export { SPEECH_PROVIDERS, getSpeechProvider, getSpeechParameters, readSpeechMetadata, speechEndpoint, validateSpeechConfiguration } from './application/SpeechProviderCatalog';
export type { SpeechProviderId, SpeechKind, SpeechMetadata, SpeechConnectionConfig, SpeechDelivery, SpeechParameter } from './domain/SpeechProvider';
export { SpeechConfigurationTest } from './presentation/SpeechConfigurationTest';
export { listSpeechProviderOptions } from './infrastructure/SpeechProviderOptions';
export type { SpeechProviderOption, SpeechProviderOptions } from './infrastructure/SpeechProviderOptions';

export { getSpeechRecognitionModelSettings, selectSpeechRecognitionModel, subscribeSpeechRecognitionModelsChanged } from './application/SpeechRecognitionModels';
export { getSpeechTextGuidance, prepareSpeechText, hasSpeechPause } from './application/SpeechText';
export { SpeechRecognitionModelPicker } from './presentation/SpeechRecognitionModelPicker';
