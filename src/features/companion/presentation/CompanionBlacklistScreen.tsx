/** 通过 Android 桌面应用列表管理 RavenCat 用户截图黑名单。 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  loadCompanionUserScreenCaptureBlacklist,
  updateCompanionUserScreenCaptureBlacklist,
} from '../application';

import {
  clearInstalledAppIconCache,
  getInstalledLaunchableApps,
  type DeviceObserverInstalledLaunchableApp,
} from '@features/deviceControl';
import { SYSTEM_PROTECTED_PACKAGES } from '@features/phoneTools';
import NavigationHeader from '@shared/ui/NavigationHeader';
import { Button, InputField, ListItem, Toggle } from '@shared/ui';
import { useTheme, useThemedStyles } from '@shared/theme';
import type { PresentationTheme } from '@shared/theme';

interface CompanionBlacklistScreenProps {
  onBack: () => void;
  onSelectionCountChange?: (count: number) => void;
}

interface BlacklistAppItem extends DeviceObserverInstalledLaunchableApp {
  installed: boolean;
}

const createStyles = (theme: PresentationTheme) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.colors.background.app },
  list: { flex: 1, backgroundColor: theme.colors.background.screen },
  content: { paddingHorizontal: theme.spacing.lg },
  card: {
    marginTop: theme.spacing.lg,
    padding: theme.spacing.lg,
    borderRadius: theme.radius.lg,
    backgroundColor: theme.colors.surface.default,
  },
  title: { fontSize: 17, fontWeight: '600', color: theme.colors.text.primary },
  description: {
    marginTop: theme.spacing.sm,
    fontSize: 14,
    lineHeight: 20,
    color: theme.colors.text.secondary,
  },
  packageText: {
    marginTop: theme.spacing.xs,
    fontSize: 12,
    lineHeight: 18,
    color: theme.colors.text.tertiary,
  },
  search: { marginTop: theme.spacing.lg, marginBottom: 0 },
  sectionTitle: {
    marginTop: theme.spacing.lg,
    marginBottom: theme.spacing.sm,
    color: theme.colors.text.secondary,
    fontSize: 13,
    fontWeight: '600',
  },
  listCard: {
    marginHorizontal: theme.spacing.lg,
    borderRadius: theme.radius.lg,
    overflow: 'hidden',
    backgroundColor: theme.colors.surface.default,
  },
  itemLast: { borderBottomWidth: 0 },
  icon: { width: 42, height: 42, borderRadius: 10 },
  iconFallback: {
    width: 42,
    height: 42,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.surface.input,
  },
  empty: {
    marginHorizontal: theme.spacing.lg,
    padding: theme.spacing.xl,
    borderRadius: theme.radius.lg,
    textAlign: 'center',
    color: theme.colors.text.secondary,
    backgroundColor: theme.colors.surface.default,
  },
  status: { alignItems: 'center', padding: theme.spacing.xl },
  error: { marginTop: theme.spacing.md, color: theme.colors.feedback.error, lineHeight: 20 },
  retry: { marginTop: theme.spacing.md },
  footer: { height: theme.spacing.xxl },
});

export default function CompanionBlacklistScreen({
  onBack,
  onSelectionCountChange,
}: CompanionBlacklistScreenProps) {
  const [selectedPackages, setSelectedPackages] = useState<string[]>([]);
  const [installedApps, setInstalledApps] = useState<DeviceObserverInstalledLaunchableApp[]>([]);
  const [searchText, setSearchText] = useState('');
  const [loadingSettings, setLoadingSettings] = useState(true);
  const [loadingApps, setLoadingApps] = useState(true);
  const [busyPackage, setBusyPackage] = useState<string | null>(null);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [queryError, setQueryError] = useState<string | null>(null);
  const theme = useTheme();
  const styles = useThemedStyles(createStyles);

  const loadSettings = useCallback(async () => {
    setLoadingSettings(true);
    try {
      setSelectedPackages(await loadCompanionUserScreenCaptureBlacklist());
      setSettingsError(null);
    } catch (error) {
      setSettingsError(error instanceof Error ? error.message : '无法读取黑名单设置。');
    } finally {
      setLoadingSettings(false);
    }
  }, []);

  const loadApps = useCallback(async () => {
    setLoadingApps(true);
    try {
      setInstalledApps(await getInstalledLaunchableApps());
      setQueryError(null);
    } catch {
      setQueryError('暂时无法读取设备上的桌面应用。已保存的黑名单不会被清空。');
    } finally {
      setLoadingApps(false);
    }
  }, []);

  useEffect(() => {
    void loadSettings();
    void loadApps();
    return () => {
      void clearInstalledAppIconCache().catch(() => undefined);
    };
  }, [loadApps, loadSettings]);

  const selectedSet = useMemo(
    () => new Set(selectedPackages.map(normalizePackageName)),
    [selectedPackages],
  );
  const appItems = useMemo(() => {
    const protectedPackages = new Set<string>(
      SYSTEM_PROTECTED_PACKAGES,
    );
    const installedPackageNames = new Set(
      installedApps.map((app) => normalizePackageName(app.packageName)),
    );
    const uninstalledItems: BlacklistAppItem[] = selectedPackages
      .filter((packageName) => !installedPackageNames.has(normalizePackageName(packageName)))
      .map((packageName) => ({
        packageName,
        label: '已卸载应用',
        iconDataUri: null,
        isSystemApp: false,
        installed: false,
      }));
    return [
      ...installedApps
        .filter((app) => !protectedPackages.has(normalizePackageName(app.packageName)))
        .map((app) => ({ ...app, installed: true })),
      ...uninstalledItems,
    ]
      .sort((left, right) => (
        left.label.localeCompare(right.label, 'zh-CN', { sensitivity: 'base' })
        || left.packageName.localeCompare(right.packageName)
      ));
  }, [installedApps, selectedPackages]);
  const filteredApps = useMemo(() => {
    const query = searchText.trim().toLocaleLowerCase();
    if (!query) return appItems;
    return appItems.filter((app) => (
      app.label.toLocaleLowerCase().includes(query)
      || app.packageName.toLocaleLowerCase().includes(query)
    ));
  }, [appItems, searchText]);

  const togglePackage = useCallback(async (packageName: string, selected: boolean) => {
    const normalized = normalizePackageName(packageName);
    const nextPackages = selected
      ? [...selectedPackages.filter((item) => normalizePackageName(item) !== normalized), packageName]
      : selectedPackages.filter((item) => normalizePackageName(item) !== normalized);
    setBusyPackage(normalized);
    setSettingsError(null);
    try {
      const persisted = await updateCompanionUserScreenCaptureBlacklist(nextPackages);
      setSelectedPackages(persisted);
      onSelectionCountChange?.(persisted.length);
    } catch (error) {
      setSettingsError(error instanceof Error ? error.message : '黑名单保存失败。');
    } finally {
      setBusyPackage(null);
    }
  }, [onSelectionCountChange, selectedPackages]);

  const header = (
    <View style={styles.content}>
      <View style={styles.card}>
        <Text style={styles.title}>固定系统保护</Text>
        <Text style={styles.description}>
          Android 系统设置和权限控制器始终受保护，不能从黑名单中移除。
        </Text>
        <Text style={styles.packageText}>
          {SYSTEM_PROTECTED_PACKAGES.join('\n')}
        </Text>
      </View>
      <InputField
        label={`选择应用（已选 ${selectedPackages.length} 个）`}
        value={searchText}
        onChangeText={setSearchText}
        placeholder="搜索应用名称或包名"
        autoCapitalize="none"
        autoCorrect={false}
        style={styles.search}
      />
      {settingsError ? <Text style={styles.error}>{settingsError}</Text> : null}
      {queryError ? (
        <View>
          <Text style={styles.error}>{queryError}</Text>
          <Button title="重新读取应用列表" onPress={() => void loadApps()} style={styles.retry} />
        </View>
      ) : null}
      <Text style={styles.sectionTitle}>桌面应用</Text>
    </View>
  );

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'left', 'right']}>
      <NavigationHeader title="窥屏黑名单" onGoBack={onBack} />
      {loadingSettings ? (
        <View style={styles.status}>
          <ActivityIndicator color={theme.colors.brand.primary} />
          <Text style={styles.description}>正在读取黑名单…</Text>
        </View>
      ) : (
        <FlatList
          style={styles.list}
          data={filteredApps}
          keyExtractor={(item) => item.packageName}
          ListHeaderComponent={header}
          ListEmptyComponent={loadingApps ? (
            <View style={styles.status}><ActivityIndicator color={theme.colors.brand.primary} /></View>
          ) : <Text style={styles.empty}>没有找到匹配的桌面应用。</Text>}
          ListFooterComponent={<View style={styles.footer} />}
          renderItem={({ item, index }) => {
            const selected = selectedSet.has(normalizePackageName(item.packageName));
            const disabled = busyPackage !== null;
            return (
              <View style={styles.listCard}>
                <ListItem
                  title={item.label || item.packageName}
                  subtitle={`${item.packageName}${item.installed ? '' : ' · 卸载后仍受保护'}`}
                  leftContent={item.iconDataUri ? (
                    <Image source={{ uri: item.iconDataUri }} style={styles.icon} />
                  ) : (
                    <View style={styles.iconFallback}>
                      <Ionicons name="apps-outline" size={24} color={theme.colors.text.secondary} />
                    </View>
                  )}
                  rightContent={(
                    <Toggle
                      value={selected}
                      onValueChange={(value) => void togglePackage(item.packageName, value)}
                      disabled={disabled}
                      accessibilityLabel={`${selected ? '移出' : '加入'}窥屏黑名单：${item.label}`}
                    />
                  )}
                  showArrow={false}
                  onPress={() => void togglePackage(item.packageName, !selected)}
                  style={index === filteredApps.length - 1 ? styles.itemLast : undefined}
                />
              </View>
            );
          }}
        />
      )}
    </SafeAreaView>
  );
}

function normalizePackageName(packageName: string): string {
  return packageName.trim().toLocaleLowerCase();
}
