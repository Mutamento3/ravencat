/** 汇总 RavenCat 当前已经接入的 Android 系统访问与后台运行能力。 */

import { Ionicons } from '@expo/vector-icons';
import { useTheme, useThemedStyles } from '@shared/theme';
import NavigationHeader from '@shared/ui/NavigationHeader';
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  Linking,
  Platform,
  RefreshControl,
  ScrollView,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  getCompanionNotificationDiagnostics,
  requestCompanionNotificationPermission,
} from '../application';
import {
  getIncomingCallDiagnostics,
  openFullScreenIntentSettings,
  openIncomingCallNotificationSettings,
  type IncomingCallDiagnostics,
} from '@features/calls';
import {
  getBatteryOptimizationState,
  isOverlayPermissionGranted,
  openBatteryOptimizationSettings,
  openOverlayPermissionSettings,
  requestIgnoreBatteryOptimizations,
} from '@features/floatingLayer';

import {
  getDeviceObserverConnectionState,
  openDeviceObserverSettings,
  type DeviceObserverConnectionState,
} from '@features/deviceControl';
import { createStyles } from './CompanionSettingsShared.styles';
import { isUsageAccessGranted, openUsageAccessSettings } from '@platform/device';

interface CompanionSystemAccessScreenProps {
  onBack: () => void;
}

interface SystemAccessSnapshot {
  overlayGranted: boolean;
  notificationGranted: boolean;
  fullScreenIntentAllowed: boolean;
  incomingCallChannelEnabled: boolean;
  batteryGranted: boolean;
  usageAccessGranted: boolean;
  observer: DeviceObserverConnectionState;
  incomingCallDiagnostics: IncomingCallDiagnostics;
}

export default function CompanionSystemAccessScreen({ onBack }: CompanionSystemAccessScreenProps) {
  const theme = useTheme();
  const styles = useThemedStyles(createStyles);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [snapshot, setSnapshot] = useState<SystemAccessSnapshot | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const refresh = useCallback(async (pullToRefresh = false) => {
    if (pullToRefresh) setRefreshing(true);
    try {
      const [overlayGranted, notification, battery, observer, incomingCallDiagnostics, usageAccessGranted] =
        await Promise.all([
          isOverlayPermissionGranted(),
          getCompanionNotificationDiagnostics(),
          getBatteryOptimizationState(),
          getDeviceObserverConnectionState(),
          getIncomingCallDiagnostics(),
          isUsageAccessGranted(),
        ]);
      setSnapshot({
        overlayGranted,
        notificationGranted: notification.postNotificationsGranted
          && notification.notificationsEnabled
          && notification.channelImportance > 0,
        fullScreenIntentAllowed: incomingCallDiagnostics.fullScreenIntentAllowed,
        incomingCallChannelEnabled: incomingCallDiagnostics.incomingCallChannelImportance > 0,
        batteryGranted: battery.ignoringBatteryOptimizations,
        usageAccessGranted,
        observer,
        incomingCallDiagnostics,
      });
      setErrorMessage(null);
    } catch (error) {
      setErrorMessage(toMessage(error, '无法读取系统访问状态。'));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void refresh();
    });
    return () => subscription.remove();
  }, [refresh]);

  const openNotificationSettings = useCallback(async () => {
    if (!snapshot?.notificationGranted) {
      await requestCompanionNotificationPermission();
      await refresh();
      return;
    }
    await Linking.openSettings();
  }, [refresh, snapshot?.notificationGranted]);

  const openBackgroundPopupSettings = useCallback(async () => {
    try {
      // 厂商首页并不是本应用的权限页；复用系统应用详情入口，由用户确认不可检测的开关。
      await Linking.openSettings();
    } catch (error) {
      setErrorMessage(toMessage(error, '无法打开本应用的系统设置。'));
    }
  }, []);

  if (loading) {
    return (
      <SafeAreaView style={styles.screenContainer} edges={['top', 'left', 'right']}>
        <NavigationHeader title="权限与后台运行" onGoBack={onBack} />
        <View style={styles.loading}>
          <ActivityIndicator color={theme.colors.brand.primary} />
          <Text style={styles.muted}>正在检查系统访问…</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.screenContainer} edges={['top', 'left', 'right']}>
      <NavigationHeader title="权限与后台运行" onGoBack={onBack} />
      <ScrollView
        style={styles.scrollView}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh(true)} />}
      >
        {errorMessage ? (
          <View style={styles.errorCard}><Text style={styles.errorText}>{errorMessage}</Text></View>
        ) : null}

        {snapshot ? (
          <>
            <Text style={styles.sectionTitle}>必要系统访问</Text>
            <View style={styles.card}>
              <View style={styles.cardContent}>
                <PermissionRow label="通知提醒" value={snapshot.notificationGranted} onPress={() => void openNotificationSettings()} styles={styles} description="用于普通消息、主动联系和后台状态通知。" />
                <PermissionRow label="悬浮显示" value={snapshot.overlayGranted} onPress={() => void openOverlayPermissionSettings()} styles={styles} description="用于悬浮球与快捷聊天。" />
                <PermissionRow label="屏幕内容读取" value={snapshot.observer.accessibilityConnected && snapshot.observer.canRetrieveWindowContent} onPress={() => void openDeviceObserverSettings()} styles={styles} description={observerHint(snapshot.observer)} />
                <PermissionRow label="使用情况访问" value={snapshot.usageAccessGranted} onPress={() => {
                  void openUsageAccessSettings().catch((error: unknown) => setErrorMessage(toMessage(error, '无法打开使用情况访问设置。')));
                }} styles={styles} description="允许主理 AI 按需查询应用前台使用时长。" last />
              </View>
            </View>

            <Text style={styles.sectionTitle}>后台可靠性</Text>
            <View style={styles.card}>
              <View style={styles.cardContent}>
                <PermissionRow label="电池优化" value={snapshot.batteryGranted} onPress={() => void (snapshot.batteryGranted ? openBatteryOptimizationSettings() : requestIgnoreBatteryOptimizations())} styles={styles} description="允许后台运行可减少系统延迟，但不能阻止强制停止或厂商清理。" last />
              </View>
            </View>

            <Text style={styles.sectionTitle}>通话系统访问</Text>
            <View style={styles.card}>
              <View style={styles.cardContent}>
                {Number(Platform.Version) >= 34 ? (
                  <PermissionRow label="全屏来电授权" value={snapshot.fullScreenIntentAllowed} onPress={() => void openFullScreenIntentSettings()} styles={styles} description="允许来电在锁屏或熄屏时弹出；部分手机还需开启下方的后台弹出界面与锁屏显示。" />
                ) : (
                  <DiagnosticRow label="全屏来电授权" value="Android 13 无需单独授权" styles={styles} />
                )}
                <PermissionRow label="来电通知" value={snapshot.incomingCallChannelEnabled} onPress={() => void openIncomingCallNotificationSettings()} styles={styles} description="检查来电通知 Channel、锁屏显示与悬浮通知。" last />
              </View>
            </View>

            <Text style={styles.sectionTitle}>来电诊断</Text>
            <View style={styles.card}>
              <View style={styles.cardContent}>
                <DiagnosticRow label="应用通知总开关" value={snapshot.incomingCallDiagnostics.notificationsEnabled ? '开启' : '关闭'} styles={styles} />
                <DiagnosticRow label="来电 Channel 重要度" value={describeImportance(snapshot.incomingCallDiagnostics.incomingCallChannelImportance)} styles={styles} />
                <DiagnosticRow label="Channel 锁屏可见性" value={describeLockscreenVisibility(snapshot.incomingCallDiagnostics.incomingCallChannelLockscreenVisibility)} styles={styles} />
                <DiagnosticRow label="上次来电发布" value={describeLastPost(snapshot.incomingCallDiagnostics)} styles={styles} last />
              </View>
            </View>
            <TouchableOpacity style={styles.entryCard} onPress={() => void openBackgroundPopupSettings()} accessibilityRole="button">
              <View style={styles.permissionText}>
                <Text style={styles.entryTitle}>后台弹出界面与锁屏显示</Text>
                <Text style={styles.entryHint}>打开本应用的系统设置，在权限管理中人工确认。vivo 需同时允许“后台弹出界面”和“锁屏显示”；这些厂商开关无法可靠检测。</Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color={theme.colors.text.tertiary} />
            </TouchableOpacity>
          </>
        ) : null}
        <View style={styles.bottomGap} />
      </ScrollView>
    </SafeAreaView>
  );
}

