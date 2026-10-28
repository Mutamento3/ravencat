import * as SecureStore from 'expo-secure-store';
import { randomUUID } from 'expo-crypto';
import type { SearchCredentialStore } from '../domain/SearchSettingsRepository';

/** 密钥不进入 SQLite、工具 schema 或 observation；替换时先创建新引用，再原子发布。 */
export const secureSearchCredentialStore: SearchCredentialStore = {
  async save(key) {
    const reference = `web.search.${randomUUID()}`;
    await SecureStore.setItemAsync(reference, key);
    return reference;
  },
  read: reference => SecureStore.getItemAsync(reference),
  delete: reference => SecureStore.deleteItemAsync(reference),
};

interface SearchCredentialBackupEntry {
  reference: string;
  key: string | null;
}

function parseSearchCredentialsBackup(input: unknown): SearchCredentialBackupEntry[] {
  if (!Array.isArray(input)) throw new Error('备份搜索凭据无效');
  const seen = new Set<string>();
  return input.map((entry: unknown) => {
    if (!entry || typeof entry !== 'object') throw new Error('备份搜索凭据无效');
    const { reference, key } = entry as Record<string, unknown>;
    // 外部备份只能写入搜索凭据自己的命名空间，不能覆盖其他安全存储数据。
    if (typeof reference !== 'string'
      || !/^web\.search\.[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u.test(reference)
      || seen.has(reference)
      || (key !== null && (typeof key !== 'string' || !/^[\x21-\x7E]{1,512}$/u.test(key)))) {
      throw new Error('备份搜索凭据无效');
    }
    seen.add(reference);
    return { reference, key: key as string | null };
  });
}

export async function readSearchCredentialsBackup(references: readonly string[]): Promise<SearchCredentialBackupEntry[]> {
  return Promise.all(references.map(async reference => ({
    reference,
    key: await secureSearchCredentialStore.read(reference),
  })));
}

export function validateSearchCredentialsBackup(input: unknown, references: readonly string[]): void {
  const entries = parseSearchCredentialsBackup(input);
  const expected = new Set(references);
  if (entries.length !== expected.size || entries.some(entry => !expected.has(entry.reference))) {
    throw new Error('备份搜索凭据与数据库引用不一致');
  }
}

/** 保留数据库中的引用；旧值由恢复事务的稳定设置快照负责补偿，不修改搜索配置事实。 */
export async function restoreSearchCredentialsBackup(input: unknown): Promise<void> {
  const entries = parseSearchCredentialsBackup(input);
  for (const { reference, key } of entries) {
    // null 保留原本就缺失的状态，也让回滚能撤销本次恢复写入的同名凭据。
    if (key === null) await SecureStore.deleteItemAsync(reference);
    else await SecureStore.setItemAsync(reference, key);
  }
}
