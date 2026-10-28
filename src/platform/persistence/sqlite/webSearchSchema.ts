/** 来源固定为四种实现；默认选择可为空，禁用来源不会自动切换服务。 */
export const WEB_SEARCH_SCHEMA = `
CREATE TABLE IF NOT EXISTS web_search_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  revision INTEGER NOT NULL DEFAULT 0,
  default_engine TEXT CHECK (default_engine IN ('bing', 'duckduckgo', 'tavily', 'brave')),
  custom_configured INTEGER NOT NULL DEFAULT 0 CHECK (custom_configured IN (0, 1)),
  allow_advanced INTEGER NOT NULL DEFAULT 0 CHECK (allow_advanced IN (0, 1)),
  connection_mode TEXT NOT NULL DEFAULT 'direct' CHECK (connection_mode IN ('direct', 'system'))
);
CREATE TABLE IF NOT EXISTS web_search_sources (
  engine TEXT PRIMARY KEY CHECK (engine IN ('bing', 'duckduckgo', 'tavily', 'brave')),
  position INTEGER NOT NULL UNIQUE,
  enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
  credential_ref TEXT,
  CHECK (engine IN ('tavily', 'brave') OR credential_ref IS NULL),
  CHECK (engine IN ('bing', 'duckduckgo') OR enabled = 0 OR credential_ref IS NOT NULL)
);
`;

export const WEB_SEARCH_DEFAULTS = `
INSERT OR IGNORE INTO web_search_settings (id, default_engine) VALUES (1, 'bing');
INSERT OR IGNORE INTO web_search_sources (engine, position, enabled) VALUES ('bing', 0, 1), ('duckduckgo', 1, 1), ('tavily', 2, 0), ('brave', 3, 0);
`;
