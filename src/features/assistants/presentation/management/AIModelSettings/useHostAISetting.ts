/** 管理模型设置页面中的主理 AI 查询、任命与撤销状态。 */
import { getAssistantDisplayName } from '../../../AssistantNickname';
import { createHostAIAppointmentDialog } from '../../HostAIAppointmentDialog';

import { showAppDialog, type AppDialogButton, type AppDialogTone } from '@shared/ui';
import { useCallback, useEffect, useState } from 'react';

import type { AIProfile } from '../../../domain/AIProfile';
import {
  appointHostAIAssistant,
  getHostAIAssistant,
  getHostAICooldownStatus,
  revokeHostAIAssistant,
} from '../../../AIAssistantManagement';

interface UseHostAISettingProps {
  aiAssistant: AIProfile;
  onUpdated?: (updatedAI: Partial<AIProfile>) => void;
  onShowAlert?: (title: string, message: string, buttons?: AppDialogButton[], tone?: AppDialogTone) => void;
}

interface HostCooldownInfo {
  canSetHost: boolean;
  cooldownRemainingDays: number;
}

interface HostStatus {
  currentHostAI: AIProfile | null;
  cooldownInfo: HostCooldownInfo;
}

export interface UseHostAISettingReturn {
  isHostAI: boolean;
  isCheckingHost: boolean;
  isChangingHost: boolean;
  handleHostAIToggle: (value: boolean) => Promise<void>;
}

export default function useHostAISetting({
  aiAssistant,
  onUpdated,
  onShowAlert,
}: UseHostAISettingProps): UseHostAISettingReturn {
  const [isHostAI, setIsHostAI] = useState(Boolean(aiAssistant.isHostAI));
  const [isCheckingHost, setIsCheckingHost] = useState(true);
  const [isChangingHost, setIsChangingHost] = useState(false);
  const [currentHostAI, setCurrentHostAI] = useState<AIProfile | null>(null);
  const [cooldownInfo, setCooldownInfo] = useState<HostCooldownInfo | null>(null);

  const showAlert = useCallback((title: string, message: string, buttons?: AppDialogButton[], tone: AppDialogTone = 'info') => {
    if (onShowAlert) {
      onShowAlert(title, message, buttons, tone);
      return;
    }
    showAppDialog({ title, message, buttons, tone });
  }, [onShowAlert]);

  const checkHostStatus = useCallback(async (): Promise<HostStatus | null> => {
    setIsCheckingHost(true);
    try {
      const [latestHostAI, latestCooldown] = await Promise.all([
        getHostAIAssistant(),
        getHostAICooldownStatus(),
      ]);
      const nextCooldownInfo = {
        canSetHost: !latestCooldown.appointment.isInCooldown,
        cooldownRemainingDays: latestCooldown.appointment.remainingDays,
      };
      setCurrentHostAI(latestHostAI);
      setCooldownInfo(nextCooldownInfo);
      setIsHostAI(latestHostAI?.id === aiAssistant.id);
      return {
        currentHostAI: latestHostAI,
        cooldownInfo: nextCooldownInfo,
      };
    } catch (error) {
      console.error('Failed to check host status:', error);
      return null;
    } finally {
      setIsCheckingHost(false);
    }
  }, [aiAssistant.id]);

  useEffect(() => {
    setIsHostAI(Boolean(aiAssistant.isHostAI));
    setCurrentHostAI(null);
    setCooldownInfo(null);
    void checkHostStatus();
  }, [aiAssistant.id, aiAssistant.isHostAI, checkHostStatus]);

  const handleHostAIToggle = useCallback(async (value: boolean) => {
    if (isCheckingHost || isChangingHost) {
      return;
    }

    let latestHostAI = currentHostAI;
    let latestCooldownInfo = cooldownInfo;
    if (!latestCooldownInfo) {
      const hostStatus = await checkHostStatus();
      if (!hostStatus) {
        showAlert('错误', '检查状态失败，请稍后重试', undefined, 'error');
        return;
      }
      latestHostAI = hostStatus.currentHostAI;
      latestCooldownInfo = hostStatus.cooldownInfo;
    }

    if (value) {
      if (latestHostAI && latestHostAI.id !== aiAssistant.id) {
        showAlert(
          '无法任命',
          `当前已有主理 AI「${getAssistantDisplayName(latestHostAI)}」，请先撤销其身份后再任命新的主理 AI。`, undefined, 'warning'
        );
        return;
      }

      if (
        latestCooldownInfo
        && latestCooldownInfo.canSetHost === false
        && latestCooldownInfo.cooldownRemainingDays > 0
      ) {
        showAlert(
          '冷静期中',
          `刚撤销主理 AI，需要等待 ${latestCooldownInfo.cooldownRemainingDays} 天后才能任命新的主理 AI。`
        );
        return;
      }

      const dialog = createHostAIAppointmentDialog(
        getAssistantDisplayName(aiAssistant),
        async () => {
          try {
            setIsChangingHost(true);
            await appointHostAIAssistant(aiAssistant.id);
            setIsHostAI(true);
            onUpdated?.({ id: aiAssistant.id, isHostAI: true });
            showAlert('成功', `「${getAssistantDisplayName(aiAssistant)}」已被设置为主理 AI`, undefined, 'success');
            await checkHostStatus();
          } catch (error) {
            console.error('Failed to set host AI:', error);
            showAlert('错误', '设置主理 AI 失败', undefined, 'error');
            setIsHostAI(false);
          } finally {
            setIsChangingHost(false);
          }
        },
      );
      showAlert(dialog.title, dialog.message, dialog.buttons);
      return;
    }

    showAlert(
      '撤销主理 AI',
      `确定要取消「${getAssistantDisplayName(aiAssistant)}」的主理 AI 身份吗？\n\n该 AI 将失去主理 AI 专属权限，本地伴随会停止，原来的未来日程会废弃，历史记录保留。\n\n撤销后 7 天内不能重新任命任何 AI。`,
      [
        { text: '取消', style: 'cancel' },
        {
          text: '确定',
          style: 'destructive',
          onPress: async () => {
            try {
              setIsChangingHost(true);
              await revokeHostAIAssistant(aiAssistant.id);
              setIsHostAI(false);
              onUpdated?.({ id: aiAssistant.id, isHostAI: false });
              showAlert('成功', `「${getAssistantDisplayName(aiAssistant)}」的主理 AI 身份已取消`, undefined, 'success');
              await checkHostStatus();
            } catch (error) {
              console.error('Failed to revoke host AI:', error);
              showAlert('错误', '撤销主理 AI 失败', undefined, 'error');
              setIsHostAI(true);
            } finally {
              setIsChangingHost(false);
            }
          },
        },
      ]
    );
  }, [
    aiAssistant,
    checkHostStatus,
    cooldownInfo,
    currentHostAI,
    isChangingHost,
    isCheckingHost,
    onUpdated,
    showAlert,
  ]);

  return {
    isHostAI,
    isCheckingHost,
    isChangingHost,
    handleHostAIToggle,
  };
}
