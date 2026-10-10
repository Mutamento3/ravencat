/** 仅供 Host 装配模型资产与 Speech 自有选择。 */
export { configureSpeechModelResolver } from './application/ResolveSpeechModel';
export { configureSpeechRecognitionModels, getSpeechRecognitionModelId, notifySpeechRecognitionModelsChanged } from './application/SpeechRecognitionModels';
export { speechSettingsRepository } from './infrastructure/SQLiteSpeechSettingsRepository';
export { initializeSpeechRecognitionModelInTransaction } from './infrastructure/SQLiteSpeechSettingsRepository';
