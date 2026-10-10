import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system/legacy';

const MAX_CHAT_IMAGE_SIZE = 5 * 1024 * 1024;

export interface SelectedChatImage {
  uri: string;
  fileName: string;
  mimeType?: string | null;
  fileSize?: number | null;
  width?: number | null;
  height?: number | null;
  source: 'gallery';
}

function inferFileName(uri: string): string {
  const cleanUri = String(uri || '').split('?')[0].split('#')[0];
  const rawName = cleanUri.split('/').pop();
  return rawName || `image_${Date.now()}.jpg`;
}

async function resolveAssetSize(uri: string, providedSize?: number | null): Promise<number | null> {
  if (providedSize && Number.isFinite(providedSize)) {
    return providedSize;
  }

  try {
    const info = await FileSystem.getInfoAsync(uri);
    return info.exists ? info.size ?? null : null;
  } catch (error) {
    console.warn('[selectChatImage] Failed to resolve asset size:', error);
    return null;
  }
}

export async function selectChatImage(): Promise<SelectedChatImage | null> {
  const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) {
    throw new Error('未获得相册权限，无法选择图片');
  }

  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    allowsEditing: false,
    quality: 1,
  });

  if (result.canceled || !result.assets?.length) {
    return null;
  }

  const asset = result.assets[0];
  const fileSize = await resolveAssetSize(asset.uri, asset.fileSize ?? null);
  if (fileSize && fileSize > MAX_CHAT_IMAGE_SIZE) {
    throw new Error('图片不能超过 5MB');
  }

  return {
    uri: asset.uri,
    fileName: asset.fileName || inferFileName(asset.uri),
    mimeType: asset.mimeType || 'image/jpeg',
    fileSize,
    width: asset.width ?? null,
    height: asset.height ?? null,
    source: 'gallery',
  };
}