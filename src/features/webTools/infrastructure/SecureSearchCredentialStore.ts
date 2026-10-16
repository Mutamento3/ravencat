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
