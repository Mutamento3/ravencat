/** MediaAsset 目录中一份持久媒体的可用状态。 */
export type MediaAssetStatus = 'ready' | 'missing';

/** 第一版内容摘要只接受最终持久化字节的 SHA-256。 */
export type MediaHashAlgorithm = 'sha256';

/**
 * 一份长期媒体在 RavenCat 内部的稳定身份。
 *
 * storageKey 是对应 storageBackend 内部的相对定位键，不得保存绝对路径、URI，
 * 也不得通过父级路径片段越出该 backend 的命名空间。
 * contentHash 和 byteSize 描述 backing 中最终持久化的完整字节。
 * missing 只表示已识别资产的 backing 内容缺失，不能用于伪造从未读成功的 legacy URI。
 */
export interface MediaAsset {
  id: string;
  storageBackend: string;
  storageKey: string;
  hashAlgorithm: MediaHashAlgorithm;
  contentHash: string;
  mimeType: string;
  byteSize: number;
  width: number | null;
  height: number | null;
  durationMs: number | null;
  status: MediaAssetStatus;
  createdAt: string;
  updatedAt: string;
}
