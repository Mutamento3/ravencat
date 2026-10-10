import * as FileSystem from 'expo-file-system/legacy';

export interface TemporarySpeechAudioInfo {
  uri: string;
  mimeType: string;
}

const EXTENSION_BY_MIME: Record<string, string> = {
  'audio/mpeg': 'mp3',
  'audio/ogg': 'opus',
  'audio/aac': 'aac',
  'audio/flac': 'flac',
  'audio/wav': 'wav',
  'audio/pcm': 'pcm',
  'audio/m4a': 'm4a',
};

function getCacheDirectory(): string {
  if (!FileSystem.cacheDirectory) {
    throw new Error('FileSystem.cacheDirectory 不可用，无法写入临时语音文件');
  }

  return `${FileSystem.cacheDirectory}speech/`;
}

function resolveExtension(mimeType: string): string {
  return EXTENSION_BY_MIME[mimeType] || 'mp3';
}

export class TemporarySpeechAudioStore {
  async ensureDirectory(): Promise<string> {
    const directory = getCacheDirectory();
    const info = await FileSystem.getInfoAsync(directory);
    if (!info.exists) {
      await FileSystem.makeDirectoryAsync(directory, { intermediates: true });
    }
    return directory;
  }

  async writeBase64Audio(params: {
    base64: string;
    mimeType: string;
    prefix?: string;
  }): Promise<TemporarySpeechAudioInfo> {
    const base64 = String(params.base64 || '').trim();
    if (!base64) {
      throw new Error('临时语音内容为空');
    }

    const directory = await this.ensureDirectory();
    const mimeType = params.mimeType || 'audio/mpeg';
    const extension = resolveExtension(mimeType);
    const prefix = String(params.prefix || 'tts').replace(/[^a-zA-Z0-9._-]/g, '_');
    const uri = `${directory}${prefix}_${Date.now()}.${extension}`;

    await FileSystem.writeAsStringAsync(uri, base64, {
      encoding: FileSystem.EncodingType.Base64,
    });

    return { uri, mimeType };
  }

  async deleteIfExists(uri?: string | null): Promise<boolean> {
    const targetUri = String(uri || '').trim();
    if (!targetUri || !targetUri.startsWith('file://')) {
      return false;
    }

    const info = await FileSystem.getInfoAsync(targetUri);
    if (!info.exists) {
      return false;
    }

    await FileSystem.deleteAsync(targetUri, { idempotent: true });
    return true;
  }

  /** 恢复出厂只清 RavenCat 自己的 speech cache，不触碰其他应用或外部 URI。 */
  async clearForFactoryReset(): Promise<void> {
    if (!FileSystem.cacheDirectory) {
      return;
    }
    const directory = `${FileSystem.cacheDirectory}speech/`;
    const info = await FileSystem.getInfoAsync(directory);
    if (info.exists) {
      await FileSystem.deleteAsync(directory, { idempotent: true });
    }
  }
}

export const temporarySpeechAudioStore = new TemporarySpeechAudioStore();

export function clearTemporarySpeechAudioForFactoryReset(): Promise<void> {
  return temporarySpeechAudioStore.clearForFactoryReset();
}
