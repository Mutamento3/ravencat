/** 管理头像选择后的持久文件草稿；已提交旧头像由 M5 GC 统一回收。 */
import { useCallback, useEffect, useRef, useState } from 'react';
import * as ImagePicker from 'expo-image-picker';
import { pickCroppedImage } from './pickCroppedImage';

import {
  persistentImageStore,
  type PersistentImageCategory,
} from './PersistentImageStore';

export type PickPersistentAvatarResult =
  | { status: 'selected'; uri: string }
  | { status: 'cancelled' }
  | { status: 'permission-denied' }
  | { status: 'busy' };

interface UsePersistentAvatarDraftParams {
  category: PersistentImageCategory;
  /** 同一个 hook 挂载期间 entityId 保持稳定，只用于隔离持久文件名。 */
  entityId: string;
  committedUri?: string | null;
}

export interface PersistentAvatarDraft {
  uri: string;
  fileName: string | null;
  mimeType: string;
  width: number | null;
  height: number | null;
}

const IMAGE_MIME_BY_EXTENSION: Readonly<Record<string, string>> = {
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

function resolvePickedImageMimeType(
  mimeType: string | null | undefined,
  fileName: string | null | undefined,
  uri: string,
): string {
  const normalizedMimeType = mimeType?.trim().toLowerCase();
  if (normalizedMimeType?.startsWith('image/')) {
    return normalizedMimeType;
  }
  const candidate = fileName || uri.split('?')[0].split('#')[0];
  const extension = candidate.match(/\.([a-zA-Z0-9]{2,5})$/)?.[1].toLowerCase();
  const inferred = extension ? IMAGE_MIME_BY_EXTENSION[extension] : null;
  if (!inferred) {
    throw new Error('无法识别所选头像的图片类型');
  }
  return inferred;
}

function normalizeUri(uri?: string | null): string | null {
  const normalized = String(uri || '').trim();
  return normalized || null;
}

async function deleteManagedWithoutBreakingFlow(uri?: string | null): Promise<void> {
  if (!uri) {
    return;
  }

  try {
    await persistentImageStore.deleteManagedIfExists(uri);
  } catch (error) {
    console.warn('[usePersistentAvatarDraft] 清理持久头像失败:', error);
  }
}

export function usePersistentAvatarDraft({
  category,
  entityId,
  committedUri,
}: UsePersistentAvatarDraftParams) {
  const initialCommittedUri = normalizeUri(committedUri);
  const [avatarUri, setAvatarUri] = useState<string | null>(initialCommittedUri);
  const [isPickingAvatar, setIsPickingAvatar] = useState(false);
  const [isCommittingAvatar, setIsCommittingAvatar] = useState(false);
  const avatarUriRef = useRef<string | null>(initialCommittedUri);
  const committedUriRef = useRef<string | null>(initialCommittedUri);
  const draftUriRef = useRef<string | null>(null);
  const draftRef = useRef<PersistentAvatarDraft | null>(null);
  const disposedRef = useRef(false);
  const operationRevisionRef = useRef(0);
  const pickingRef = useRef(false);
  const committingRef = useRef(false);
  const committingDraftUriRef = useRef<string | null>(null);

  const updateAvatarUri = useCallback((uri: string | null) => {
    avatarUriRef.current = uri;
    if (!disposedRef.current) {
      setAvatarUri(uri);
    }
  }, []);

  useEffect(() => {
    const nextCommittedUri = normalizeUri(committedUri);
    committedUriRef.current = nextCommittedUri;
    if (!draftUriRef.current && !committingRef.current) {
      updateAvatarUri(nextCommittedUri);
    }
  }, [committedUri, updateAvatarUri]);

  useEffect(() => {
    disposedRef.current = false;
    return () => {
      disposedRef.current = true;
      operationRevisionRef.current += 1;
      const abandonedDraftUri = draftUriRef.current;
      if (abandonedDraftUri && abandonedDraftUri !== committingDraftUriRef.current) {
        draftUriRef.current = null;
        draftRef.current = null;
        void deleteManagedWithoutBreakingFlow(abandonedDraftUri);
      }
    };
  }, []);

  const pickAvatar = useCallback(async (): Promise<PickPersistentAvatarResult> => {
    if (pickingRef.current || committingRef.current) {
      return { status: 'busy' };
    }

    pickingRef.current = true;
    const operationRevision = operationRevisionRef.current + 1;
    operationRevisionRef.current = operationRevision;
    setIsPickingAvatar(true);
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        return { status: 'permission-denied' };
      }
      if (
        disposedRef.current
        || operationRevision !== operationRevisionRef.current
      ) {
        return { status: 'cancelled' };
      }

      const selectedAsset = await pickCroppedImage({
        quality: 0.8,
        aspect: [1, 1],
      });

      if (!selectedAsset) {
        return { status: 'cancelled' };
      }
      if (
        disposedRef.current
        || operationRevision !== operationRevisionRef.current
      ) {
        return { status: 'cancelled' };
      }

      const sourceUri = selectedAsset.uri;
      const mimeType = resolvePickedImageMimeType(
        selectedAsset.mimeType,
        selectedAsset.fileName,
        sourceUri,
      );

      const persistedUri = await persistentImageStore.copyPickedImageToAppStorage({
        sourceUri,
        category,
        entityId,
      });

      if (
        disposedRef.current
        || operationRevision !== operationRevisionRef.current
      ) {
        await deleteManagedWithoutBreakingFlow(persistedUri);
        return { status: 'cancelled' };
      }

      const replacedDraftUri = draftUriRef.current;
      draftUriRef.current = persistedUri;
      draftRef.current = {
        uri: persistedUri,
        fileName: selectedAsset.fileName || null,
        mimeType,
        width: selectedAsset.width || null,
        height: selectedAsset.height || null,
      };
      updateAvatarUri(persistedUri);

      if (replacedDraftUri && replacedDraftUri !== persistedUri) {
        await deleteManagedWithoutBreakingFlow(replacedDraftUri);
      }

      return { status: 'selected', uri: persistedUri };
    } finally {
      pickingRef.current = false;
      if (!disposedRef.current) {
        setIsPickingAvatar(false);
      }
    }
  }, [category, entityId, updateAvatarUri]);

  const resetAvatar = useCallback(async (): Promise<boolean> => {
    if (pickingRef.current || committingRef.current) {
      return false;
    }

    operationRevisionRef.current += 1;
    const abandonedDraftUri = draftUriRef.current;
    draftUriRef.current = null;
    draftRef.current = null;
    updateAvatarUri(null);
    await deleteManagedWithoutBreakingFlow(abandonedDraftUri);
    return true;
  }, [updateAvatarUri]);

  const discardAvatarDraft = useCallback(async () => {
    if (committingRef.current) {
      return;
    }

    operationRevisionRef.current += 1;
    const abandonedDraftUri = draftUriRef.current;
    draftUriRef.current = null;
    draftRef.current = null;
    updateAvatarUri(committedUriRef.current);
    await deleteManagedWithoutBreakingFlow(abandonedDraftUri);
  }, [updateAvatarUri]);

  const commitAvatar = useCallback(async <Result,>(
    commit: (
      avatarUri: string | null,
      draft: PersistentAvatarDraft | null,
    ) => Promise<Result>,
    committedAvatar?: (result: Result) => string | null,
  ): Promise<Result> => {
    if (pickingRef.current || committingRef.current) {
      throw new Error('头像正在处理中，请稍后再试');
    }

    committingRef.current = true;
    setIsCommittingAvatar(true);
    const acceptedUri = avatarUriRef.current;
    const acceptedDraftUri = draftUriRef.current;
    const acceptedDraft = draftRef.current;
    committingDraftUriRef.current = acceptedDraftUri;

    try {
      const result = await commit(acceptedUri, acceptedDraft);
      const persistedUri = committedAvatar ? committedAvatar(result) : acceptedUri;
      committedUriRef.current = persistedUri;
      if (draftUriRef.current === acceptedDraftUri) {
        draftUriRef.current = null;
        draftRef.current = null;
      }
      updateAvatarUri(persistedUri);
      if (acceptedDraftUri && acceptedDraftUri !== persistedUri) {
        await deleteManagedWithoutBreakingFlow(acceptedDraftUri);
      }
      return result;
    } catch (error) {
      if (disposedRef.current && acceptedDraftUri) {
        if (draftUriRef.current === acceptedDraftUri) {
          draftUriRef.current = null;
          draftRef.current = null;
        }
        await deleteManagedWithoutBreakingFlow(acceptedDraftUri);
      }
      throw error;
    } finally {
      committingDraftUriRef.current = null;
      committingRef.current = false;
      if (!disposedRef.current) {
        setIsCommittingAvatar(false);
      }
    }
  }, [updateAvatarUri]);

  return {
    avatarUri,
    isPickingAvatar,
    isCommittingAvatar,
    pickAvatar,
    resetAvatar,
    discardAvatarDraft,
    commitAvatar,
  };
}
