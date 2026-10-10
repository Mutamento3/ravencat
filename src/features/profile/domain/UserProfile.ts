import { DEFAULT_SELF_NAME, SELF_USER_ID } from '@shared';

export const SELF_USER_PROFILE_ID = SELF_USER_ID;
export const DEFAULT_SELF_USER_NAME = DEFAULT_SELF_NAME;

export interface UserProfile {
  id: string;
  name: string;
  gender: string;
  age: number | null;
  identity: string;
  region: string;
  other: string;
  signature: string;
  avatar: string | null;
  /** canonical 头像身份；avatar 是当前展示 URI，未迁移时直接来自 legacy 列。 */
  avatarMediaAssetId: string | null;
  momentsCover: string | null;
  /** 封面稳定身份；momentsCover 只用于当前设备展示。 */
  momentsCoverMediaAssetId: string | null;
  updatedAt: string;
}

export interface UpdateUserProfileInput {
  name?: string;
  gender?: string;
  age?: number | null;
  identity?: string;
  region?: string;
  other?: string;
  signature?: string;
  avatar?: string | null;
  /** 提交 canonical 头像时由 owner 同时清空 legacy avatar。 */
  avatarMediaAssetId?: string | null;
}

interface UserProfileRow {
  id: string;
  name: string;
  gender: string;
  age: number | null;
  identity: string;
  region: string;
  other: string;
  signature: string;
  avatar?: string | null;
  avatar_media_asset_id?: string | null;
  moments_cover?: string | null;
  moments_cover_media_asset_id?: string | null;
  updated_at: string;
}

function normalizeName(name?: string | null): string {
  const trimmed = String(name || '').trim();
  return trimmed || DEFAULT_SELF_USER_NAME;
}

function normalizeAvatar(avatar?: string | null): string | null {
  if (avatar === null || avatar === undefined) return null;
  const trimmed = String(avatar).trim();
  return trimmed || null;
}

function normalizeAvatarMediaAssetId(assetId?: string | null): string | null {
  if (assetId === null || assetId === undefined) return null;
  const trimmed = String(assetId).trim();
  return trimmed || null;
}

function normalizeMomentsCover(momentsCover?: string | null): string | null {
  if (momentsCover === null || momentsCover === undefined) return null;
  const trimmed = String(momentsCover).trim();
  return trimmed || null;
}

export function createUserProfile(data: Partial<UserProfile> = {}): UserProfile {
  return {
    id: data.id || SELF_USER_PROFILE_ID,
    name: normalizeName(data.name),
    gender: data.gender ?? '',
    age: data.age ?? null,
    identity: data.identity ?? '',
    region: data.region ?? '',
    other: data.other ?? '',
    signature: data.signature ?? '',
    avatar: normalizeAvatar(data.avatar),
    avatarMediaAssetId: normalizeAvatarMediaAssetId(data.avatarMediaAssetId),
    momentsCover: normalizeMomentsCover(data.momentsCover),
    momentsCoverMediaAssetId: normalizeAvatarMediaAssetId(data.momentsCoverMediaAssetId),
    updatedAt: data.updatedAt || new Date().toISOString(),
  };
}

export function createDefaultUserProfile(now = new Date().toISOString()): UserProfile {
  return createUserProfile({
    id: SELF_USER_PROFILE_ID,
    name: DEFAULT_SELF_USER_NAME,
    avatar: null,
    avatarMediaAssetId: null,
    momentsCover: null,
    updatedAt: now,
  });
}

export function createUserProfileFromRow(row: UserProfileRow | null | undefined): UserProfile | null {
  if (!row) return null;

  return createUserProfile({
    id: row.id,
    name: row.name,
    gender: row.gender,
    age: row.age,
    identity: row.identity,
    region: row.region,
    other: row.other,
    signature: row.signature,
    avatar: row.avatar || null,
    avatarMediaAssetId: row.avatar_media_asset_id || null,
    momentsCover: row.moments_cover || null,
    momentsCoverMediaAssetId: row.moments_cover_media_asset_id || null,
    updatedAt: row.updated_at,
  });
}
