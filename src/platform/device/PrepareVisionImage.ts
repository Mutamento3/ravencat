import { File } from 'expo-file-system';
import { ImageFileReadError, inspectLocalImage, readLocalImageAsBase64 } from './InspectLocalImage';

/** 所有聊天视觉读取都经过同一文件边界，真实格式与尺寸确认后才生成模型输入。 */
export async function readVisionImageAsBase64(uri: string): Promise<{ base64: string; mimeType: string }> {
  const image = await inspectLocalImage(uri);
  const prepared = await prepareVisionImage(uri, image.mimeType, image.isAnimated);
  try {
    return { base64: await readLocalImageAsBase64(prepared.uri), mimeType: prepared.mimeType };
  } finally {
    prepared.dispose();
  }
}

/** GIF / WebP 统一提供 PNG 单帧，让实际模型输入与「只看单帧」契约一致。 */
export async function prepareVisionImage(uri: string, mimeType: string, isAnimated = false) {
  if (!isAnimated && mimeType !== 'image/webp' && mimeType !== 'image/gif') {
    return { uri, mimeType, dispose: () => {} };
  }
  try {
    const { ImageManipulator, SaveFormat } = await import('expo-image-manipulator');
    const image = await ImageManipulator.manipulate(uri).renderAsync();
    const png = await image.saveAsync({ format: SaveFormat.PNG });
    return { uri: png.uri, mimeType: 'image/png', dispose: () => {
      try { new File(png.uri).delete(); }
      catch (error) { console.warn('[VisionImage] 临时帧清理失败：', error); }
    } };
  } catch (error) {
    throw new ImageFileReadError('无法读取图片的静态帧，请重新发送或下载', { cause: error });
  }
}
