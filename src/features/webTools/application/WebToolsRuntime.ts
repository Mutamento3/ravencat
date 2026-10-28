import { createRuntimeSlot } from '@shared/runtime/RuntimeSlot';
import { configureWebTransport } from '@platform/web';
import type { SearchSettingsRepository, SearchCredentialStore } from '../domain/SearchSettingsRepository';

interface WebToolsRuntime { settings: SearchSettingsRepository; credentials: SearchCredentialStore }
const slot = createRuntimeSlot<WebToolsRuntime>('联网工具');
export function configureWebToolsRuntime(runtime: WebToolsRuntime): void {
  slot.configure(runtime);
  configureWebTransport({ readConnectionMode: async () => (await runtime.settings.read()).connectionMode });
}
export const getWebToolsRuntime = slot.get;
