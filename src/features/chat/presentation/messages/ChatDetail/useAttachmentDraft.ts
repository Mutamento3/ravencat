/** 管理聊天图片和文件附件的选择、持久化、解析与草稿状态。 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ownChatAttachmentDraftFile, retainChatAttachmentDraftFiles } from './ChatAttachmentDraftFiles';

import {
  attachmentParser,
  assertChatAttachmentFileSupported,
} from '../../../messages/application/AttachmentParser';
import type {
  AttachmentDraftItem,
  ChatAttachment,
  ChatAttachmentType,
  ChatAttachmentSource,
} from '@features/chat/messages/domain';
import { createAttachmentDraftId } from '@features/chat/messages/domain';
import {
  PERSISTENT_MEDIA_CATEGORY,
  captureChatPhotoFromDevice,
  persistDeviceMedia,
  pickChatDocumentFromDevice,
  pickChatImageFromDevice,
} from '@platform/device/DeviceMediaService';

function buildReadyAttachment(draft: AttachmentDraftItem): ChatAttachment | null {
  if (draft.status !== 'ready' || !draft.localUri) {
    return null;
  }

  return {
    id: draft.id,
    type: draft.type,
    source: draft.source,
    localUri: draft.localUri,
    fileName: draft.fileName,
    mimeType: draft.mimeType,
    fileSize: draft.fileSize,
    width: draft.width,
    height: draft.height,
    thumbnailUri: draft.thumbnailUri,
    parseStatus: draft.parseStatus,
    parsedText: draft.parsedText,
    parseError: draft.parseError,
    parserName: draft.parserName,
    previewText: draft.previewText,
  };
}

function buildInitialDraft(params: {
  id: string;
  type: ChatAttachmentType;
  source: ChatAttachmentSource;
  originalUri: string;
  fileName: string;
  mimeType?: string | null;
  fileSize?: number | null;
  width?: number | null;
  height?: number | null;
}): AttachmentDraftItem {
  return {
    id: params.id,
    type: params.type,
    source: params.source,
    originalUri: params.originalUri,
    localUri: null,
    fileName: params.fileName,
    mimeType: params.mimeType ?? null,
    fileSize: params.fileSize ?? null,
    width: params.width ?? null,
    height: params.height ?? null,
    thumbnailUri: null,
    status: 'preparing',
    parseStatus: params.type === 'file' ? 'pending' : 'skipped',
    parsedText: null,
    parseError: null,
    parserName: null,
    previewText: null,
    errorMessage: null,
  };
}

const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'heic', 'heif', 'bmp'];

function isImageFile(fileName: string, mimeType?: string | null): boolean {
  if (mimeType?.startsWith('image/')) {
    return true;
  }
  const extension = fileName.toLowerCase().split('.').pop() ?? '';
  return IMAGE_EXTENSIONS.includes(extension);
}

export function useAttachmentDraft() {
  const [draftAttachment, setDraftAttachment] = useState<AttachmentDraftItem | null>(null);
  const operationIdRef = useRef(0);
  const draftRef = useRef<AttachmentDraftItem | null>(null);
  const draftLeases = useRef(new Map<string, () => void>());

  const releaseDraft = useCallback((draft: AttachmentDraftItem | null) => {
    if (!draft?.localUri) return;
    draftLeases.current.get(draft.localUri)?.();
    draftLeases.current.delete(draft.localUri);
  }, []);

  const clearAttachment = useCallback(() => {
    operationIdRef.current += 1;
    releaseDraft(draftRef.current);
    draftRef.current = null;
    setDraftAttachment(null);
  }, [releaseDraft]);

  useEffect(() => () => {
    operationIdRef.current += 1;
    releaseDraft(draftRef.current);
    draftRef.current = null;
  }, [releaseDraft]);

  const setDraftIfLatest = useCallback((operationId: number, updater: AttachmentDraftItem | null) => {
    if (operationIdRef.current !== operationId) {
      releaseDraft(updater);
      return;
    }
    draftRef.current = updater;
    setDraftAttachment(updater);
  }, [releaseDraft]);

  const prepareAttachment = useCallback(async (params: {
    type: ChatAttachmentType;
    source: ChatAttachmentSource;
    originalUri: string;
    fileName: string;
    mimeType?: string | null;
    fileSize?: number | null;
    width?: number | null;
    height?: number | null;
  }) => {
    if (params.type === 'file') {
      assertChatAttachmentFileSupported({
        fileName: params.fileName,
      });
    }

    const draftId = createAttachmentDraftId(params.type === 'image' ? 'img' : 'file');
    const operationId = operationIdRef.current + 1;
    operationIdRef.current = operationId;
    releaseDraft(draftRef.current);

    const initialDraft = buildInitialDraft({
      id: draftId,
      type: params.type,
      source: params.source,
      originalUri: params.originalUri,
      fileName: params.fileName,
      mimeType: params.mimeType,
      fileSize: params.fileSize,
      width: params.width,
      height: params.height,
    });
    setDraftAttachment(initialDraft);
    draftRef.current = initialDraft;

    let persistedUri: string | null = null;

    try {
      setDraftIfLatest(operationId, {
        ...initialDraft,
        status: 'persisting',
      });

      const localUri = await persistDeviceMedia({
        sourceUri: params.originalUri,
        category:
          params.type === 'image'
            ? PERSISTENT_MEDIA_CATEGORY.chatImage
            : PERSISTENT_MEDIA_CATEGORY.chatFile,
        entityId: draftId,
        originalFileName: params.fileName,
        mimeType: params.mimeType,
      });
      persistedUri = localUri;
      draftLeases.current.set(localUri, ownChatAttachmentDraftFile(localUri));
      if (operationIdRef.current !== operationId) {
        releaseDraft({ ...initialDraft, localUri });
        return;
      }

      if (params.type === 'image') {
        setDraftIfLatest(operationId, {
          ...initialDraft,
          localUri,
          thumbnailUri: localUri,
          status: 'ready',
          parseStatus: 'skipped',
        });
        return;
      }

      setDraftIfLatest(operationId, {
        ...initialDraft,
        localUri,
        status: 'parsing',
        parseStatus: 'parsing',
      });

      const parseResult = await attachmentParser.parseFile({
        localUri,
        fileName: params.fileName,
        mimeType: params.mimeType,
      });

      if (parseResult.parseStatus !== 'success') {
        throw new Error(
          parseResult.parseError
            ? `文件解析失败，无法发送：${parseResult.parseError}`
            : '文件无法解析，无法发送'
        );
      }

      setDraftIfLatest(operationId, {
        ...initialDraft,
        localUri,
        status: 'ready',
        parseStatus: parseResult.parseStatus,
        parsedText: parseResult.parsedText,
        parseError: parseResult.parseError,
        parserName: parseResult.parserName,
        previewText: parseResult.previewText,
      });
    } catch (error) {
      if (operationIdRef.current !== operationId) {
        releaseDraft({ ...initialDraft, localUri: persistedUri });
        return;
      }
      const message = error instanceof Error ? error.message : '附件处理失败';

      if (params.type === 'file') {
        setDraftIfLatest(operationId, null);
        releaseDraft({ ...initialDraft, localUri: persistedUri });
        throw error;
      }

      setDraftIfLatest(operationId, {
        ...initialDraft,
        status: 'failed',
        parseStatus: 'skipped',
        errorMessage: message,
        parseError: null,
      });
      throw error;
    }
  }, [releaseDraft, setDraftIfLatest]);

  const selectImageAttachment = useCallback(async () => {
    const image = await pickChatImageFromDevice();
    if (!image) {
      return false;
    }

    await prepareAttachment({
      type: 'image',
      source: image.source,
      originalUri: image.uri,
      fileName: image.fileName,
      mimeType: image.mimeType,
      fileSize: image.fileSize,
      width: image.width,
      height: image.height,
    });
    return true;
  }, [prepareAttachment]);

  const capturePhotoAttachment = useCallback(async () => {
    const photo = await captureChatPhotoFromDevice();
    if (!photo) {
      return false;
    }

    await prepareAttachment({
      type: 'image',
      source: photo.source,
      originalUri: photo.uri,
      fileName: photo.fileName,
      mimeType: photo.mimeType,
      fileSize: photo.fileSize,
      width: photo.width,
      height: photo.height,
    });
    return true;
  }, [prepareAttachment]);

  // 常见图片文件后缀（用于文件选择器选择的图片识别）
  const selectDocumentAttachment = useCallback(async () => {
    const document = await pickChatDocumentFromDevice();
    if (!document) {
      return false;
    }

    // 检查是否是图片文件，如果是则按图片类型处理
    const shouldTreatAsImage = isImageFile(document.fileName, document.mimeType);

    if (shouldTreatAsImage) {
      await prepareAttachment({
        type: 'image',
        source: document.source,
        originalUri: document.uri,
        fileName: document.fileName,
        mimeType: document.mimeType,
        fileSize: document.fileSize,
      });
    } else {
      await prepareAttachment({
        type: 'file',
        source: document.source,
        originalUri: document.uri,
        fileName: document.fileName,
        mimeType: document.mimeType,
        fileSize: document.fileSize,
      });
    }
    return true;
  }, [prepareAttachment]);

  const readyAttachments = useMemo(() => {
    const readyAttachment = draftAttachment ? buildReadyAttachment(draftAttachment) : null;
    return readyAttachment ? [readyAttachment] : [];
  }, [draftAttachment]);

  /** 发送持有源文件至结束；失败乐观气泡的重试持有由 send flow 独立负责。 */
  const withAttachmentSubmission = useCallback(async <T,>(
    submit: (attachments: ChatAttachment[]) => Promise<T>,
    shouldClearDraft: (result: T) => boolean,
  ): Promise<T> => {
    const draft = draftRef.current;
    const attachment = draft ? buildReadyAttachment(draft) : null;
    const releaseSubmission = retainChatAttachmentDraftFiles(attachment ? [attachment] : []);
    try {
      const result = await submit(attachment ? [attachment] : []);
      if (shouldClearDraft(result) && draftRef.current === draft) clearAttachment();
      return result;
    } finally {
      releaseSubmission();
    }
  }, [clearAttachment]);

  return {
    draftAttachment,
    readyAttachments,
    withAttachmentSubmission,
    hasAttachment: Boolean(draftAttachment),
    hasFailedAttachment: draftAttachment?.status === 'failed',
    isPreparingAttachment:
      draftAttachment?.status === 'preparing' ||
      draftAttachment?.status === 'persisting' ||
      draftAttachment?.status === 'parsing',
    selectImageAttachment,
    capturePhotoAttachment,
    selectDocumentAttachment,
    clearAttachment,
    removeAttachment: clearAttachment,
  };
}

export default useAttachmentDraft;
