import type { SearchSettings, SearchSettingsChange } from './SearchSettings';

export interface SearchSettingsRepository {
  read(): Promise<SearchSettings>;
  change(change: SearchSettingsChange): Promise<SearchSettings>;
}

export interface SearchCredentialStore {
  save(key: string): Promise<string>;
  read(reference: string): Promise<string | null>;
  delete(reference: string): Promise<void>;
}
