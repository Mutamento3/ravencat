/** 对话资料与上下文按字段自动保存；头像、聊天及通话背景保留独立所有权。 */

import { showAppDialog } from '@shared/ui';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAutoSaveDraft, useAutoSaveNavigation } from '@shared/ui/useAutoSaveDraft';
import { getChatSettingsDraft, parseChatSettingsDraft, type ContextLimitsDraft } from './chatSettingsDraft';

import * as ImagePicker from 'expo-image-picker';

import type { AIProfile } from '@features/assistants';
import {
  getAIAssistantById,
  updateAIAssistantAvatarFromDraft,
  updateAIAssistantSettings,
} from '@features/assistants';
import {
  clearCallBackground,
  loadCallBackgroundUri,
  setCustomCallBackground,
} from '@features/calls';
import {
  PERSISTENT_IMAGE_CATEGORY,
  pickCroppedImage,
  usePersistentAvatarDraft,
} from '@platform/device/DeviceMediaService';

interface UseChatSettingsParams {
  aiAssistant: AIProfile;
  onBack?: (updatedAI?: Partial<AIProfile>) => void;
  onUpdated?: (updatedAI: Partial<AIProfile>) => void;
}

export default function useChatSettings({
  aiAssistant,
  onBack,
  onUpdated,
}: UseChatSettingsParams) {
  const [callBackgroundUri, setCallBackgroundUri] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [avatarError, setAvatarError] = useState<string | null>(null);
  const avatarDirty = useRef(false);
  const avatarOperation = useRef<Promise<void> | null>(null);
  const initialInfo = useMemo(() => getChatSettingsDraft(aiAssistant), [aiAssistant]);
  const infoEditor = useAutoSaveDraft({
    initial: initialInfo,
    parse: parseChatSettingsDraft,
    save: async (patch) => {
      const updated = await updateAIAssistantSettings(aiAssistant.id, patch);
      if (!updated) throw new Error('AI 助手不存在');
      onUpdated?.(patch);
    },
  });
  const { flush: flushInfo, restore: restoreInfoDraft } = infoEditor;
  const {
    avatarUri: avatarUrl, isPickingAvatar, isCommittingAvatar,
    pickAvatar, resetAvatar, discardAvatarDraft, commitAvatar,
  } = usePersistentAvatarDraft({
    category: PERSISTENT_IMAGE_CATEGORY.aiAvatar,
    entityId: aiAssistant.id,
    committedUri: aiAssistant.avatar,
  });

  const saveAvatar = useCallback(async () => {
    const persisted = await commitAvatar(async (uri, draft) => {
      if (draft) return updateAIAssistantAvatarFromDraft(aiAssistant.id, draft);
      const updated = await updateAIAssistantSettings(aiAssistant.id, { avatar: uri, avatarMediaAssetId: null });
      if (!updated) throw new Error('AI 助手不存在');
      const assistant = await getAIAssistantById(aiAssistant.id);
      if (!assistant) throw new Error('保存后的 AI 助手不存在');
      return assistant;
    }, (assistant) => assistant.avatar);
    avatarDirty.current = false;
    setAvatarError(null);
    onUpdated?.({ avatar: persisted.avatar, avatarMediaAssetId: persisted.avatarMediaAssetId, updatedAt: persisted.updatedAt });
  }, [aiAssistant.id, commitAvatar, onUpdated]);

  // 文件草稿由头像 hook 持有，失败时不丢弃；页面返回等待选择及提交结束。
  const runAvatarOperation = useCallback((operation: () => Promise<void>) => {
    if (avatarOperation.current) return avatarOperation.current;
    const pending = operation().catch((error: unknown) => {
      console.error('[对话设置] 头像操作失败', error);
      setAvatarError('头像修改未能完成，已选择的图片会保留，请重试。');
    }).finally(() => { avatarOperation.current = null; });
    avatarOperation.current = pending;
    return pending;
  }, []);

  const handlePickAvatar = useCallback(() => runAvatarOperation(async () => {
    const result = await pickAvatar();
    if (result.status === 'permission-denied') {
      showAppDialog({ title: '需要权限', message: '请允许访问相册以选择头像', tone: 'warning' });
      return;
    }
    if (result.status !== 'selected') return;
    avatarDirty.current = true;
    await saveAvatar();
  }), [pickAvatar, runAvatarOperation, saveAvatar]);

  const handleResetAvatar = useCallback(() => {
    showAppDialog({ title: '恢复默认头像', message: '确定要移除当前自定义头像吗？', buttons: [
      { text: '取消', style: 'cancel' },
      { text: '恢复默认', onPress: () => void runAvatarOperation(async () => {
        if (!await resetAvatar()) return;
        avatarDirty.current = true;
        await saveAvatar();
      }) },
    ] });
  }, [resetAvatar, runAvatarOperation, saveAvatar]);

  const handleAvatarPress = useCallback(() => {
    if (isPickingAvatar || isCommittingAvatar) return;
    showAppDialog({ title: 'AI 头像', message: '你可以为这个 AI 更换头像，或恢复默认头像。', buttons: [
      { text: '取消', style: 'cancel' },
      { text: '恢复默认', onPress: handleResetAvatar },
      { text: '从相册选择', onPress: () => void handlePickAvatar() },
    ] });
  }, [handlePickAvatar, handleResetAvatar, isPickingAvatar, isCommittingAvatar]);

  const flush = useCallback(async () => {
    if (avatarOperation.current) await avatarOperation.current;
    const infoSaved = await flushInfo();
    return infoSaved && avatarOperation.current === null && !avatarDirty.current;
  }, [flushInfo]);
  const { back, leave } = useAutoSaveNavigation(flush, () => onBack?.(), () => setBlocked(true));
  const restoreInfo = useCallback(async () => {
    await restoreInfoDraft();
    setBlocked(false);
  }, [restoreInfoDraft]);
  const restoreAvatar = useCallback(async () => {
    if (avatarOperation.current) await avatarOperation.current;
    await runAvatarOperation(async () => {
      await discardAvatarDraft();
      avatarDirty.current = false;
      setAvatarError(null);
    });
  }, [discardAvatarDraft, runAvatarOperation]);
  const retryAvatar = useCallback(() => {
    if (avatarDirty.current) void runAvatarOperation(saveAvatar);
    else void handlePickAvatar();
  }, [handlePickAvatar, runAvatarOperation, saveAvatar]);

  useEffect(() => {
    let active = true;
    setCallBackgroundUri(null);
    void loadCallBackgroundUri(aiAssistant.id)
      .then((storedUri) => { if (active) setCallBackgroundUri(storedUri); })
      .catch((error) => {
        console.warn('[useChatSettings] Failed to load call background:', error);
      });
    return () => { active = false; };
  }, [aiAssistant.id]);

  const handlePickCallBackground = useCallback(async () => {
    try {
      setIsLoading(true);

      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        showAppDialog({ title: '需要权限', message: '请允许访问相册以选择通话背景', tone: 'warning' });
        return;
      }

      const asset = await pickCroppedImage({ aspect: 'screen' });
      if (!asset) return;

      const persistedUri = await setCustomCallBackground({
        assistantId: aiAssistant.id,
        sourceUri: asset.uri,
        sourceWidth: asset.width ?? null,
      });
      setCallBackgroundUri(persistedUri);
      showAppDialog({ title: '成功', message: '通话背景已更新', tone: 'success' });
    } catch (error) {
      console.error('Failed to pick call background:', error);
      showAppDialog({ title: '错误', message: '更换通话背景失败，请稍后重试', tone: 'error' });
    } finally {
      setIsLoading(false);
    }
  }, [aiAssistant.id]);

  const handleClearCallBackground = useCallback(() => {
    showAppDialog({ title: '恢复默认通话背景', message: '确定要移除这个 AI 的自定义通话背景吗？', buttons: [
      { text: '取消', style: 'cancel' },
      {
        text: '恢复默认',
        onPress: async () => {
          try {
            await clearCallBackground(aiAssistant.id);
            setCallBackgroundUri(null);
            showAppDialog({ title: '成功', message: '已恢复默认通话背景', tone: 'success' });
          } catch (error) {
            console.error('Failed to clear call background:', error);
            showAppDialog({ title: '错误', message: '恢复默认通话背景失败', tone: 'error' });
          }
        },
      },
    ] });
  }, [aiAssistant.id]);

  return {
    name: infoEditor.draft.name,
    setName: (name: string) => infoEditor.change({ name }),
    nickname: infoEditor.draft.nickname,
    setNickname: (nickname: string) => infoEditor.change({ nickname }),
    nicknameError: infoEditor.errors.nickname,
    systemPrompt: infoEditor.draft.systemPrompt,
    setSystemPrompt: (systemPrompt: string) => infoEditor.change({ systemPrompt }),
    nameError: infoEditor.errors.name,
    settingsErrors: infoEditor.errors,
    contextLimits: {
      privatePrimary: infoEditor.draft.privatePrimary, privateSecondary: infoEditor.draft.privateSecondary,
      groupPrimary: infoEditor.draft.groupPrimary, groupSecondary: infoEditor.draft.groupSecondary,
    },
    handleContextLimitChange: (field: keyof ContextLimitsDraft, value: string) => infoEditor.change({ [field]: value }),
    allowMultipleBubbles: infoEditor.draft.allowMultipleBubbles,
    setAllowMultipleBubbles: (allowMultipleBubbles: boolean) => infoEditor.change({ allowMultipleBubbles }, true),
    showTokenUsage: infoEditor.draft.showTokenUsage,
    setShowTokenUsage: (showTokenUsage: boolean) => infoEditor.change({ showTokenUsage }, true),
    infoSaveError: infoEditor.saveError,
    avatarError, blocked, flush, back, leave, restoreInfo, restoreAvatar, retryAvatar,
    avatarUrl,
    callBackgroundUri,
    isLoading: isLoading || isPickingAvatar || isCommittingAvatar,
    handleAvatarPress,
    handlePickCallBackground,
    handleClearCallBackground,
  };
}
