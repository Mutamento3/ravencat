export {
  addRealtimeSpeechAudioChunkListener,
  addRealtimeSpeechAudioErrorListener,
  addRealtimeSpeechDetectedListener,
  isRealtimeSpeechAudioSourceRecording,
  startRealtimeSpeechAudioSource,
  stopRealtimeSpeechAudioSource,
} from './src/RealtimeSpeechAudioSourceModule';

export type {
  RealtimeSpeechAudioChunkEvent,
  RealtimeSpeechAudioErrorEvent,
  RealtimeSpeechAudioSourceStartResult,
  RealtimeSpeechAudioSourceSubscription,
  RealtimeSpeechDetectedEvent,
} from './src/RealtimeSpeechAudioSourceModule';
