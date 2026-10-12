/** 管理用户主动使用的悬浮交互，不拥有主动伴随生命周期。 */

import { Ionicons } from '@expo/vector-icons';
import { getDeviceObserverConnectionState } from '@features/deviceControl';
import { ThemedSurface, useTheme, useThemedStyles } from '@shared/theme';
import { ToggleField } from '@shared/ui';
import NavigationHeader from '@shared/ui/NavigationHeader';
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  RefreshControl,
  ScrollView,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  FloatingInteractionOverlayPermissionError,
  loadFloatingInteractionState,
  reconcileFloatingInteraction,
  setFloatingInteractionEnabled,
  type FloatingInteractionState,
} from '../application';
import { BubbleSkinSettings } from './BubbleSkinSettings';
import { createStyles } from './FloatingInteractionScreen.styles';

interface FloatingInteractionScreenProps {
  onBack: () => void;
  onOpenSystemAccess: () => void;
}

export default function FloatingInteractionScreen({
  onBack,
  onOpenSystemAccess,
}: FloatingInteractionScreenProps) {
  const theme = useTheme();
  const styles = useThemedStyles(createStyles);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [running, setRunning] = useState(false);
  const [overlayGranted, setOverlayGranted] = useState(false);
  const [screenReadingAvailable, setScreenReadingAvailable] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const applyFloatingState = useCallback((state: FloatingInteractionState) => {
    setEnabled(state.settings.enabled);
    setRunning(state.running);
    setOverlayGranted(state.overlayGranted);
  }, []);

  const refresh = useCallback(async (pullToRefresh = false) => {
    if (pullToRefresh) setRefreshing(true);
    try {
      const [nextState, observer] = await Promise.all([
        reconcileFloatingInteraction(),
        getDeviceObserverConnectionState(),
      ]);
      applyFloatingState(nextState);
      setScreenReadingAvailable(
        observer.accessibilityConnected && observer.canRetrieveWindowContent,
      );
      setErrorMessage(null);
    } catch (error) {
      setErrorMessage(toMessage(error, '无法读取悬浮交互状态。'));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [applyFloatingState]);

  useEffect(() => {
    void refresh();
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void refresh();
    });
    return () => subscription.remove();
  }, [refresh]);

  const updateEnabled = useCallback(async (nextEnabled: boolean) => {
    if (busy) return;
    setBusy(true);
    setErrorMessage(null);
    try {
      applyFloatingState(await setFloatingInteractionEnabled(nextEnabled));
    } catch (error) {
      if (error instanceof FloatingInteractionOverlayPermissionError) {
        onOpenSystemAccess();
        return;
      }
      // 投影可能在意图提交后失败；重新读取 SQLite，确保开关仍表达持久化意图。
      try {
        applyFloatingState(await loadFloatingInteractionState());
      } catch {
        // 保留原始投影错误；读取失败会在下一次页面恢复时再次暴露。
      }
      setErrorMessage(toMessage(
        error,
        nextEnabled ? '开启悬浮交互失败。' : '关闭悬浮交互失败。',
      ));
    } finally {
      setBusy(false);
    }
  }, [applyFloatingState, busy, onOpenSystemAccess]);

  if (loading) {
    return (
      <SafeAreaView style={styles.screenContainer} edges={['top', 'left', 'right']}>
        <NavigationHeader title="悬浮交互" onGoBack={onBack} />
        <View style={styles.loading}>
          <ActivityIndicator color={theme.colors.brand.primary} />
          <Text style={styles.muted}>正在读取悬浮层状态…</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.screenContainer} edges={['top', 'left', 'right']}>
      <NavigationHeader title="悬浮交互" onGoBack={onBack} />
      <ScrollView
        style={styles.scrollView}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh(true)} />}
      >
        <Text style={styles.sectionTitle}>悬浮显示</Text>
        <ThemedSurface variant="card" style={styles.card}>
          <View style={styles.cardContent}>
            <ToggleField
              label="开启悬浮交互"
              hint={floatingInteractionHint(enabled, running)}
              value={enabled}
              onValueChange={(value) => void updateEnabled(value)}
              disabled={busy}
            />
          </View>
        </ThemedSurface>

        {errorMessage ? (
          <View style={styles.errorCard}><Text style={styles.errorText}>{errorMessage}</Text></View>
        ) : null}

        <BubbleSkinSettings />

        <Text style={styles.sectionTitle}>系统访问</Text>
        <ThemedSurface variant="card" style={styles.card}>
          <View style={styles.cardContent}>
            <AccessSummaryRow label="悬浮显示" granted={overlayGranted} styles={styles} />
            <AccessSummaryRow label="屏幕内容读取" granted={screenReadingAvailable} styles={styles} last />
          </View>
        </ThemedSurface>
        <TouchableOpacity
          style={styles.entryCard}
          onPress={onOpenSystemAccess}
          accessibilityRole="button"
        >
          <View>
            <Text style={styles.entryTitle}>权限与后台运行</Text>
            <Text style={styles.entryHint}>查看并管理悬浮交互需要的系统能力</Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color={theme.colors.text.tertiary} />
        </TouchableOpacity>
        <View style={styles.bottomGap} />
      </ScrollView>
    </SafeAreaView>
  );
}

function AccessSummaryRow({
  label,
  granted,
  last,
  styles,
}: {
  label: string;
  granted: boolean;
  last?: boolean;
  styles: ReturnType<typeof createStyles>;
}) {
  return (
    <View style={[styles.settingRow, last ? styles.lastRow : null]}>
      <Text style={styles.settingHint}>{label}</Text>
      <Text style={[styles.settingValue, granted ? null : styles.errorText]}>
        {granted ? '已开启' : '未开启'}
      </Text>
    </View>
  );
}

function toMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function floatingInteractionHint(enabled: boolean, running: boolean): string {
  if (enabled && running) return '在其他应用上显示 RavenCat，并提供快捷聊天与截图入口。';
  if (enabled) return '已记录开启意图，悬浮层正在等待系统恢复。';
  if (running) return '已记录关闭意图，悬浮层正在停止。';
  return '在其他应用上显示 RavenCat，并提供快捷聊天与截图入口。';
}
