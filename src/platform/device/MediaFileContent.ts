import { CryptoDigestAlgorithm, digest } from 'expo-crypto';
import { File } from 'expo-file-system';

export interface MediaFileContentMetadata {
  contentHash: string;
  byteSize: number;
}

function toLowercaseHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('');
}

/** 对 resolver 最终会读取的完整文件字节计算 SHA-256 与大小。 */
export async function inspectMediaFileContent(localUri: string): Promise<MediaFileContentMetadata> {
  const bytes = await new File(localUri).bytes();
  const contentHash = toLowercaseHex(await digest(CryptoDigestAlgorithm.SHA256, bytes));
  return {
    contentHash,
    byteSize: bytes.byteLength,
  };
}
