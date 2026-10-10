import {
  type DatabaseWriteExecutor,
  createDatabaseBackupSnapshot,
  deleteDatabaseBackupSnapshot,
} from '@platform/persistence';
import {
  getPersistentMediaRootUri,
  persistentMediaStore,
} from '@platform/device';
import {
  getPersistentImageInfoInRoot,
} from '@platform/device/DeviceMediaService';
import { MEDIA_ASSET_STORAGE_BACKEND, type MediaAsset } from '@features/media';
import {
  loadStoredThemeBackupState,
  parseStoredThemeBackupState,
  restoreStoredThemeBackupState,
} from '@shared/theme';
import type { BackupSourceGateway } from '../application/CreateLocalBackup';
import {
  getBubbleSkinBackupSource,
  restoreBubbleSkinBackupSettings,
  validateBubbleSkinBackupSettings,
} from '../../../../modules/ravencat-floating-layer';
import {
  STABLE_SETTINGS_BACKUP_SCHEMA_VERSION,
  parseStableSettingsBackupJson,
} from './stableSettingsBackupState';

export class ApplicationBackupSourceGateway implements BackupSourceGateway {
  constructor(private readonly dependencies: {
    readMediaInventory(uri: string): Promise<readonly MediaAsset[]>;
    prepareDatabaseSnapshot(executor: DatabaseWriteExecutor): Promise<void>;
    excludedMediaStoragePrefixes: readonly string[];
  }) {}

  createDatabaseSnapshot(): Promise<string> {
    return createDatabaseBackupSnapshot(this.dependencies.prepareDatabaseSnapshot);
  }

  private async validateDatabaseMedia(databaseUri: string, rootUri: string): Promise<void> {
    const assets = await this.dependencies.readMediaInventory(databaseUri);
    for (const asset of assets) {
      if (asset.storageBackend === MEDIA_ASSET_STORAGE_BACKEND.nativeBubbleSkin) continue;
      const info = asset.storageBackend === MEDIA_ASSET_STORAGE_BACKEND.persistentImage
        ? await getPersistentImageInfoInRoot(rootUri, asset.storageKey)
        : asset.storageBackend === MEDIA_ASSET_STORAGE_BACKEND.persistentMedia
          ? await persistentMediaStore.getInfoInRoot(rootUri, asset.storageKey)
          : null;
      if (info === null) throw new Error(`备份媒体 backend 不支持：${asset.storageBackend}`);
      if (!info.exists || info.isDirectory || info.size !== asset.byteSize) {
        throw new Error(`备份引用的媒体文件缺失或大小不符：${asset.id}`);
      }
    }
  }

  deleteDatabaseSnapshot(uri: string): Promise<void> {
    return deleteDatabaseBackupSnapshot(uri);
  }

  async readNonDatabaseSources(databaseSnapshotUri: string) {
    await this.validateDatabaseMedia(databaseSnapshotUri, getPersistentMediaRootUri());
    const stableSettings = await this.readStableSettingsSource();
    return {
      mediaRootUri: getPersistentMediaRootUri(),
      excludedMediaStoragePrefixes: this.dependencies.excludedMediaStoragePrefixes,
      bubbleSkinRootUri: stableSettings.bubbleSkinRootUri,
      stableSettingsJson: stableSettings.json,
    };
  }

  async exportStableSettingsJson(): Promise<string> {
    return (await this.readStableSettingsSource()).json;
  }

  async validateStableSettingsJson(
    json: string,
    bubbleSkinRootUri: string,
    mediaRootUri: string,
    databaseUri: string,
  ): Promise<void> {
    await this.validateDatabaseMedia(databaseUri, mediaRootUri);
    const settings = parseStableSettingsBackupJson(json);
    parseStoredThemeBackupState(settings.theme);

    await validateBubbleSkinBackupSettings(
      JSON.stringify(settings.bubbleSkins),
      bubbleSkinRootUri,
    );
  }

  async restoreStableSettingsJson(json: string): Promise<void> {
    const settings = parseStableSettingsBackupJson(json);

    await restoreBubbleSkinBackupSettings(JSON.stringify(settings.bubbleSkins));
    await restoreStoredThemeBackupState(settings.theme);
  }

  private async readStableSettingsSource(): Promise<{
    json: string;
    bubbleSkinRootUri: string;
  }> {
    const [theme, bubbleSkins] = await Promise.all([
      loadStoredThemeBackupState(),
      getBubbleSkinBackupSource(),
    ]);

    const json = JSON.stringify({
      schemaVersion: STABLE_SETTINGS_BACKUP_SCHEMA_VERSION,
      legacyMediaRootUri: getPersistentMediaRootUri(),
      theme,
      bubbleSkins: JSON.parse(bubbleSkins.settingsJson) as unknown,
    });

    // create 侧必须与 restore 侧满足同一份严格契约，避免产生"缩水后仍成功"的备份。
    parseStableSettingsBackupJson(json);

    return { bubbleSkinRootUri: bubbleSkins.rootUri, json };
  }
}
