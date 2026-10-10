import React, { useMemo } from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import { ArchiveRestore, Trash2, UserRound, type LucideIcon } from 'lucide-react-native';
import type { UserProfile } from '../domain/UserProfile';
import { UserAvatar } from '@shared/ui';
import { ThemedSurface, useTheme } from '@shared/theme';
import { getInstalledApplicationInfo } from '@platform/device/DeviceStatus';
import { createProfileStyles } from './ProfileTab.styles';

function ProfileSettingsMenuItem({ title, onPress, danger = false, icon: Icon }: {
  title: string; onPress(): void; danger?: boolean; icon: LucideIcon;
}) {
  const theme = useTheme();
  const styles = useMemo(() => createProfileStyles(theme), [theme]);
  const color = danger ? theme.colors.feedback.error : theme.colors.text.primary;
  return <TouchableOpacity style={styles.menuItem} onPress={onPress} activeOpacity={0.7} accessibilityRole="button">
    <Icon size={20} color={color} style={styles.menuItemIcon} />
    <Text style={[styles.menuItemText, { color }]}>{title}</Text>
  </TouchableOpacity>;
}

export function ProfileContent({ profile, hasLoadedProfile, onOpenProfile, onBackupPress, onClearAllData }: {
  profile: UserProfile; hasLoadedProfile: boolean;
  onOpenProfile(): void; onBackupPress(): void; onClearAllData(): void;
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
      <ProfileSettingsMenuItem title="清空所有数据" icon={Trash2} danger onPress={onClearAllData} />
    </ThemedSurface>
    <View style={styles.versionSection}><Text style={styles.versionText}>{appInfo.name} v{appInfo.version} ({appInfo.buildNumber})</Text></View>
  </>;
}
