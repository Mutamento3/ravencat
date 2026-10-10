/** 按附件类型选择图片或文件卡片，并统一转发预览回调。 */

import React, { memo } from 'react';

import type { ChatAttachment } from '@features/chat/messages/domain';
import FileAttachmentCard from './FileAttachmentCard';
import ImageAttachmentCard from './ImageAttachmentCard';

interface AttachmentCardProps {
  attachment: ChatAttachment;
  isMe: boolean;
  onImageLongPress?: (position: { x: number; y: number }) => void;
  onPreview: (params: { fileUri: string; fileName: string; mimeType?: string | null }) => void;
}

function AttachmentCard({
  attachment,
  isMe,
  onImageLongPress,
  onPreview,
}: AttachmentCardProps) {
  if (attachment.type === 'image') {
    return <ImageAttachmentCard attachment={attachment} isMe={isMe} onLongPress={onImageLongPress} />;
  }

  return <FileAttachmentCard attachment={attachment} isMe={isMe} onPreview={onPreview} />;
}

export default memo(AttachmentCard);
