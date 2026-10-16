import { createRuntimeSlot } from '@shared/runtime/RuntimeSlot';
import type { SearchSettingsRepository, SearchCredentialStore } from '../domain/SearchSettingsRepository';

const slot = createRuntimeSlot<{ settings: SearchSettingsRepository; credentials: SearchCredentialStore }>('联网工具');
export const configureWebToolsRuntime = slot.configure;
export const getWebToolsRuntime = slot.get;
