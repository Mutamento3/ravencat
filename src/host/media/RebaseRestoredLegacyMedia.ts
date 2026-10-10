/** Restore bootstrap 在 UI/运行时启动前，按各 Feature owner 重定位 legacy 引用。 */
import { parseStableSettingsBackupJson } from '@features/backup/composition';
import { userProfileRepository } from '@features/profile/composition';
import { aiAssistantRepository } from '@features/assistants/composition';
import { groupChatRepository, messageRepository } from '@features/chat/composition';
import {
  getPersistentMediaRootUri, rebaseLegacyMediaReference,
  getPersistentImageCategoryPrefix, PERSISTENT_IMAGE_CATEGORY,
  getPersistentMediaCategoryPrefix, PERSISTENT_MEDIA_CATEGORY,
} from '@platform/device';
import { databaseCoordinator } from '@platform/persistence';

export async function rebaseRestoredLegacyMedia(json: string): Promise<void> {
  const sourceRoot = parseStableSettingsBackupJson(json).legacyMediaRootUri;
  const targetRoot = getPersistentMediaRootUri();
  if (sourceRoot === targetRoot) return;
  const imageRebaser = (category: typeof PERSISTENT_IMAGE_CATEGORY[keyof typeof PERSISTENT_IMAGE_CATEGORY]) =>
    (uri: string | null) => rebaseLegacyMediaReference(uri, sourceRoot, targetRoot, [getPersistentImageCategoryPrefix(category)]);
  await databaseCoordinator.transaction({ name: 'backup.rebase-legacy-media', feature: 'backup', priority: 'bootstrap' }, async (transaction) => {
    await userProfileRepository.rebaseRestoredMediaInTransaction(transaction, imageRebaser(PERSISTENT_IMAGE_CATEGORY.userAvatar));
    await aiAssistantRepository.rebaseRestoredMediaInTransaction(transaction, imageRebaser(PERSISTENT_IMAGE_CATEGORY.aiAvatar));
    await groupChatRepository.rebaseRestoredMediaInTransaction(transaction, imageRebaser(PERSISTENT_IMAGE_CATEGORY.groupAvatar));
    await messageRepository.rebaseRestoredMediaInTransaction(transaction, (uri) => rebaseLegacyMediaReference(uri, sourceRoot, targetRoot,
      [getPersistentMediaCategoryPrefix(PERSISTENT_MEDIA_CATEGORY.chatImage), getPersistentMediaCategoryPrefix(PERSISTENT_MEDIA_CATEGORY.chatFile)]));
  });
}
