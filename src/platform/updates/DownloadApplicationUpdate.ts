import * as FileSystem from 'expo-file-system/legacy';
import AppUpdates from '../../../modules/app-updates';
import type { ApplicationRelease } from './GitHubReleases';

export async function downloadApplicationUpdate(release: ApplicationRelease, onProgress: (progress: number) => void): Promise<string> {
  const directory = `${FileSystem.cacheDirectory}app-updates/`;
  await FileSystem.makeDirectoryAsync(directory, { intermediates: true });
  const uri = `${directory}RavenCat-update.apk`;
  await FileSystem.deleteAsync(uri, { idempotent: true });
  const download = FileSystem.createDownloadResumable(release.apk.url, uri, {}, (event) => {
    onProgress(Math.min(1, event.totalBytesWritten / release.apk.size));
  });
  try {
    const result = await download.downloadAsync();
    if (!result || result.status !== 200) throw new Error('安装包下载未完成，请重试');
    await AppUpdates.verifyDownloadedUpdate(result.uri, release.apk.sha256, release.apk.size, release.version);
    return result.uri;
  } catch (error) {
    await FileSystem.deleteAsync(uri, { idempotent: true });
    throw error;
  }
}

/** 仅接收下载流程交付的已验证文件，不重复下载或重新解释安装包。 */
export function openApplicationUpdateInstaller(verifiedUri: string) {
  return AppUpdates.openUpdateInstaller(verifiedUri);
}

export function isApplicationUpdateInstallAllowed(): boolean {
  return AppUpdates.isUpdateInstallAllowed();
}

export function openApplicationUpdateInstallSettings(): Promise<void> {
  return AppUpdates.openUpdateInstallSettings();
}
