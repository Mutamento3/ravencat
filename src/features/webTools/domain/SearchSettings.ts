import type { WebConnectionMode, WebSearchEngine } from '@platform/web';

export const SEARCH_SOURCES: { engine: WebSearchEngine; name: string; needsKey: boolean }[] = [
  { engine: 'bing', name: 'Bing', needsKey: false },
  { engine: 'duckduckgo', name: 'DuckDuckGo', needsKey: false },
  { engine: 'tavily', name: 'Tavily', needsKey: true },
  { engine: 'brave', name: 'Brave Search', needsKey: true },
];

export interface SearchSourceSettings {
  engine: WebSearchEngine;
  enabled: boolean;
  credentialRef: string | null;
}

export interface SearchSettings {
  revision: number;
  defaultEngine: WebSearchEngine | null;
  customConfigured: boolean;
  allowAdvanced: boolean;
  connectionMode: WebConnectionMode;
  sources: SearchSourceSettings[];
}

export type SearchSettingsChange =
  | { kind: 'default'; engine: WebSearchEngine | null }
  | { kind: 'advanced'; allowed: boolean }
  | { kind: 'connection'; mode: WebConnectionMode }
  | { kind: 'credential'; engine: 'tavily' | 'brave'; reference: string; expectedRevision: number };

export function availableSearchSources(settings: SearchSettings): WebSearchEngine[] {
  return settings.sources.filter(source => source.enabled).map(source => source.engine);
}

/** 默认选择、启用和凭据发布属于同一个配置事实，必须在仓储事务中一起提交。 */
export function changeSearchSettings(current: SearchSettings, change: SearchSettingsChange): SearchSettings {
  const next: SearchSettings = { ...current, revision: current.revision + 1, sources: current.sources.map(source => ({ ...source })) };
  if (change.kind === 'connection') next.connectionMode = change.mode;
  else if (change.kind === 'advanced') next.allowAdvanced = change.allowed;
  else if (change.kind === 'default') {
    if (change.engine !== null) {
      const source = next.sources.find(item => item.engine === change.engine)!;
      if (SEARCH_SOURCES.find(item => item.engine === change.engine)!.needsKey && source.credentialRef === null) {
        throw new Error('请先填写密钥并测试连接');
      }
      source.enabled = true;
    }
    next.defaultEngine = change.engine;
  } else {
    const source = next.sources.find(item => item.engine === change.engine)!;
    if (current.revision !== change.expectedRevision) throw new Error('搜索配置已改变，请刷新后重新操作');
    source.credentialRef = change.reference;
    source.enabled = true;
    if (!current.customConfigured) {
      next.defaultEngine = change.engine;
      next.customConfigured = true;
    }
  }
  return next;
}
