/** 记忆空间以星球呈现，正文和触发词由按需打开的面板管理。 */
import { showAppDialog } from '@shared/ui';
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, AppState, Pressable, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from 'expo-router';
import { ChevronLeft, Settings2 } from 'lucide-react-native';
import { useReducedMotion } from 'react-native-reanimated';
import { useTheme, useThemedStyles } from '@shared/theme';
import { selectMemorySpace } from '../application/MemoryCommands';
import { createMemoryGalaxyStyles } from './memoryGalaxyStyles';
import GalaxyBackground from './GalaxyBackground';
import MemoryGalaxy from './MemoryGalaxy';
import MemorySpacePanel from './MemorySpacePanel';
import ShootingStar from './ShootingStar';
import SplashOverlay from './SplashOverlay';
import useMemoryManagementSnapshot from './useMemoryManagementSnapshot';

interface Props {
  onBack(): void;
  onOpenSettings(assistantId?: string): void;
  onCreateMemory(assistantId: string): void;
  onEditMemory(assistantId: string, memoryId: string): void;
  onOpenTrigger(assistantId: string, triggerId: string): void;
}

export default function MemoryScreen({ onBack, onOpenSettings, onCreateMemory, onEditMemory, onOpenTrigger }: Props) {
  const theme = useTheme();
  const styles = useThemedStyles(createMemoryGalaxyStyles);
  const starlight = theme.mode === 'dark' ? theme.colors.text.primary : theme.colors.text.inverse;
  const [assistantId, setAssistantId] = useState<string>();
  const [panelOpen, setPanelOpen] = useState(false);
  const [focused, setFocused] = useState(false);
  const [appActive, setAppActive] = useState(AppState.currentState === 'active');
  const [busy, setBusy] = useState(false);
  const [splashDone, setSplashDone] = useState(false);
  const [viewport, setViewport] = useState({ width: 0, height: 0 });
  const [shootingStar, setShootingStar] = useState(false);
  const reducedMotion = useReducedMotion();
  const ambientActive = focused && appActive && !panelOpen && !reducedMotion;
  const { snapshot, error, refreshing, refresh } = useMemoryManagementSnapshot(assistantId);
  useFocusEffect(useCallback(() => { setFocused(true); return () => setFocused(false); }, []));
  useEffect(() => {
    const subscription = AppState.addEventListener('change', state => setAppActive(state === 'active'));
    return () => subscription.remove();
  }, []);

  const run = useCallback(async (operation: () => Promise<unknown>) => {
    setBusy(true);
    try { await operation(); }
    catch (failure) { showAppDialog({ title: '操作失败', message: failure instanceof Error ? failure.message : '请稍后重试', tone: 'error' }); }
    finally { setBusy(false); }
  }, []);
  const openSpace = useCallback((id: string) => {
    setAssistantId(id);
    setPanelOpen(true);
    void run(() => selectMemorySpace(id));
  }, [run]);
  const navigateFromPanel = (navigate: () => void) => { setFocused(false); navigate(); };

  // Screen 统一拥有所有装饰动效的前台生命周期。
  useEffect(() => {
    if (!splashDone || !ambientActive) {
      setShootingStar(false);
      return;
    }
    const timer = setInterval(() => {
      if (Math.random() > 0.4) setShootingStar(true);
    }, 5000);
    return () => clearInterval(timer);
  }, [splashDone, ambientActive]);

  const removeShootingStar = useCallback(() => setShootingStar(false), []);
  const finishSplash = useCallback(() => setSplashDone(true), []);

  return <View style={styles.screen} onLayout={({ nativeEvent: { layout } }) => setViewport({ width: layout.width, height: layout.height })}>
    {/* 星云动效与前景共用 Screen 的前台生命周期。 */}
    {viewport.width > 0 && <GalaxyBackground width={viewport.width} height={viewport.height} paused={!ambientActive || !splashDone} />}
    <SafeAreaView style={{ flex: 1 }}>
      <View style={styles.navigation}>
        <Pressable accessibilityRole="button" accessibilityLabel="返回" style={styles.iconButton} disabled={busy} onPress={onBack}><ChevronLeft size={23} color={starlight} /></Pressable>
        <Text style={styles.title}>记忆</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="记忆设置" style={styles.iconButton} disabled={busy} onPress={() => onOpenSettings(snapshot?.selectedSpace?.assistantId)}><Settings2 size={20} color={starlight} /></Pressable>
      </View>
      <View style={styles.header}>
        <Text style={styles.eyebrow}>MEMORY GALAXY</Text>
        <Text style={styles.subtitle}>{snapshot ? `${snapshot.spaces.length} 个世界` : ''}</Text>
      </View>
      {error && !panelOpen && <><Text style={styles.error}>{error}</Text><Pressable accessibilityRole="button" accessibilityLabel="重新读取记忆空间" onPress={refresh}><Text style={[styles.subtitle, { textAlign: 'center' }]}>重新读取</Text></Pressable></>}
      {!snapshot && !error && !panelOpen && <ActivityIndicator color={starlight} style={{ marginTop: 24 }} />}
      {snapshot?.spaces.length === 0 && <Text style={styles.empty}>创建 AI 助手后，这里会亮起属于你们的星球。</Text>}
      {snapshot && snapshot.spaces.length > 0 && <MemoryGalaxy spaces={snapshot.spaces} paused={!focused || !appActive || panelOpen || !splashDone} disabled={busy} onSelect={openSpace} />}
    </SafeAreaView>
    {/* 流星 */}
    {ambientActive && shootingStar && <ShootingStar width={viewport.width} height={viewport.height} onDone={removeShootingStar} />}
    {/* 记忆面板 */}
    {panelOpen && <MemorySpacePanel key={assistantId} visible={focused} snapshot={snapshot?.selectedSpace?.assistantId === assistantId ? snapshot : null} error={error} busy={busy} refreshing={refreshing} refresh={refresh} run={run} onClose={() => setPanelOpen(false)}
      onCreateMemory={id => navigateFromPanel(() => onCreateMemory(id))}
      onEditMemory={(id, memoryId) => navigateFromPanel(() => onEditMemory(id, memoryId))}
      onOpenTrigger={(id, triggerId) => navigateFromPanel(() => onOpenTrigger(id, triggerId))} />}
    {/* 开屏动效 */}
    {!splashDone && <SplashOverlay active={focused && appActive} onFinish={finishSplash} />}
  </View>;
}
