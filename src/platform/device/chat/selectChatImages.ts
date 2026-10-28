import * as ImagePicker from 'expo-image-picker';
import { File } from 'expo-file-system';

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

export async function selectChatImages(selectionLimit: number): Promise<SelectedChatImage[] | null> {
  // quality: 1 且不编辑让 Expo 直接复制原始字节；大小以实际缓存文件为准。
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    allowsEditing: false,
    allowsMultipleSelection: true,
    selectionLimit,
    quality: 1,
  });

  if (result.canceled) return null;

  return result.assets.map((asset) => {
    const file = new File(asset.uri);
    const fileSize = file.size;
    if (fileSize > MAX_CHAT_IMAGE_SIZE) {
      throw new Error('图片不能超过 5MB');
    }

    return {
      uri: asset.uri,
      fileName: asset.fileName ?? file.name,
      mimeType: asset.mimeType,
      fileSize,
      width: asset.width,
      height: asset.height,
      source: 'gallery',
    };
  });
}