function PermissionRow({
  label,
  value,
  onPress,
  description,
  last,
  styles,
}: {
  label: string;
  value: boolean;
  onPress: () => void;
  description: string;
  last?: boolean;
  styles: ReturnType<typeof createStyles>;
}) {
  return (
    <TouchableOpacity style={[styles.permissionRow, last ? styles.lastRow : null]} onPress={onPress} accessibilityRole="button">
      <View style={styles.permissionText}>
        <Text style={styles.permissionLabel}>{label}</Text>
        <Text style={styles.permissionHint}>{description}</Text>
      </View>
      <Text style={[styles.permissionStatus, value ? styles.statusGranted : null]}>
        {value ? '已开启' : '去开启'}
      </Text>
    </TouchableOpacity>
  );
}

function DiagnosticRow({
  label,
  value,
  last,
  styles,
}: {
  label: string;
  value: string;
  last?: boolean;
  styles: ReturnType<typeof createStyles>;
}) {
  return (
    <View style={[styles.settingRow, last ? styles.lastRow : null]}>
      <Text style={styles.settingHint}>{label}</Text>
      <Text style={styles.settingValue}>{value}</Text>
    </View>
  );
}

function observerHint(observer: DeviceObserverConnectionState): string {
  if (!observer.accessibilityEnabled) return '用于 Extract 和看屏幕后联系；当前尚未启用。';
  if (!observer.accessibilityConnected) return '系统已启用，但设备观察服务尚未连接。';
  if (!observer.canRetrieveWindowContent) return '服务已连接，但当前不能读取窗口内容。';
  return '设备观察服务已连接，可读取窗口内容。';
}

function describeImportance(value: number): string {
  if (value >= 4) return '高';
  if (value === 3) return '默认';
  if (value === 2) return '低';
  if (value === 1) return '最低';
  if (value === 0) return '已关闭';
  return `未知(${value})`;
}

function describeLockscreenVisibility(value: number | null | undefined): string {
  if (value === 1) return '公开';
  if (value === 0) return '隐藏内容';
  if (value === -1) return '锁屏不显示';
  if (value === -1000) return '跟随系统默认';
  if (value === null || value === undefined) return '系统未返回';
  return `未知(${value})`;
}

function describeLastPost(diagnostics: IncomingCallDiagnostics): string {
  if (!diagnostics.lastPostAttemptAtEpochMs) return '尚未发布';
  const date = new Date(diagnostics.lastPostAttemptAtEpochMs);
  const time = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}:${String(date.getSeconds()).padStart(2, '0')}`;
  if (diagnostics.lastPostShown) return `成功 ${time}`;
  return `失败 ${time}${diagnostics.lastPostError ? ` · ${diagnostics.lastPostError}` : ''}`;
}

function toMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}
