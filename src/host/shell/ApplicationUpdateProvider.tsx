import React, { createContext, useCallback, useContext, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getInstalledApplicationInfo } from '@platform/device/DeviceStatus';
import { fetchApplicationReleases, type ApplicationRelease } from '@platform/updates/GitHubReleases';
import { downloadApplicationUpdate, openApplicationUpdateInstaller } from '@platform/updates/DownloadApplicationUpdate';
import { showAppDialog } from '@shared/ui';
import { createApplicationUpdates, type ApplicationUpdateState } from '../application/ApplicationUpdates';

const SKIPPED_VERSION_KEY = 'ravencat:updates:skipped-version';
const Context = createContext<(ApplicationUpdateState & { checkManually(): void }) | null>(null);

export function useApplicationUpdates() {
  const value = useContext(Context);
  if (!value) throw new Error('更新入口必须位于应用更新宿主内');
  return value;
}

export function ApplicationUpdateProvider({ enabled, children }: { enabled: boolean; children: ReactNode }) {
  const [updates] = useState(() => createApplicationUpdates({
    installedVersion: getInstalledApplicationInfo().version,
    fetchReleases: fetchApplicationReleases,
    loadSkippedVersion: () => AsyncStorage.getItem(SKIPPED_VERSION_KEY),
    saveSkippedVersion: (version) => AsyncStorage.setItem(SKIPPED_VERSION_KEY, version),
    downloadRelease: downloadApplicationUpdate,
  }));
  const state = useSyncExternalStore(updates.subscribe, updates.getSnapshot);
  const [pendingAutomaticRelease, setPendingAutomaticRelease] = useState<ApplicationRelease | null>(null);
  const started = useRef(false);
  const dialogVersion = useRef<string | null>(null);
  const promptedInstallerUri = useRef<string | null>(null);
  const showFailure = useCallback((error: unknown, title = '检查更新失败') => showAppDialog({
    title,
    message: error instanceof Error ? error.message : '操作未完成，请稍后重试。',
    tone: 'error',
  }), []);
  const showInstaller = useCallback((uri: string) => showAppDialog({
    title: '更新已下载',
    message: '安装包已通过校验，可以打开系统安装页完成更新。',
    buttons: [
      { text: '稍后', style: 'cancel' },
      { text: '安装更新', onPress: () => {
        void openApplicationUpdateInstaller(uri).then((result) => {
          if (result === 'permission_required') showAppDialog({
            title: '允许安装更新',
            message: '请在系统设置中允许 RavenCat 安装未知应用，返回后点击“我 → 检查更新”继续安装。安装包已下载，无需重新下载。',
          });
        }).catch((error) => showFailure(error, '无法安装更新'));
      } },
    ],
  }), [showFailure]);
  const showRelease = useCallback((release: ApplicationRelease) => {
    if (dialogVersion.current === release.version) return;
    dialogVersion.current = release.version;
    showAppDialog({
      title: `发现新${release.prerelease ? '预览' : ''}版本 v${release.version}`,
      message: `${release.notes || '新版本已发布。'}\n\n安装包约 ${(release.apk.size / 1024 / 1024).toFixed(1)} MB，下载进度可在“我 → 检查更新”查看。`,
      dismissible: false,
      buttons: [
        { text: '跳过此版本', style: 'cancel', onPress: () => {
          dialogVersion.current = null;
          void updates.skip(release).catch((error) => showFailure(error, '无法保存跳过记录'));
        } },
        { text: '下载更新', onPress: () => {
          dialogVersion.current = null;
          void updates.download(release).catch((error) => showFailure(error, '下载更新失败'));
        } },
      ],
    });
  }, [updates, showFailure]);

  useEffect(() => {
    const uri = state.download?.uri;
    if (!enabled || !uri || promptedInstallerUri.current === uri) return;
    promptedInstallerUri.current = uri;
    showInstaller(uri);
  }, [enabled, state.download, showInstaller]);

  useEffect(() => {
    // 开发环境由 Metro 交付代码，公开 APK 不能覆盖独立的开发包。
    if (__DEV__ || !enabled || started.current) return;
    started.current = true;
    // 只在本次冷启动进入前台后检查，不阻塞数据库恢复、启动屏或路由。
    void updates.check().then(setPendingAutomaticRelease)
      .catch((error) => console.warn('[应用更新] 自动检查失败', error));
  }, [enabled, updates]);

  useEffect(() => {
    if (!enabled || !pendingAutomaticRelease) return;
    setPendingAutomaticRelease(null);
    if (updates.shouldPrompt(pendingAutomaticRelease)) showRelease(pendingAutomaticRelease);
  }, [enabled, pendingAutomaticRelease, updates, showRelease]);

  const checkManually = useCallback(() => {
    if (__DEV__) {
      showAppDialog({
        title: '开发版更新',
        message: '开发版通过开发服务器加载代码，不接收 GitHub 预览版 APK 更新。原生功能的改动需要重新安装开发包。',
      });
      return;
    }
    if (state.download?.uri) {
      showInstaller(state.download.uri);
      return;
    }
    void updates.check().then((release) => {
      if (release) showRelease(release);
      else showAppDialog({ title: '检查更新', message: '当前已是最新可下载版本。', tone: 'success' });
    }).catch(showFailure);
  }, [updates, showRelease, showFailure, showInstaller, state.download]);

  return <Context.Provider value={{ ...state, checkManually }}>{children}</Context.Provider>;
}
