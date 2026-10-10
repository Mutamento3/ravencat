/** 将外部临时图片纳入聊天附件的既有持久化目录。 */

import {
  PERSISTENT_MEDIA_CATEGORY,
  persistentMediaStore,
} from '@platform/device';
import {
  createAttachmentDraftId,
  type ChatAttachment,
  type ChatAttachmentSource,
} from '../domain/ChatAttachment';

export interface PersistChatImageAttachmentInput {
  sourceUri: string;
  source: ChatAttachmentSource;
  fileName: string;
  mimeType: string;
  width?: number | null;
  height?: number | null;
}

export async function persistChatImageAttachment(
  input: PersistChatImageAttachmentInput
): Promise<ChatAttachment> {
  const attachmentId = createAttachmentDraftId('img');
  const localUri = await persistentMediaStore.persistMedia({
    sourceUri: input.sourceUri,
    category: PERSISTENT_MEDIA_CATEGORY.chatImage,
    entityId: attachmentId,
    originalFileName: input.fileName,
    mimeType: input.mimeType,
  });
  const fileInfo = await persistentMediaStore.getInfo(localUri);

  return {
    id: attachmentId,
    type: 'image',
    source: input.source,
    localUri,
    fileName: input.fileName,
    mimeType: input.mimeType,
    fileSize: fileInfo.size,
    width: input.width ?? null,
    height: input.height ?? null,
    thumbnailUri: localUri,
    parseStatus: 'skipped',
  };
}

export function deletePersistedChatAttachment(uri: string): Promise<boolean> {
  return persistentMediaStore.deleteIfExists(uri);
}
