export {
  addRealtimeSpeechAudioChunkListener,
  addRealtimeSpeechAudioErrorListener,
  addRealtimeSpeechDetectedListener,
  isRealtimeSpeechAudioSourceRecording,
  startRealtimeSpeechAudioSource,
  stopRealtimeSpeechAudioSource,
  exportRealtimeSpeechSegment,
} from './src/RealtimeSpeechAudioSourceModule';

export type {
  RealtimeSpeechAudioChunkEvent,
  RealtimeSpeechAudioErrorEvent,
  RealtimeSpeechAudioSourceStartResult,
  RealtimeSpeechAudioSourceSubscription,
  RealtimeSpeechDetectedEvent,
} from './src/RealtimeSpeechAudioSourceModule';
