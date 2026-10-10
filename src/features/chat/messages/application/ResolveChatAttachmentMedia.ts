/** 将 Chat 持久化附件引用解析为当前设备可用的运行时 URI。 */

import { resolveMediaAsset } from '@features/media';
import { getPersistentMediaInfo } from '@platform/device/DeviceMediaService';

import type { LegacyChatAttachment, MediaAssetChatAttachment } from '../domain/ChatAttachment';

type MediaReferenceFields = 'mediaAssetId' | 'thumbnailMediaAssetId' | 'localUri' | 'thumbnailUri';
export type ChatAttachmentMediaReference =
  | Pick<LegacyChatAttachment, MediaReferenceFields>
  | Pick<MediaAssetChatAttachment, MediaReferenceFields>;

export interface ResolvedChatImageAttachmentUris {
  previewUri: string;
  fullSizeUri: string;
}

/**
 * M3a/M4a 过渡期只允许两种明确输入：历史 URI 或 MediaAsset ID。
 * legacy 分支在 M4a 停止旧写入且迁移扫描稳定为零后删除。
 */
export async function resolveChatAttachmentPrimaryUri(
  attachment: ChatAttachmentMediaReference,
): Promise<string> {
  if (typeof attachment.mediaAssetId === 'string') {
    return (await resolveMediaAsset(attachment.mediaAssetId)).localUri;
  }

  return attachment.localUri;
}

/** 缩略图没有独立资产时，与既有行为一致地使用主文件。 */
async function resolveChatAttachmentThumbnailUri(
  attachment: ChatAttachmentMediaReference,
): Promise<string> {
  if (typeof attachment.mediaAssetId === 'string') {
    const assetId = attachment.thumbnailMediaAssetId || attachment.mediaAssetId;
    return (await resolveMediaAsset(assetId)).localUri;
  }

  return attachment.thumbnailUri || attachment.localUri;
}

async function resolveAvailableImageUri(
  attachment: ChatAttachmentMediaReference,
  thumbnail: boolean,
): Promise<string | null> {
  const uri = await (thumbnail
    ? resolveChatAttachmentThumbnailUri(attachment)
    : resolveChatAttachmentPrimaryUri(attachment));

  // Media resolver 已在 backing 边界确认文件存在；只有历史裸 URI 需要在这里检查。
  if (typeof attachment.mediaAssetId === 'string') {
    return uri;
  }
  if (uri.startsWith('http://') || uri.startsWith('https://')) {
    return uri;
  }
  return (await getPersistentMediaInfo(uri)).exists ? uri : null;
}

/** 主图与缩略图共用资产时只解析一次；任一可用时仍可展示这条历史图片。 */
export async function resolveChatImageAttachmentUris(
  attachment: ChatAttachmentMediaReference,
): Promise<ResolvedChatImageAttachmentUris | null> {
  const hasSeparateThumbnail = typeof attachment.mediaAssetId === 'string'
    ? Boolean(attachment.thumbnailMediaAssetId
      && attachment.thumbnailMediaAssetId !== attachment.mediaAssetId)
    : Boolean(attachment.thumbnailUri && attachment.thumbnailUri !== attachment.localUri);
  const primaryRequest = resolveAvailableImageUri(attachment, false);
  const thumbnailRequest = hasSeparateThumbnail
    ? resolveAvailableImageUri(attachment, true)
    : primaryRequest;
  const [primary, thumbnail] = await Promise.allSettled([primaryRequest, thumbnailRequest]);

  if (primary.status === 'rejected') {
    console.error('[ChatImageAttachment] 主图媒体解析失败：', primary.reason);
  }
  if (hasSeparateThumbnail && thumbnail.status === 'rejected') {
    console.error('[ChatImageAttachment] 缩略图媒体解析失败：', thumbnail.reason);
  }
  const primaryUri = primary.status === 'fulfilled' ? primary.value : null;
  const thumbnailUri = thumbnail.status === 'fulfilled' ? thumbnail.value : null;
  const fullSizeUri = primaryUri || thumbnailUri;
  if (!fullSizeUri) {
    return null;
  }
  return {
    previewUri: thumbnailUri || fullSizeUri,
    fullSizeUri,
  };
}
