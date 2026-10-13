/** 提供“本地伴随”的正式设置入口。悬浮交互与系统访问由独立页面拥有。 */

import { Ionicons } from '@expo/vector-icons';
import { getAssistantDisplayName,
  appointHostAIAssistant,
  type AIAssistantSummary,
  clearHostAIAppointmentCooldownForDevelopment,
  getHostAICooldownStatus,
  listAIAssistantSummaries,
} from '@features/assistants';
import { ThemedSurface, useTheme, useThemedStyles } from '@shared/theme';
import { AIAvatar, AIInfoCard, Button, ModalSheet, ToggleField, showAppDialog } from '@shared/ui';
import NavigationHeader from '@shared/ui/NavigationHeader';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, InteractionManager, RefreshControl, ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  activateCompanionProductState,
  CompanionError,
  disableCompanionProductState,
  getCompanionNotificationDiagnostics,
  loadCompanionProductState,
  normalizeCompanionErrorCode,
  requestCompanionNotificationPermission,
  resolveCompanionErrorMessage,
  updateCompanionProductSettings,
} from '../application';
import type {
  CompanionActivationStatus,
} from '../domain/CompanionState';
import type { CompanionSettings } from '../domain/CompanionSettings';
import {
  QuietHoursWheel,
} from './CompanionControls';

import { createStyles } from './CompanionSettingsShared.styles';

interface CompanionSettingsScreenProps {
  onBack: () => void;
  onOpenScreen: (screen: CompanionSettingsSubScreen) => void;
  refreshRevision?: number;
}

export type CompanionSettingsSubScreen = 'proactive-life' | 'blacklist';
type CompanionActivationStage =
  | 'preconditions'
  | 'activation';

