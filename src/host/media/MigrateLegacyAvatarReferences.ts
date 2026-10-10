import type { MediaAsset } from '@features/media';
import type { LegacyAvatarCategory } from '@platform/device';
import type { DatabaseTransactionExecutor } from '@platform/persistence';

export type CanonicalAvatarOwnerKind = 'user' | 'assistant' | 'group';

export interface LegacyCanonicalAvatarCandidate {
  ownerId: string;
  legacyUri: string;
}

export interface CanonicalAvatarMigrationPort {
  ownerKind: CanonicalAvatarOwnerKind;
  category: LegacyAvatarCategory;
  listCandidates(): Promise<readonly LegacyCanonicalAvatarCandidate[]>;
  commitReferenceInTransaction(
    transaction: DatabaseTransactionExecutor,
    candidate: LegacyCanonicalAvatarCandidate,
    mediaAssetId: string,
  ): Promise<void>;
}

export interface MigrateLegacyAvatarReferencesDependencies {
  avatarOwners: readonly CanonicalAvatarMigrationPort[];
  locateLegacyAvatarFile(
    legacyUri: string,
    category: LegacyAvatarCategory,
  ): Promise<{
    storageBackend: string;
    storageKey: string;
    localUri: string;
  } | null>;
  adoptExistingAvatar<T>(
    input: {
      storageBackend: string;
      storageKey: string;
      localUri: string;
      mimeType: string;
      width: null;
      height: null;
      durationMs: null;
    },
    commit: (
      transaction: DatabaseTransactionExecutor,
      asset: MediaAsset,
    ) => Promise<T>,
  ): Promise<{ value: T; asset: MediaAsset; reused: boolean }>;
}

export type LegacyAvatarMigrationIssue = {
  scope: 'canonical_avatar';
  ownerKind: CanonicalAvatarOwnerKind;
  ownerId: string;
  reason: 'unmanaged_or_unavailable_uri' | 'unsupported_image_type' | 'commit_failed';
  detail: string;
};

export interface MigrateLegacyAvatarReferencesResult {
  scannedCanonicalAvatars: number;
  migratedCanonicalAvatars: number;
  createdAssets: number;
  reusedAssets: number;
  unresolvedCanonicalAvatars: number;
  issues: LegacyAvatarMigrationIssue[];
}

const AVATAR_MIME_BY_EXTENSION: Readonly<Record<string, string>> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  heic: 'image/heic',
  heif: 'image/heif',
  avif: 'image/avif',
  bmp: 'image/bmp',
};

function resolveAvatarMimeType(storageKey: string): string | null {
  const match = storageKey.match(/\.([a-zA-Z0-9]{2,5})$/);
  return match ? AVATAR_MIME_BY_EXTENSION[match[1].toLowerCase()] ?? null : null;
}

function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * M3b 只为三个 canonical owner 的当前本地头像建立资产身份。
 *
 * Moments 不再持有任何 avatar 快照：Moments V2 的作者身份是
 * `author_type + author_id`，展示时解析当前 Profile / Assistant，
 * 因此这条迁移不需要（也不应该）再清理朋友圈快照列。
 */
export async function migrateLegacyAvatarReferences(
  dependencies: MigrateLegacyAvatarReferencesDependencies,
): Promise<MigrateLegacyAvatarReferencesResult> {
  const result: MigrateLegacyAvatarReferencesResult = {
    scannedCanonicalAvatars: 0,
    migratedCanonicalAvatars: 0,
    createdAssets: 0,
    reusedAssets: 0,
    unresolvedCanonicalAvatars: 0,
    issues: [],
  };

  for (const owner of dependencies.avatarOwners) {
    const candidates = await owner.listCandidates();
    for (const candidate of candidates) {
      result.scannedCanonicalAvatars += 1;
      const located = await dependencies.locateLegacyAvatarFile(
        candidate.legacyUri,
        owner.category,
      );
      if (!located) {
        result.unresolvedCanonicalAvatars += 1;
        result.issues.push({
          scope: 'canonical_avatar',
          ownerKind: owner.ownerKind,
          ownerId: candidate.ownerId,
          reason: 'unmanaged_or_unavailable_uri',
          detail: candidate.legacyUri,
        });
        continue;
      }

      const mimeType = resolveAvatarMimeType(located.storageKey);
      if (!mimeType) {
        result.unresolvedCanonicalAvatars += 1;
        result.issues.push({
          scope: 'canonical_avatar',
          ownerKind: owner.ownerKind,
          ownerId: candidate.ownerId,
          reason: 'unsupported_image_type',
          detail: located.storageKey,
        });
        continue;
      }

      try {
        const adoption = await dependencies.adoptExistingAvatar(
          {
            ...located,
            mimeType,
            width: null,
            height: null,
            durationMs: null,
          },
          (transaction, asset) => owner.commitReferenceInTransaction(
            transaction,
            candidate,
            asset.id,
          ),
        );
        result.migratedCanonicalAvatars += 1;
        if (adoption.reused) {
          result.reusedAssets += 1;
        } else {
          result.createdAssets += 1;
        }
      } catch (error) {
        result.unresolvedCanonicalAvatars += 1;
        result.issues.push({
          scope: 'canonical_avatar',
          ownerKind: owner.ownerKind,
          ownerId: candidate.ownerId,
          reason: 'commit_failed',
          detail: reasonOf(error),
        });
      }
    }
  }

  return result;
}
