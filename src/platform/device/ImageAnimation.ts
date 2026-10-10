import { File } from 'expo-file-system';

function hasAscii(bytes: Uint8Array, offset: number, value: string): boolean {
  if (offset < 0 || offset + value.length > bytes.length) return false;
  for (let index = 0; index < value.length; index += 1) {
    if (bytes[offset + index] !== value.charCodeAt(index)) return false;
  }
  return true;
}

function readUint32LE(bytes: Uint8Array, offset: number): number {
  return (
    bytes[offset]
    | (bytes[offset + 1] << 8)
    | (bytes[offset + 2] << 16)
    | (bytes[offset + 3] << 24)
  ) >>> 0;
}

function readUint32BE(bytes: Uint8Array, offset: number): number {
  return (
    (bytes[offset] << 24)
    | (bytes[offset + 1] << 16)
    | (bytes[offset + 2] << 8)
    | bytes[offset + 3]
  ) >>> 0;
}

function isAnimatedWebP(bytes: Uint8Array): boolean {
  if (
    bytes.length < 20
    || !hasAscii(bytes, 0, 'RIFF')
    || !hasAscii(bytes, 8, 'WEBP')
  ) {
    return false;
  }

  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const chunkSize = readUint32LE(bytes, offset + 4);
    const chunkDataOffset = offset + 8;
    if (hasAscii(bytes, offset, 'ANIM') || hasAscii(bytes, offset, 'ANMF')) {
      return true;
    }
    if (
      hasAscii(bytes, offset, 'VP8X')
      && chunkSize > 0
      && chunkDataOffset < bytes.length
      && (bytes[chunkDataOffset] & 0x02) !== 0
    ) {
      return true;
    }

    const nextOffset = chunkDataOffset + chunkSize + (chunkSize % 2);
    if (nextOffset <= offset || nextOffset > bytes.length) return false;
    offset = nextOffset;
  }
  return false;
}

function isAnimatedPng(bytes: Uint8Array): boolean {
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (bytes.length < signature.length) return false;
  if (signature.some((value, index) => bytes[index] !== value)) return false;

  let offset = 8;
  while (offset + 12 <= bytes.length) {
    const chunkSize = readUint32BE(bytes, offset);
    if (hasAscii(bytes, offset + 4, 'acTL')) return true;
    const nextOffset = offset + 12 + chunkSize;
    if (nextOffset <= offset || nextOffset > bytes.length) return false;
    offset = nextOffset;
  }
  return false;
}

/**
 * 从文件内容判断是否为当前产品支持的动画图片。
 * MIME/扩展名只能说明容器类型；尤其 WebP 同时允许静态和动画，必须读取容器标记。
 */
export function detectImageAnimation(bytes: Uint8Array): boolean {
  if (hasAscii(bytes, 0, 'GIF87a') || hasAscii(bytes, 0, 'GIF89a')) return true;
  if (hasAscii(bytes, 0, 'RIFF') && hasAscii(bytes, 8, 'WEBP')) {
    return isAnimatedWebP(bytes);
  }
  return isAnimatedPng(bytes);
}

/** 文件读取属于导入系统边界，必须在任何 SQLite transaction 之外调用。 */
export async function inspectImageAnimation(localUri: string): Promise<boolean> {
  return detectImageAnimation(await new File(localUri).bytes());
}
