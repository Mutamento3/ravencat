import { resolveBubbleSkinAsset } from '../../../../modules/ravencat-floating-layer';

import {
  MEDIA_ASSET_STORAGE_BACKEND,
  MediaAssetBackingNotFoundError,
  type MediaAssetBackingResolver,
  type ResolvedMediaAssetBacking,
} from '../application/MediaAssetBacking';

/** Bubble Skin 本阶段只提供 resolver；prepare 与业务 projection 切换属于 M4e。 */
export class NativeBubbleSkinAssetBacking implements MediaAssetBackingResolver {
  readonly storageBackend = MEDIA_ASSET_STORAGE_BACKEND.nativeBubbleSkin;

  async resolve(storageKey: string): Promise<ResolvedMediaAssetBacking> {
    const localUri = await resolveBubbleSkinAsset(storageKey);
    if (!localUri) {
      throw new MediaAssetBackingNotFoundError(this.storageBackend, storageKey);
    }
    return { localUri };
  }
}
