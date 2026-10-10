import { readVoiceAudioMetadata } from '../../../modules/voice-message-audio';

export interface LocalAudioMetadata {
  durationMs: number;
}

export async function readLocalAudioMetadata(uri: string): Promise<LocalAudioMetadata> {
  return readVoiceAudioMetadata(uri);
}
