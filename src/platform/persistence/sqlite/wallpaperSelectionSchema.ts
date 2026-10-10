/** 本机旧 URI 先保存在同一 owner 的迁移列，单个文件缺失不阻止其他选择被修复。 */
export const WALLPAPER_SELECTION_SCHEMA = `
  CREATE TABLE IF NOT EXISTS profile_wallpaper_selections (
    selection_key TEXT PRIMARY KEY NOT NULL CHECK (length(selection_key) > 0),
    media_asset_id TEXT,
    legacy_uri TEXT,
    revision INTEGER NOT NULL CHECK (revision >= 0),
    CHECK (media_asset_id IS NULL OR legacy_uri IS NULL)
  );
`;
