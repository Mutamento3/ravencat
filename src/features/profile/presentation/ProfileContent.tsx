import React, { useMemo } from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import { ArchiveRestore, RefreshCw, Trash2, UserRound, type LucideIcon } from 'lucide-react-native';
import type { UserProfile } from '../domain/UserProfile';
import { UserAvatar } from '@shared/ui';
import { ThemedSurface, useTheme } from '@shared/theme';
import { getInstalledApplicationInfo } from '@platform/device/DeviceStatus';
import { createProfileStyles } from './ProfileTab.styles';

function ProfileSettingsMenuItem({ title, onPress, danger = false, icon: Icon,
  detail, hasNotice = false, disabled = false }: {
  title: string; onPress(): void; danger?: boolean; icon: LucideIcon;
  detail?: string; hasNotice?: boolean; disabled?: boolean;
}) {
  const theme = useTheme();
  const styles = useMemo(() => createProfileStyles(theme), [theme]);
  const color = danger ? theme.colors.feedback.error : theme.colors.text.primary;
  return <TouchableOpacity style={styles.menuItem} onPress={onPress} activeOpacity={0.7}
    disabled={disabled} accessibilityRole="button" accessibilityState={{ disabled }}
    accessibilityLabel={[title, detail, hasNotice ? '有新版本' : null].filter(Boolean).join('，')}>
    <Icon size={20} color={color} style={styles.menuItemIcon} />
    <Text style={[styles.menuItemText, { color }]}>{title}</Text>
    {detail ? <Text style={styles.menuItemDetail}>{detail}</Text> : null}
    {hasNotice ? <View style={styles.updateDot} accessible={false} /> : null}
  </TouchableOpacity>;
}

export function ProfileContent({ profile, hasLoadedProfile, onOpenProfile, onBackupPress, onClearAllData,
  checkingUpdates, availableUpdateVersion, updateProgress, updateDownloaded, onCheckUpdates }: {
  profile: UserProfile; hasLoadedProfile: boolean;
  onOpenProfile(): void; onBackupPress(): void; onClearAllData(): void;
  checkingUpdates: boolean; availableUpdateVersion: string | null; onCheckUpdates(): void;
  updateProgress: number | null; updateDownloaded: boolean;
}) {
  const appInfo = useMemo(() => getInstalledApplicationInfo(), []);
  const theme = useTheme();
  const styles = useMemo(() => createProfileStyles(theme), [theme]);
  return <>
    <ThemedSurface nativeGlass variant="card" style={styles.userInfoSection}>
      <View style={styles.userAvatarContainer}>
        {hasLoadedProfile ? <UserAvatar name={profile.name} avatarUrl={profile.avatar} size="medium" style={styles.userAvatar} />
          : <View style={styles.userAvatarSkeleton} />}
      </View>
      <View style={styles.userInfo}>
        {hasLoadedProfile ? <Text style={styles.userName}>{profile.name}</Text> : <View style={styles.userNameSkeleton} />}
      </View>
    </ThemedSurface>
    <ThemedSurface nativeGlass variant="card" style={styles.menuSection}>
      <ProfileSettingsMenuItem title="个人" icon={UserRound} onPress={onOpenProfile} />
    </ThemedSurface>
    <ThemedSurface nativeGlass variant="card" style={styles.menuSection}>
      <ProfileSettingsMenuItem title="备份与恢复" icon={ArchiveRestore} onPress={onBackupPress} />
      <ProfileSettingsMenuItem title="检查更新" icon={RefreshCw} onPress={onCheckUpdates}
        disabled={checkingUpdates} hasNotice={availableUpdateVersion !== null}
        detail={updateProgress !== null ? `下载 ${Math.floor(updateProgress * 100)}%`
          : updateDownloaded ? '已下载，点击安装' : checkingUpdates ? '正在检查…'
            : availableUpdateVersion ? `v${availableUpdateVersion}` : undefined} />
      <ProfileSettingsMenuItem title="清空所有数据" icon={Trash2} danger onPress={onClearAllData} />
    </ThemedSurface>
    <View style={styles.versionSection}><Text style={styles.versionText}>{appInfo.name} v{appInfo.version} ({appInfo.buildNumber})</Text></View>
  </>;
}
