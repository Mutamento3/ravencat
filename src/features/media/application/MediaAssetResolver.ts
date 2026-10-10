import type { MediaAsset } from '../domain/MediaAsset';
import {
  MediaAssetBackingNotFoundError,
  type MediaAssetBackingRegistry,
} from './MediaAssetBacking';
import type { MediaAssetCatalog } from './MediaAssetCatalog';

export interface ResolvedMediaAsset {
  asset: MediaAsset;
  localUri: string;
}

export class MediaAssetNotFoundError extends Error {
  constructor(assetId: string) {
    super(`找不到 MediaAsset：${assetId}`);
    this.name = 'MediaAssetNotFoundError';
  }
}

export class MediaAssetMissingError extends Error {
  constructor(assetId: string, options?: ErrorOptions) {
    super(`MediaAsset backing 内容缺失：${assetId}`, options);
    this.name = 'MediaAssetMissingError';
  }
}

/** 只按 catalog 中的稳定 locator 解析；不存在 legacy URI fallback。 */
export class MediaAssetResolver {
  constructor(
    private readonly catalog: MediaAssetCatalog,
    private readonly backings: MediaAssetBackingRegistry,
  ) {}

  async resolve(assetId: string): Promise<ResolvedMediaAsset> {
    const asset = await this.catalog.getById(assetId);
    if (!asset) {
      throw new MediaAssetNotFoundError(assetId);
    }
    if (asset.status === 'missing') {
      throw new MediaAssetMissingError(assetId);
    }

    try {
      const resolved = await this.backings
        .requireResolver(asset.storageBackend)
        .resolve(asset.storageKey);
      return { asset, localUri: resolved.localUri };
    } catch (error) {
      if (error instanceof MediaAssetBackingNotFoundError) {
        throw new MediaAssetMissingError(assetId, { cause: error });
      }
      throw error;
    }
  }
}
