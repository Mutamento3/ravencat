/** 私有下载素材是持久业务引用；角色删除后由媒体 owner 裁决共享文件回收。 */
export const AI_DOWNLOADED_IMAGES_SCHEMA = `
  CREATE TABLE IF NOT EXISTS ai_downloaded_images (
    id TEXT PRIMARY KEY NOT NULL,
    assistant_id TEXT NOT NULL REFERENCES ai_assistants(id) ON DELETE CASCADE,
    media_asset_id TEXT NOT NULL REFERENCES media_assets(id) ON DELETE RESTRICT,
    source_url TEXT NOT NULL,
    file_name TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
`;
