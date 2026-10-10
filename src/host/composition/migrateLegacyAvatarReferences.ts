import {
  commitAIAvatarMediaAssetReferenceInTransaction,
  listAIAvatarMediaAssetMigrationCandidates,
} from '@features/assistants/composition';
import {
  commitUserAvatarMediaAssetReferenceInTransaction,
  listUserAvatarMediaAssetMigrationCandidates,
} from '@features/profile/composition';
import {
  commitGroupAvatarMediaAssetReferenceInTransaction,
  listGroupAvatarMediaAssetMigrationCandidates,
} from '@features/chat/composition';
import { PERSISTENT_IMAGE_CATEGORY } from '@platform/device';

import {
  adoptExistingMediaAssetsWithReference,
  locateLegacyAvatarFile,
} from './configureMediaRuntime';
import {
  migrateLegacyAvatarReferences as migrateLegacyAvatarReferencesUseCase,
  type CanonicalAvatarMigrationPort,
  type MigrateLegacyAvatarReferencesResult,
} from '../media/MigrateLegacyAvatarReferences';

const avatarOwners: readonly CanonicalAvatarMigrationPort[] = [
  {
    ownerKind: 'user',
    category: PERSISTENT_IMAGE_CATEGORY.userAvatar,
    listCandidates: async () => (await listUserAvatarMediaAssetMigrationCandidates()).map(
      (candidate) => ({ ownerId: candidate.id, legacyUri: candidate.avatar }),
    ),
    commitReferenceInTransaction: (transaction, candidate, mediaAssetId) => (
      commitUserAvatarMediaAssetReferenceInTransaction(transaction, {
        ownerId: candidate.ownerId,
        expectedAvatar: candidate.legacyUri,
        expectedAvatarMediaAssetId: null,
        mediaAssetId,
      })
    ),
  },
  {
    ownerKind: 'assistant',
    category: PERSISTENT_IMAGE_CATEGORY.aiAvatar,
    listCandidates: async () => (await listAIAvatarMediaAssetMigrationCandidates()).map(
      (candidate) => ({ ownerId: candidate.id, legacyUri: candidate.avatar }),
    ),
    commitReferenceInTransaction: (transaction, candidate, mediaAssetId) => (
      commitAIAvatarMediaAssetReferenceInTransaction(transaction, {
        ownerId: candidate.ownerId,
        expectedAvatar: candidate.legacyUri,
        expectedAvatarMediaAssetId: null,
        mediaAssetId,
      })
    ),
  },
  {
    ownerKind: 'group',
    category: PERSISTENT_IMAGE_CATEGORY.groupAvatar,
    listCandidates: async () => (await listGroupAvatarMediaAssetMigrationCandidates()).map(
      (candidate) => ({ ownerId: candidate.id, legacyUri: candidate.avatar }),
    ),
    commitReferenceInTransaction: (transaction, candidate, mediaAssetId) => (
      commitGroupAvatarMediaAssetReferenceInTransaction(transaction, {
        ownerId: candidate.ownerId,
        expectedAvatar: candidate.legacyUri,
        expectedAvatarMediaAssetId: null,
        mediaAssetId,
      })
    ),
  },
];

/** Host-only M3b 入口；不进入任何业务 Feature 的稳定公共 facade。 */
export function migrateLegacyCanonicalAvatarReferences(): Promise<
  MigrateLegacyAvatarReferencesResult
> {
  return migrateLegacyAvatarReferencesUseCase({
    avatarOwners,
    locateLegacyAvatarFile,
    adoptExistingAvatar: async (input, commit) => {
      const result = await adoptExistingMediaAssetsWithReference(
        [input],
        async ({ transaction, entries }) => commit(transaction, entries[0].asset),
      );
      return {
        value: result.value,
        asset: result.entries[0].asset,
        reused: result.entries[0].reused,
      };
    },
  });
}
