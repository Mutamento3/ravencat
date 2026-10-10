import * as SecureStore from 'expo-secure-store';
import { randomUUID } from 'expo-crypto';
import type { McpCredentialStore } from '../domain/McpCredentialStore';

/** Android Keystore 加密存储；无需前台生物认证，Headless 与前台共用凭据。 */
export const secureStoreMcpCredentialStore: McpCredentialStore = {
  async save(token) {
    const reference = `mcp.token.${randomUUID()}`;
    await SecureStore.setItemAsync(reference, token);
    return reference;
  },
  read: (reference) => SecureStore.getItemAsync(reference),
  delete: (reference) => SecureStore.deleteItemAsync(reference),
};
