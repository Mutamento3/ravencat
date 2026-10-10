/** 原生裁剪只负责选图与取景；持久化和业务绑定仍由调用方拥有。 */
import { Dimensions } from 'react-native';
import * as ImagePicker from 'expo-image-picker';

interface PickCroppedImageOptions {
  aspect: 'screen' | [number, number];
  quality?: number;
}

/** 调用方先申请相册权限；取消选图或裁剪均返回 null，不产生业务写入。 */
export async function pickCroppedImage({ aspect, quality = 0.9 }: PickCroppedImageOptions): Promise<ImagePicker.ImagePickerAsset | null> {
  const screen = Dimensions.get('screen');
  // Android 的裁剪比例要求整数；屏幕尺寸按物理像素取整，避免 dp 小数丢失比例。
  const cropAspect: [number, number] = aspect === 'screen'
    ? [Math.round(screen.width * screen.scale), Math.round(screen.height * screen.scale)]
    : aspect;
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    allowsEditing: true,
    aspect: cropAspect,
    quality,
  });
  if (result.canceled) return null;
  const asset = result.assets[0];
  if (!asset?.uri) throw new Error('未获取到有效图片');
  return asset;
}
