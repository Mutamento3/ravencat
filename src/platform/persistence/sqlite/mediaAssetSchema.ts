/** MediaAsset catalog 的建表与索引语句，供新库初始化和幂等迁移共同复用。 */

export const MEDIA_ASSET_SCHEMA = `
  CREATE TABLE IF NOT EXISTS media_assets (
    id TEXT PRIMARY KEY NOT NULL CHECK (length(id) > 0),
    storage_backend TEXT NOT NULL CHECK (length(storage_backend) > 0),
    storage_key TEXT NOT NULL CHECK (
      length(storage_key) > 0
      AND instr(storage_key, '://') = 0
      AND instr(storage_key, ':') = 0
      AND instr(storage_key, '\\') = 0
      AND substr(storage_key, 1, 1) <> '/'
      AND storage_key NOT IN ('.', '..')
      AND storage_key NOT LIKE './%'
      AND storage_key NOT LIKE '../%'
      AND storage_key NOT LIKE '%/./%'
      AND storage_key NOT LIKE '%/../%'
      AND storage_key NOT LIKE '%/.'
      AND storage_key NOT LIKE '%/..'
    ),
    hash_algorithm TEXT NOT NULL CHECK (hash_algorithm = 'sha256'),
    content_hash TEXT NOT NULL CHECK (
      length(content_hash) = 64
      AND content_hash NOT GLOB '*[^0-9a-f]*'
    ),
    mime_type TEXT NOT NULL CHECK (length(mime_type) > 0),
    byte_size INTEGER NOT NULL CHECK (byte_size >= 0),
    width INTEGER CHECK (width IS NULL OR width > 0),
    height INTEGER CHECK (height IS NULL OR height > 0),
    duration_ms INTEGER CHECK (duration_ms IS NULL OR duration_ms >= 0),
    status TEXT NOT NULL CHECK (status IN ('ready', 'missing')),
    created_at TEXT NOT NULL CHECK (length(created_at) > 0),
    updated_at TEXT NOT NULL CHECK (length(updated_at) > 0),
    UNIQUE (storage_backend, storage_key)
  );
`;

/** Hash 只用于定位复用候选；不同 backing 的相同内容允许拥有不同资产行。 */
export const MEDIA_ASSET_CONTENT_HASH_INDEX = `
  CREATE INDEX IF NOT EXISTS idx_media_assets_content_hash
    ON media_assets(hash_algorithm, content_hash);
`;