export default function CompanionSettingsScreen({
  onBack,
  onOpenScreen,
  refreshRevision = 0,
}: CompanionSettingsScreenProps) {
  const theme = useTheme();
  const styles = useThemedStyles(createStyles);
  const hasLoadedRef = useRef(false);
  const previousRefreshRevisionRef = useRef(refreshRevision);
  const activationFlowActiveRef = useRef(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [hostAI, setHostAI] = useState<AIAssistantSummary | null>(null);
  const [assistantCandidates, setAssistantCandidates] = useState<AIAssistantSummary[]>([]);
  const [hostPickerLoading, setHostPickerLoading] = useState(false);
  const [settings, setSettings] = useState<CompanionSettings | null>(null);
  const [toggleState, setToggleState] = useState<CompanionActivationStatus>('disabled');
  const [showHostPicker, setShowHostPicker] = useState(false);
  const [showQuietHours, setShowQuietHours] = useState(false);
  const [quietDraft, setQuietDraft] = useState<{ start: number; end: number } | null>(null);
  const [cooldown, setCooldown] = useState<Awaited<ReturnType<typeof getHostAICooldownStatus>> | null>(null);
  const [clearingHostCooldown, setClearingHostCooldown] = useState(false);

  const expanded = toggleState === 'enabled';
  const transitioning = toggleState === 'enabling' || toggleState === 'disabling';
  const toggleEnabled = toggleState === 'enabled' || toggleState === 'enabling';

  const refresh = useCallback(async () => {
    setRefreshing(hasLoadedRef.current);
    try {
      const product = await loadCompanionProductState();
      const nextCooldown = __DEV__ && !product.hostAI
        ? await getHostAICooldownStatus()
        : null;
      setHostAI(product.hostAI);
      setCooldown(nextCooldown);
      setSettings(product.settings);
      if (product.state.activationStatus === 'paused_error') {
        await disableCompanionProductState({
          failureCode: normalizeFailureCode(product.state.lastFailureCode),
        });
        setToggleState('disabled');
      } else {
        setToggleState(product.state.activationStatus);
      }
      setErrorMessage(resolveCompanionErrorMessage(product.state.lastFailureCode));
    } catch (error) {
      setErrorMessage(toMessage(error, '无法读取本地伴随状态。'));
    } finally {
      hasLoadedRef.current = true;
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  const openHostPicker = useCallback(async () => {
    setHostPickerLoading(true);
    setShowHostPicker(true);
    try {
      setAssistantCandidates(await listAIAssistantSummaries());
    } catch (error) {
      setErrorMessage(toMessage(error, '无法读取 AI 列表。'));
    } finally {
      setHostPickerLoading(false);
    }
  }, []);

  useEffect(() => {
    const task = InteractionManager.runAfterInteractions(() => { void refresh(); });
    return () => task.cancel();
  }, [refresh]);
  useEffect(() => {
    if (previousRefreshRevisionRef.current === refreshRevision) return;
    previousRefreshRevisionRef.current = refreshRevision;
    if (hasLoadedRef.current) void refresh();
  }, [refresh, refreshRevision]);

  const disableCompanion = useCallback(async () => {
    setToggleState('disabling');
    setBusy(true);
    try {
      await disableCompanionProductState();
      setToggleState('disabled');
      setErrorMessage(null);
    } catch (error) {
      setToggleState('disabled');
      setErrorMessage(toMessage(error, '关闭伴随模式失败。'));
    } finally {
      setBusy(false);
    }
  }, []);

  const enableCompanion = useCallback(async () => {
    if (!hostAI) {
      setShowHostPicker(true);
      return;
    }
    if (activationFlowActiveRef.current) return;
    activationFlowActiveRef.current = true;
    setToggleState('enabling');
    setBusy(true);
    setErrorMessage(null);
    let activationStage: CompanionActivationStage = 'preconditions';
    try {
      const notification = await getCompanionNotificationDiagnostics();
      if (!notification.postNotificationsGranted || !notification.notificationsEnabled) {
        if (!await requestCompanionNotificationPermission()) {
          throw new CompanionError('notification_permission_missing');
        }
      }
      const availableNotification = await getCompanionNotificationDiagnostics();
      if (
        !availableNotification.postNotificationsGranted
        || !availableNotification.notificationsEnabled
        || availableNotification.channelImportance <= 0
      ) {
        throw new CompanionError('notification_permission_missing');
      }
      if (!hostAI.canonicalConversationId) {
        throw new CompanionError('host_ai_session_missing');
      }
      activationStage = 'activation';
      await activateCompanionProductState(hostAI.id);
      setToggleState('enabled');
    } catch (error) {
      const failure = classifyCompanionActivationError(error);
      console.error('[RavenCatCompanionActivation] 开启失败', {
        stage: activationStage,
        code: failure.code,
        message: redactActivationErrorMessage(failure.message),
      });
      if (activationStage !== 'activation') {
        await disableCompanionProductState({
          failureCode: failure.code,
        }).catch(() => undefined);
      }
      setToggleState('disabled');
      setErrorMessage(resolveCompanionErrorMessage(failure.code));
    } finally {
      activationFlowActiveRef.current = false;
      setBusy(false);
    }
  }, [hostAI]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        void refresh();
      }
    });
    return () => subscription.remove();
  }, [refresh]);

  const chooseHost = useCallback((assistant: AIAssistantSummary) => {
    if (assistant.isBlocked || !assistant.model.trim()) return;
    showAppDialog({
      title: `确定让「${getAssistantDisplayName(assistant)}」成为你的主理 AI 吗？`,
      message: '主理 AI 是你唯一的长期关系核心，也是 RavenCat 中权限最高的 AI：\n• 同一时间只能有一位主理 AI；\n• 本地伴随完全由主理 AI 负责；\n• 主理 AI 会参与长期记忆与其他 AI 的管理；\n• 在你另行授予相关系统权限后，主理 AI 可以使用设备控制能力；任命本身不会自动授予 Android 系统权限；\n• 主理 AI 身份可以随时撤销；撤销后 7 天内不能重新任命任何 AI；\n• 更换主理 AI 会停止当前伴随模式，并废弃原来的伴随安排。\n\n请谨慎确认，这是你真正希望建立深层关系的 AI。',
      buttons: [
        { text: '再想想', style: 'cancel' },
        {
          text: '确认建立关系',
          onPress: () => void (async () => {
            try {
              const cooldown = await getHostAICooldownStatus();
              if (cooldown.appointment.isInCooldown) {
                throw new Error(`撤销主理 AI 后仍需等待 ${cooldown.appointment.remainingDays} 天`);
              }
              await appointHostAIAssistant(assistant.id);
              setShowHostPicker(false);
              await refresh();
            } catch (error) {
              setErrorMessage(toMessage(error, '主理 AI 任命失败。'));
            }
          })(),
        },
      ],
    });
  }, [refresh]);

  const clearHostCooldown = useCallback(() => {
    showAppDialog({
      title: '清除主理 AI 冷静期？',
      message: '只影响当前开发设备，正式构建中的七天规则不会改变。',
      buttons: [
        { text: '取消', style: 'cancel' },
        {
          text: '清除并继续测试',
          onPress: () => {
            setClearingHostCooldown(true);
            void clearHostAIAppointmentCooldownForDevelopment()
              .then(async () => {
                await refresh();
                showAppDialog({ title: '已清除', message: '现在可以重新任命主理 AI 继续测试。' });
              })
              .catch((error: unknown) => {
                showAppDialog({
                  title: '清除失败',
                  message: error instanceof Error ? error.message : '发生了未知错误。', tone: 'error',
                });
              })
              .finally(() => setClearingHostCooldown(false));
          },
        },
      ],
    });
  }, [refresh]);

  const updateQuietHoursEnabled = useCallback(async (value: boolean) => {
    if (!settings || busy) return;
    setBusy(true);
    try {
      setSettings(await updateCompanionProductSettings({ quietHoursEnabled: value }));
    } catch (error) {
      setErrorMessage(toMessage(error, '勿扰开关保存失败。'));
    } finally {
      setBusy(false);
    }
  }, [busy, settings]);

  const saveQuietHours = useCallback(async () => {
    if (!quietDraft || quietDraft.start === quietDraft.end) {
      setErrorMessage('勿扰开始时间和结束时间不能相同。');
      return;
    }
    setBusy(true);
    try {
      setSettings(await updateCompanionProductSettings({
        quietHoursStartMinutes: quietDraft.start,
        quietHoursEndMinutes: quietDraft.end,
      }));
      setShowQuietHours(false);
    } catch (error) {
      setErrorMessage(toMessage(error, '勿扰时段保存失败。'));
    } finally {
      setBusy(false);
    }
  }, [quietDraft]);

  if (loading) {
    return (
      <SafeAreaView style={styles.screenContainer} edges={['top', 'left', 'right']}>
        <NavigationHeader title="本地伴随" onGoBack={onBack} />
        <View style={styles.loading}><ActivityIndicator color={theme.colors.brand.primary} /><Text style={styles.muted}>正在读取伴随状态…</Text></View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.screenContainer} edges={['top', 'left', 'right']}>
      <NavigationHeader title="本地伴随" onGoBack={onBack} />
      <ScrollView
        style={styles.scrollView}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} />}
      >
        <SectionTitle text="主理 AI" styles={styles} />
        <TouchableOpacity style={styles.hostCard} onPress={() => { if (!hostAI) void openHostPicker(); }} accessibilityRole="button">
          {hostAI ? (
            <AIInfoCard
              name={getAssistantDisplayName(hostAI)}
              model={hostAI.model}
              avatarUrl={hostAI.avatar}
              size="large"
              style={styles.hostInfoCard}
            />
          ) : (
            <>
              <View style={styles.placeholderAvatar}><Ionicons name="person-add-outline" size={28} color={theme.colors.brand.primary} /></View>
              <View style={styles.hostMeta}><Text style={styles.hostName}>待选择主理 AI</Text><Text style={styles.hostHint}>选择唯一的深层关系对象</Text></View>
            </>
          )}
          {!hostAI ? <Ionicons name="chevron-forward" size={20} color={theme.colors.text.tertiary} /> : null}
        </TouchableOpacity>

        {__DEV__ && !hostAI && cooldown?.appointment.isInCooldown ? (
          <ThemedSurface variant="card" style={[styles.card, styles.developmentCard]}>
            <View style={styles.cardContent}>
              <Text style={styles.settingLabel}>开发关系工具</Text>
              <Text style={[styles.settingHint, styles.developmentDescription]}>
                主理 AI 任命冷静期还剩 {cooldown.appointment.remainingDays} 天，仅用于本机开发测试。
              </Text>
              <Button
                title={clearingHostCooldown ? '正在清除...' : '清除主理 AI 冷静期'}
                variant="outline"
                onPress={clearHostCooldown}
                disabled={clearingHostCooldown}
                style={styles.developmentButton}
              />
            </View>
          </ThemedSurface>
        ) : null}

        <SectionTitle text="伴随模式" styles={styles} />
        <ThemedSurface variant="card" style={styles.card}>
          <View style={styles.cardContent}>
            <ToggleField label="伴随模式" hint={toggleHint(toggleState, hostAI !== null)} value={toggleEnabled} onValueChange={(value) => void (value ? enableCompanion() : disableCompanion())} disabled={busy || !hostAI} />
            {transitioning ? <View style={styles.progressRow}><ActivityIndicator size="small" color={theme.colors.brand.primary} /><Text style={styles.progressText}>{toggleState === 'enabling' ? '正在开启…' : '正在关闭…'}</Text></View> : null}
            {toggleState === 'enabling' ? <Button title="取消开启" variant="outline" onPress={() => void disableCompanion()} /> : null}
          </View>
        </ThemedSurface>

        {errorMessage ? <View style={styles.errorCard}><Text style={styles.errorText}>{errorMessage}</Text>{toggleState === 'disabled' ? <><Text style={styles.errorText}>伴随模式当前为关闭状态，不会在后台自动重试。</Text><View style={styles.errorActions}><Button title="重新开启" variant="outline" onPress={() => void enableCompanion()} /></View></> : null}</View> : null}

        {expanded && settings ? <>
          <SectionTitle text="伴随设置" styles={styles} />
          <ThemedSurface variant="card" style={styles.card}>
            <View style={styles.cardContent}>
              <TouchableOpacity style={styles.settingRow} onPress={() => { setQuietDraft({ start: settings.quietHoursStartMinutes, end: settings.quietHoursEndMinutes }); setShowQuietHours(true); }} accessibilityRole="button">
                <View><Text style={styles.settingLabel}>勿扰时段</Text><Text style={styles.settingHint}>{settings.quietHoursEnabled ? '告诉主理 AI 你通常希望安静的时段' : '当前未提供勿扰偏好'}</Text></View><Text style={styles.settingValue}>{formatTime(settings.quietHoursStartMinutes)}–{formatTime(settings.quietHoursEndMinutes)}</Text>
              </TouchableOpacity>
              <ToggleField label="启用勿扰" hint="用于表达你通常希望安静的时段" value={settings.quietHoursEnabled} onValueChange={(value) => void updateQuietHoursEnabled(value)} disabled={busy} />
            </View>
          </ThemedSurface>

          <TouchableOpacity style={styles.entryCard} onPress={() => onOpenScreen('proactive-life')} accessibilityRole="button"><View><Text style={styles.entryTitle}>主动生活</Text><Text style={styles.entryHint}>查看自主醒来、AI 日程与历史活动</Text></View><Ionicons name="chevron-forward" size={20} color={theme.colors.text.tertiary} /></TouchableOpacity>
          <TouchableOpacity style={styles.entryCard} onPress={() => onOpenScreen('blacklist')}><View><Text style={styles.entryTitle}>窥屏黑名单</Text><Text style={styles.entryHint}>{`已选择 ${settings.userScreenCaptureBlacklist.length} 个应用 · 系统保护固定开启`}</Text></View><Ionicons name="chevron-forward" size={20} color={theme.colors.text.tertiary} /></TouchableOpacity>
        </> : null}
        <View style={styles.bottomGap} />
      </ScrollView>

      <ModalSheet visible={showHostPicker} onClose={() => setShowHostPicker(false)} title="选择主理 AI">
        {hostPickerLoading ? <ActivityIndicator color={theme.colors.brand.primary} /> : null}
        <ScrollView style={styles.pickerList}>{assistantCandidates.map((assistant) => {
          const reason = assistant.isBlocked ? '当前已被限制' : !assistant.model.trim() ? '没有可用聊天模型' : assistant.model;
          const disabled = assistant.isBlocked || !assistant.model.trim();
          return <TouchableOpacity key={assistant.id} style={[styles.pickerItem, disabled ? styles.disabledItem : null]} disabled={disabled} onPress={() => chooseHost(assistant)}><AIAvatar name={getAssistantDisplayName(assistant)} avatarUrl={assistant.avatar} size="medium" /><View style={styles.hostMeta}><Text style={styles.hostName}>{getAssistantDisplayName(assistant)}</Text><Text style={styles.hostHint}>{reason}</Text></View></TouchableOpacity>;
        })}</ScrollView>
      </ModalSheet>

      <ModalSheet visible={showQuietHours} onClose={() => setShowQuietHours(false)} title="勿扰时段">
        {quietDraft ? <View style={styles.timeSheet}><View style={styles.quietWheels}><QuietHoursWheel label="开始" value={quietDraft.start} onChange={(start) => setQuietDraft({ ...quietDraft, start })} /><QuietHoursWheel label="结束" value={quietDraft.end} onChange={(end) => setQuietDraft({ ...quietDraft, end })} /></View><Text style={styles.timeHint}>上下滑动选择时间，支持跨午夜。</Text><Button title="保存" onPress={() => void saveQuietHours()} disabled={busy || quietDraft.start === quietDraft.end} /></View> : null}
      </ModalSheet>
    </SafeAreaView>
  );
}

function SectionTitle({ text, styles }: { text: string; styles: ReturnType<typeof createStyles> }) { return <Text style={styles.sectionTitle}>{text}</Text>; }

function toggleHint(state: CompanionActivationStatus, hasHost: boolean): string {
  if (!hasHost) return '选择主理 AI 后才能开启。';
  if (state === 'enabling') return '正在开启本地伴随。';
  return '由主理 AI 自主决定何时以及如何联系你。';
}

function formatTime(minutes: number): string { return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`; }
function toMessage(error: unknown, fallback: string): string { return error instanceof Error ? error.message : fallback; }
function normalizeFailureCode(code: string | null) {
  return normalizeCompanionErrorCode(code);
}

function classifyCompanionActivationError(
  error: unknown,
): CompanionError {
  if (error instanceof CompanionError) return error;
  const message = error instanceof Error ? error.message : String(error || '');
  return new CompanionError('database_unavailable', message || undefined, error);
}

function redactActivationErrorMessage(message: string): string {
  return message
    .replace(/(api[_ -]?key\s*[:=]\s*)\S+/gi, '$1[已隐藏]')
    .slice(0, 500);
}
