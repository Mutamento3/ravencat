/** GitHub 公共发布信息的网络边界；应用内不携带 GitHub 凭据。 */
export interface ApplicationRelease {
  tag: string;
  version: string;
  prerelease: boolean;
  notes: string;
  apk: { url: string; size: number; sha256: string };
}

const REPOSITORY = 'skylucky163/ravencat';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export async function fetchApplicationReleases(): Promise<ApplicationRelease[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    // latest 不包含预览版；列表同时覆盖正式版与当前项目的 Pre-release。
    const response = await fetch(`https://api.github.com/repos/${REPOSITORY}/releases?per_page=100`, {
      headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`GitHub 更新检查失败（HTTP ${response.status}）`);
    const data: unknown = await response.json();
    if (!Array.isArray(data)) throw new Error('GitHub 发布信息格式不正确');
    const releases: ApplicationRelease[] = [];
    for (const item of data) {
      if (!isRecord(item) || typeof item.draft !== 'boolean' || typeof item.prerelease !== 'boolean'
        || typeof item.tag_name !== 'string' || !Array.isArray(item.assets)
        || (item.body !== null && typeof item.body !== 'string')) {
        throw new Error('GitHub 发布信息格式不正确');
      }
      const apk = item.assets.find((asset: unknown) => isRecord(asset)
        && asset.state === 'uploaded' && typeof asset.name === 'string' && asset.name.endsWith('.apk'));
      if (item.draft || !apk) continue;
      if (!isRecord(apk) || typeof apk.browser_download_url !== 'string'
        || !apk.browser_download_url.startsWith(`https://github.com/${REPOSITORY}/releases/download/`)
        || typeof apk.size !== 'number' || !Number.isSafeInteger(apk.size) || apk.size <= 0
        || typeof apk.digest !== 'string' || !/^sha256:[0-9a-f]{64}$/.test(apk.digest)) {
        throw new Error('发布安装包缺少有效的下载地址、大小或 SHA-256');
      }
      releases.push({
        tag: item.tag_name,
        version: item.tag_name.replace(/^v/, ''),
        prerelease: item.prerelease,
        notes: item.body === null ? '' : item.body as string,
        apk: { url: apk.browser_download_url, size: apk.size, sha256: apk.digest.slice(7) },
      });
    }
    return releases;
  } finally {
    clearTimeout(timeout);
  }
}
