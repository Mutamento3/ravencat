import * as DocumentPicker from 'expo-document-picker';

const MAX_CHAT_FILE_SIZE = 15 * 1024 * 1024;

export interface SelectedChatDocument {
  uri: string;
  fileName: string;
  mimeType?: string | null;
  fileSize?: number | null;
  source: 'document';
}

export async function selectChatDocument(): Promise<SelectedChatDocument | null> {
  const result = await DocumentPicker.getDocumentAsync({
    multiple: false,
    copyToCacheDirectory: true,
    type: '*/*',
  });

  if (result.canceled || !result.assets?.length) {
    return null;
  }

  const asset = result.assets[0];
  if (asset.size && asset.size > MAX_CHAT_FILE_SIZE) {
    throw new Error('文件不能超过 15MB');
  }

  return {
    uri: asset.uri,
    fileName: asset.name || `document_${Date.now()}`,
    mimeType: asset.mimeType || null,
    fileSize: asset.size ?? null,
    source: 'document',
  };
}