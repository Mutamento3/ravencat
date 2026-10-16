import { ImageFileReadError, inspectLocalImage } from './InspectLocalImage';
import { prepareVisionImage } from './PrepareVisionImage';

export interface CropImageToAspectParams {
  sourceUri: string;
  aspect: readonly [number, number];
}

export interface CroppedAspectImage {
  uri: string;
  width: number;
  height: number;
  mimeType: string;
  /** 输出恒为单帧静态图。 */
  isAnimated: false;
  sourceWasAnimated: boolean;
}

/** 源图内能放下的最大目标比例矩形：只缩小、不放大、不拉伸，默认居中。 */
function centerCropRect(width: number, height: number, aspectW: number, aspectH: number) {
  let cropWidth = width;
  let cropHeight = Math.floor((width * aspectH) / aspectW);
  if (cropHeight > height) {
    cropHeight = height;
    cropWidth = Math.floor((height * aspectW) / aspectH);
  }
  cropWidth = Math.max(1, Math.min(cropWidth, width));
  cropHeight = Math.max(1, Math.min(cropHeight, height));
  return {
    originX: Math.floor((width - cropWidth) / 2),
    originY: Math.floor((height - cropHeight) / 2),
    width: cropWidth,
    height: cropHeight,
  };
}

/**
 * 无交互自动裁剪：不弹相册或裁剪页，不改动原图。
 * 成功的临时文件归调用方使用并清理；动态图的静态帧是本函数的中间产物，无论成败都由本函数清理。
 */
export async function cropImageToAspect({ sourceUri, aspect }: CropImageToAspectParams): Promise<CroppedAspectImage> {
  const [aspectW, aspectH] = aspect;
  if (!Number.isFinite(aspectW) || !Number.isFinite(aspectH) || aspectW <= 0 || aspectH <= 0) {
    throw new Error('裁剪目标比例必须为正数');
  }
  const source = await inspectLocalImage(sourceUri);
  const prepared = source.isAnimated
    ? await prepareVisionImage(sourceUri, source.mimeType, true)
    : { uri: sourceUri, mimeType: source.mimeType, dispose: () => {} };
  try {
    const { ImageManipulator, SaveFormat } = await import('expo-image-manipulator');
    const crop = centerCropRect(source.width, source.height, aspectW, aspectH);
    const manipulator = ImageManipulator.manipulate(prepared.uri);
    if (crop.width < source.width || crop.height < source.height) manipulator.crop(crop);
    const rendered = await manipulator.renderAsync();
    // manipulator 无 GIF 编码；经过静态帧路径后 prepared 恒为 PNG，其余保持源格式。
    const format = prepared.mimeType === 'image/jpeg'
      ? SaveFormat.JPEG
      : prepared.mimeType === 'image/webp'
        ? SaveFormat.WEBP
        : SaveFormat.PNG;
    // 裁剪不再重压，保留最大质量。
    const saved = await rendered.saveAsync({ format, compress: 1 });
    return {
      uri: saved.uri,
      width: saved.width,
      height: saved.height,
      mimeType: format === SaveFormat.JPEG
        ? 'image/jpeg'
        : format === SaveFormat.WEBP
          ? 'image/webp'
          : 'image/png',
      isAnimated: false,
      sourceWasAnimated: source.isAnimated,
    };
  } catch (error) {
    if (error instanceof ImageFileReadError) throw error;
    throw new ImageFileReadError('图片裁剪失败，请重试', { cause: error });
  } finally {
    prepared.dispose();
  }
}
