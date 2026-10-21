import { NativeModule, requireNativeModule } from 'expo-modules-core';

declare class AppUpdatesNativeModule extends NativeModule {
  isUpdateInstallAllowed(): boolean;
  openUpdateInstallSettings(): Promise<void>;
  prepareDownloadedUpdate(uri: string, sha256: string, size: number, version: string, compressed: boolean): Promise<string>;
  openUpdateInstaller(verifiedUri: string): Promise<'opened' | 'permission_required'>;
}

export default requireNativeModule<AppUpdatesNativeModule>('RavenCatAppUpdates');
