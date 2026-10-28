import { databaseCoordinator, type DatabaseReadExecutor, type DatabaseTransactionExecutor } from '@platform/persistence';
import type { WebConnectionMode, WebSearchEngine } from '@platform/web';
import { changeSearchSettings, type SearchSettings } from '../domain/SearchSettings';
import type { SearchSettingsRepository } from '../domain/SearchSettingsRepository';

function executor(name: string) {
  return databaseCoordinator.openTaskExecutor({ name: `webTools.settings.${name}`, feature: 'webTools', priority: 'interactive' });
}

/** 备份必须使用所归档数据库的引用，不能用备份期间已变化的活动配置替代。 */
export async function readSearchCredentialReferences(db: DatabaseReadExecutor): Promise<string[]> {
  const rows = await db.getAllAsync<{ credential_ref: string }>(
    'SELECT DISTINCT credential_ref FROM web_search_sources WHERE credential_ref IS NOT NULL',
  );
  return rows.map(row => row.credential_ref);
}

async function read(db: DatabaseTransactionExecutor): Promise<SearchSettings> {
  const settings = await db.getFirstAsync<{ revision: number; default_engine: WebSearchEngine | null; custom_configured: number; allow_advanced: number; connection_mode: WebConnectionMode }>(
    'SELECT * FROM web_search_settings WHERE id = 1',
  );
  const sources = await db.getAllAsync<{ engine: WebSearchEngine; enabled: number; credential_ref: string | null }>(
    'SELECT * FROM web_search_sources ORDER BY position',
  );
  return { revision: settings!.revision, defaultEngine: settings!.default_engine,
    customConfigured: settings!.custom_configured === 1, allowAdvanced: settings!.allow_advanced === 1,
    connectionMode: settings!.connection_mode,
    sources: sources.map(source => ({ engine: source.engine, enabled: source.enabled === 1, credentialRef: source.credential_ref })) };
}

export const sqliteSearchSettingsRepository: SearchSettingsRepository = {
  read: () => executor('read').withExclusiveTransactionAsync(read),
  change: change => executor('change').withExclusiveTransactionAsync(async db => {
    const next = changeSearchSettings(await read(db), change);
    await db.runAsync(`UPDATE web_search_settings SET revision = ?, default_engine = ?, custom_configured = ?, allow_advanced = ?, connection_mode = ? WHERE id = 1`,
      [next.revision, next.defaultEngine, next.customConfigured ? 1 : 0, next.allowAdvanced ? 1 : 0, next.connectionMode]);
    for (const source of next.sources) {
      await db.runAsync('UPDATE web_search_sources SET enabled = ?, credential_ref = ? WHERE engine = ?',
        [source.enabled ? 1 : 0, source.credentialRef, source.engine]);
    }
    return next;
  }),
};
