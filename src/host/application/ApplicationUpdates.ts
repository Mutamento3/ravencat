import type { ApplicationRelease } from '@platform/updates/GitHubReleases';

interface Version {
  numbers: number[];
  prerelease: string[];
}

function parseVersion(value: string): Version | null {
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.exec(value);
  if (!match) return null;
  const numbers = match.slice(1, 4).map(Number);
  const prerelease = match[4] ? match[4].split('.') : [];
  if (!numbers.every(Number.isSafeInteger) || prerelease.some((part) => /^0\d+$/.test(part))) return null;
  return { numbers, prerelease };
}

function compareVersions(left: Version, right: Version): number {
  for (let index = 0; index < 3; index++) {
    if (left.numbers[index] !== right.numbers[index]) return left.numbers[index] - right.numbers[index];
  }
  if (!left.prerelease.length || !right.prerelease.length) {
    return Number(!left.prerelease.length) - Number(!right.prerelease.length);
  }
  for (let index = 0; index < Math.max(left.prerelease.length, right.prerelease.length); index++) {
    const a = left.prerelease[index];
    const b = right.prerelease[index];
    if (a === undefined || b === undefined) return Number(a !== undefined) - Number(b !== undefined);
    if (a === b) continue;
    const numericA = /^\d+$/.test(a);
    const numericB = /^\d+$/.test(b);
    if (numericA && numericB) return a.length - b.length || (a < b ? -1 : 1);
    if (numericA !== numericB) return numericA ? -1 : 1;
    return a < b ? -1 : 1;
  }
  return 0;
}

export interface ApplicationUpdateState {
  checking: boolean;
  available: ApplicationRelease | null;
  download: { release: ApplicationRelease; progress: number; uri: string | null } | null;
}

interface Dependencies {
  installedVersion: string;
  fetchReleases(): Promise<ApplicationRelease[]>;
  loadSkippedVersion(): Promise<string | null>;
  saveSkippedVersion(version: string): Promise<void>;
  downloadRelease(release: ApplicationRelease, onProgress: (progress: number) => void): Promise<string>;
}

/** 每个前台宿主实例持有一份状态；跳过只影响弹窗，不移除可下载更新。 */
export function createApplicationUpdates(dependencies: Dependencies) {
  const installed = parseVersion(dependencies.installedVersion);
  if (!installed) throw new Error('安装包版本必须使用语义版本号');
  let state: ApplicationUpdateState = { checking: false, available: null, download: null };
  let skippedVersion: string | null = null;
  let loaded = false;
  let inFlight: Promise<ApplicationRelease | null> | null = null;
  let downloading: Promise<string> | null = null;
  const listeners = new Set<() => void>();
  const update = (next: ApplicationUpdateState) => {
    state = next;
    listeners.forEach((listener) => listener());
  };

  const check = (): Promise<ApplicationRelease | null> => {
    if (inFlight) return inFlight;
    update({ ...state, checking: true });
    inFlight = (async () => {
      try {
        if (!loaded) {
          skippedVersion = await dependencies.loadSkippedVersion();
          loaded = true;
        }
        const releases = await dependencies.fetchReleases();
        let available: ApplicationRelease | null = null;
        let highest = installed;
        for (const release of releases) {
          const version = parseVersion(release.version);
          // 仓库可能包含非应用版本的标签；仅语义版本参与升级比较。
          if (version && compareVersions(version, highest) > 0) {
            available = release;
            highest = version;
          }
        }
        update({ ...state, checking: true, available });
        return available;
      } finally {
        inFlight = null;
        update({ ...state, checking: false });
      }
    })();
    return inFlight;
  };

  return {
    getSnapshot: () => state,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    check,
    download: (release: ApplicationRelease): Promise<string> => {
      if (downloading) return downloading;
      if (state.download?.release.version === release.version && state.download.uri) {
        return Promise.resolve(state.download.uri);
      }
      update({ ...state, download: { release, progress: 0, uri: null } });
      downloading = (async () => {
        try {
          const uri = await dependencies.downloadRelease(release, (progress) => {
            update({ ...state, download: { release, progress, uri: null } });
          });
          update({ ...state, download: { release, progress: 1, uri } });
          return uri;
        } catch (error) {
          update({ ...state, download: null });
          throw error;
        } finally {
          downloading = null;
        }
      })();
      return downloading;
    },
    shouldPrompt: (release: ApplicationRelease) => skippedVersion !== release.version,
    skip: async (release: ApplicationRelease) => {
      await dependencies.saveSkippedVersion(release.version);
      skippedVersion = release.version;
    },
  };
}
