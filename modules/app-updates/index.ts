import { NativeModule, requireNativeModule } from 'expo-modules-core';

declare class AppUpdatesNativeModule extends NativeModule {
  isUpdateInstallAllowed(): boolean;
  openUpdateInstallSettings(): Promise<void>;
  verifyDownloadedUpdate(uri: string, sha256: string, size: number, version: string): Promise<void>;
  openUpdateInstaller(verifiedUri: string): Promise<'opened' | 'permission_required'>;
}

export default requireNativeModule<AppUpdatesNativeModule>('RavenCatAppUpdates');
