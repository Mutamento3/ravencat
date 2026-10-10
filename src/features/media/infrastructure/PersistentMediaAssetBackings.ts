import type { PersistentImageStore, PersistentMediaStore } from '@platform/device';

import {
  MEDIA_ASSET_STORAGE_BACKEND,
  MediaAssetBackingNotFoundError,
  type MediaAssetBackingWriter,
  type PrepareMediaAssetBackingInput,
  type PreparedMediaAssetBacking,
  type ResolvedMediaAssetBacking,
} from '../application/MediaAssetBacking';

export class PersistentMediaAssetBacking implements MediaAssetBackingWriter {
  readonly storageBackend = MEDIA_ASSET_STORAGE_BACKEND.persistentMedia;
  private readonly inFlightStorageKeys = new Set<string>();

  constructor(private readonly store: PersistentMediaStore) {}

  async prepare(input: PrepareMediaAssetBackingInput): Promise<PreparedMediaAssetBacking> {
    // 顺序本身就是不变量：canonical key 必须在 copy 之前 reserve。反过来会有一段
    // 「文件已经可见、catalog 行还没有」的窗口，audit 会把 live backing 判成 orphan。
    const storageKey = this.store.buildAssetStorageKey(input);
    this.inFlightStorageKeys.add(storageKey);
    try {
      const localUri = await this.store.copyAssetToStorageKey({
        sourceUri: input.sourceUri,
        storageKey,
      });
      return { storageBackend: this.storageBackend, storageKey, localUri };
    } catch (error) {
      // 复制失败时文件由 store 自己补偿删除；reservation 必须同步解除，否则残留文件
      // 永远不会被下一次 audit 看见。
      this.inFlightStorageKeys.delete(storageKey);
      throw error;
    }
  }

  commitPrepared(storageKey: string): void {
    this.inFlightStorageKeys.delete(storageKey);
  }

  async resolve(storageKey: string): Promise<ResolvedMediaAssetBacking> {
    const localUri = await this.store.resolveAssetStorageKey(storageKey);
    if (!localUri) {
      throw new MediaAssetBackingNotFoundError(this.storageBackend, storageKey);
    }
    return { localUri };
  }

  async delete(storageKey: string): Promise<void> {
    try {
      await this.store.deleteAssetStorageKey(storageKey);
    } finally {
      this.inFlightStorageKeys.delete(storageKey);
    }
  }

  ownsStorageKeyLifecycle(storageKey: string): boolean {
    return storageKey.startsWith('catalog/media/');
  }

  isStorageKeyInFlight(storageKey: string): boolean {
    return this.inFlightStorageKeys.has(storageKey);
  }

  async listCanonicalStorageKeys(): Promise<readonly string[]> {
    const keys = await this.store.listCanonicalAssetStorageKeys();
    return keys.filter((key) => !this.inFlightStorageKeys.has(key));
  }
}

export class PersistentImageAssetBacking implements MediaAssetBackingWriter {
  readonly storageBackend = MEDIA_ASSET_STORAGE_BACKEND.persistentImage;
  private readonly inFlightStorageKeys = new Set<string>();

  constructor(private readonly store: PersistentImageStore) {}

  async prepare(input: PrepareMediaAssetBackingInput): Promise<PreparedMediaAssetBacking> {
    // 与 persistent-media 同一不变量：先 reserve canonical key，再落文件。
    const storageKey = this.store.buildAssetStorageKey(input);
    this.inFlightStorageKeys.add(storageKey);
    try {
      const localUri = await this.store.copyAssetToStorageKey({
        sourceUri: input.sourceUri,
        storageKey,
      });
      return { storageBackend: this.storageBackend, storageKey, localUri };
    } catch (error) {
      this.inFlightStorageKeys.delete(storageKey);
      throw error;
    }
  }

  commitPrepared(storageKey: string): void {
    this.inFlightStorageKeys.delete(storageKey);
  }

  async resolve(storageKey: string): Promise<ResolvedMediaAssetBacking> {
    const localUri = await this.store.resolveAssetStorageKey(storageKey);
    if (!localUri) {
      throw new MediaAssetBackingNotFoundError(this.storageBackend, storageKey);
    }
    return { localUri };
  }

  async delete(storageKey: string): Promise<void> {
    try {
      await this.store.deleteAssetStorageKey(storageKey);
    } finally {
      this.inFlightStorageKeys.delete(storageKey);
    }
  }

  ownsStorageKeyLifecycle(storageKey: string): boolean {
    return storageKey.startsWith('catalog/images/');
  }

  isStorageKeyInFlight(storageKey: string): boolean {
    return this.inFlightStorageKeys.has(storageKey);
  }

  async listCanonicalStorageKeys(): Promise<readonly string[]> {
    const keys = await this.store.listCanonicalAssetStorageKeys();
    return keys.filter((key) => !this.inFlightStorageKeys.has(key));
  }
}
