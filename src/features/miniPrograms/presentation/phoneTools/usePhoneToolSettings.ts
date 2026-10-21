/** 手机目录与提示词中心共用 Prompting 的调用权限，不维护第二份手机开关。 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import {
  getAssistantToolPermissions,
  listPromptAssistantOptions,
  setAssistantToolPermission,
  type AssistantPromptEditorDetails,
  type PromptAssistantOption,
} from '@features/prompting';
import { getDeviceObserverConnectionState, getNotificationListenerAccessState } from '@features/deviceControl';
import { isOverlayPermissionGranted } from '@features/floatingLayer';
import { getDeviceLocationAccessState, isUsageAccessGranted } from '@platform/device';
import { showAppDialog } from '@shared/ui';
import { getPhoneToolReadinessLabel, type PhoneToolSystemAccess } from './ToolPackageDisplayModel';

interface PhoneToolSettingsSnapshot {
  host: PromptAssistantOption | null;
  tools: AssistantPromptEditorDetails['tools'];
  access: PhoneToolSystemAccess;
}

export function usePhoneToolSettings() {
  const [snapshot, setSnapshot] = useState<PhoneToolSettingsSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const revision = useRef(0);
  const savingRef = useRef(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const refresh = useCallback(async () => {
    const currentRevision = ++revision.current;
    try {
      const [assistants, observer, usageAccessGranted, overlayGranted, notificationListener, location] = await Promise.all([
        listPromptAssistantOptions(), getDeviceObserverConnectionState(), isUsageAccessGranted(),
        isOverlayPermissionGranted(), getNotificationListenerAccessState(),
        getDeviceLocationAccessState(),
      ]);
      const host = assistants.find((assistant) => assistant.isHostAI) ?? null;
      const tools = host ? await getAssistantToolPermissions(host.id) : [];
      if (mounted.current && currentRevision === revision.current) {
        setSnapshot({ host, tools, access: {
          observer, usageAccessGranted, overlayGranted, notificationListenerGranted: notificationListener.status === 'granted', location,
        } });
        setError(null);
      }
    } catch (failure) {
      if (mounted.current && currentRevision === revision.current) {
        setSnapshot(null);
        setError(failure instanceof Error ? failure.message : '无法读取手机工具配置');
      }
    }
  }, []);

  useFocusEffect(useCallback(() => {
    void refresh();
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void refresh();
    });
    return () => { subscription.remove(); revision.current++; };
  }, [refresh]));

  async function toggleTool(toolName: string, enabled: boolean) {
    if (!snapshot?.host || savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    try {
      await setAssistantToolPermission(snapshot.host.id, toolName, enabled);
      await refresh();
    } catch (failure) {
      if (mounted.current) showAppDialog({ title: '保存失败', message: failure instanceof Error ? failure.message : '无法保存调用权限' });
    } finally {
      savingRef.current = false;
      if (mounted.current) setSaving(false);
    }
  }

  function isEnabled(toolName: string): boolean {
    return snapshot?.host ? snapshot.tools.find((tool) => tool.name === toolName)!.enabled : false;
  }

  function statusLabel(toolName: string): string {
    if (error) return '状态读取失败';
    if (!snapshot) return '读取中';
    if (!snapshot.host) return '未设置主理 AI';
    return getPhoneToolReadinessLabel(toolName, isEnabled(toolName), snapshot.access);
  }

  return {
    isEnabled, statusLabel, toggleTool, refresh, disabled: !snapshot?.host || saving,
    hostName: snapshot?.host?.name ?? null,
    // 说明文字归标题问号；这里只留读取、失败和缺主理 AI 的临时状态。
    notice: error ? `读取失败：${error}`
      : !snapshot ? '正在读取调用权限与系统状态…'
        : snapshot.host ? null : '请先设置主理 AI，再配置手机工具调用权限。',
  };
}
