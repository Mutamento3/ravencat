import * as FileSystem from 'expo-file-system/legacy';
import AppUpdates from '../../../modules/app-updates';
import type { ApplicationRelease } from './GitHubReleases';

export type ApplicationUpdateDownloadSource = 'github' | 'gitee';

export async function downloadApplicationUpdate(release: ApplicationRelease, source: ApplicationUpdateDownloadSource,
  onProgress: (progress: number) => void): Promise<string> {
  const directory = `${FileSystem.cacheDirectory}app-updates/`;
  await FileSystem.makeDirectoryAsync(directory, { intermediates: true });
  const apkUri = `${directory}RavenCat-update.apk`;
  const zipUri = `${directory}RavenCat-update.zip`;
  const compressed = source === 'gitee';
  const uri = compressed ? zipUri : apkUri;
  // Gitee 沿用发布约定的附件名；版本和 APK 校验信息仍由 GitHub 发布边界提供。
  const url = compressed
    ? `https://gitee.com/skylucky163/ravencat/releases/download/${encodeURIComponent(release.tag)}/${encodeURIComponent(`RavenCat-${release.version}-download.zip`)}`
    : release.apk.url;
  await FileSystem.deleteAsync(apkUri, { idempotent: true });
  await FileSystem.deleteAsync(zipUri, { idempotent: true });
  const download = FileSystem.createDownloadResumable(url, uri, {}, (event) => {
    if (event.totalBytesExpectedToWrite > 0) {
      onProgress(Math.min(1, event.totalBytesWritten / event.totalBytesExpectedToWrite));
    }
  });
  try {
    const result = await download.downloadAsync();
    if (!result || result.status !== 200) {
      throw new Error(compressed ? 'Gitee 下载未完成，附件可能尚未同步。请稍后重试或选择 GitHub 下载。' : '安装包下载未完成，请重试');
    }
    const verifiedUri = await AppUpdates.prepareDownloadedUpdate(result.uri, release.apk.sha256,
      release.apk.size, release.version, compressed);
    if (compressed) await FileSystem.deleteAsync(zipUri, { idempotent: true });
    return verifiedUri;
  } catch (error) {
    await FileSystem.deleteAsync(apkUri, { idempotent: true });
    await FileSystem.deleteAsync(zipUri, { idempotent: true });
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
