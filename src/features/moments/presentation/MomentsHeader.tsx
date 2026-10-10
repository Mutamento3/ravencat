// 朋友圈顶部封面组件；封面读写由 Profile-owned useMomentsCover controller 统一承担。
import React, { useMemo, useState } from 'react';
import { ImageBackground, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { UserAvatar } from '@shared/ui';
import NavigationHeader from '@shared/ui/NavigationHeader';
import { useTheme, type PresentationTheme } from '@shared/theme';
import MomentsCoverPreviewModal from './MomentsCoverPreviewModal';
import { useMomentsCover } from './useMomentsCover';

interface MomentsHeaderProps {
  /**
   * 保活路由的焦点刷新版本：设置页作为独立路由后本 Header 不再随开关重挂载，
   * 封面等 Profile 变更必须靠 revision 触发重读。
   */
  refreshRevision?: number;
  onCameraPress?: () => void;
  onSettingsPress?: () => void;
}

function createStyles(theme: PresentationTheme) {
  return StyleSheet.create({
    container: { backgroundColor: theme.effects.glass.enabled ? 'transparent' : theme.colors.surface.default },
    headerActions: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.lg },
    coverContainer: { height: 228, position: 'relative', marginTop: theme.effects.glass.enabled ? theme.spacing.sm : 0 },
    coverTouchable: { flex: 1 },
    coverBackground: { flex: 1, justifyContent: 'flex-end', backgroundColor: theme.colors.background.screen },
    coverImage: { resizeMode: 'cover' },
    userInfoContainer: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'flex-end', paddingHorizontal: theme.spacing.lg, paddingBottom: 16 },
    avatarWrapper: { width: 56, height: 56, borderRadius: theme.radius.sm, borderWidth: 2, borderColor: theme.colors.surface.default, ...theme.shadow.md },
    userTextContainer: { alignItems: 'flex-end', marginBottom: 6, marginRight: 12, maxWidth: 240 },
    userName: { fontSize: 18, fontWeight: '700', color: theme.colors.brand.onPrimary, textShadowColor: 'rgba(0,0,0,0.35)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 3 },
  });
}

export default function MomentsHeader({ refreshRevision, onCameraPress, onSettingsPress }: MomentsHeaderProps) {
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const cover = useMomentsCover(refreshRevision);
  const [previewVisible, setPreviewVisible] = useState(false);
  const rightButton = (
    <View style={styles.headerActions}>
      <TouchableOpacity onPress={onSettingsPress} activeOpacity={0.7} accessibilityLabel="时刻设置">
        <Ionicons name="settings-outline" size={23} color={theme.colors.icon.primary} />
      </TouchableOpacity>
      <TouchableOpacity onPress={onCameraPress} activeOpacity={0.7} accessibilityLabel="发布时刻">
        <Ionicons name="camera" size={24} color={theme.colors.icon.primary} />
      </TouchableOpacity>
    </View>
  );

  return (
    <View style={styles.container}>
      <NavigationHeader title="时刻" rightButton={rightButton} includeTopInset={theme.effects.glass.enabled} />
      <View style={styles.coverContainer}>
        <TouchableOpacity style={styles.coverTouchable} onPress={() => setPreviewVisible(true)} activeOpacity={0.95}>
          <ImageBackground source={cover.coverSource} style={styles.coverBackground} imageStyle={styles.coverImage} onError={cover.handleCoverError}>
            <View style={styles.userInfoContainer}>
              <View style={styles.userTextContainer}>
                <Text style={styles.userName} numberOfLines={1}>{cover.currentUser.name}</Text>
              </View>
              <UserAvatar name={cover.currentUser.name} avatarUrl={cover.currentUser.avatar} size="medium" style={styles.avatarWrapper} />
            </View>
          </ImageBackground>
        </TouchableOpacity>
      </View>
      <MomentsCoverPreviewModal
        visible={previewVisible}
        coverSource={cover.coverSource}
        hasCustomCover={cover.hasCustomCover}
        isUpdating={cover.isUpdatingCover}
        onClose={() => setPreviewVisible(false)}
        onPickCover={() => { setPreviewVisible(false); void cover.pickCover(); }}
        onResetCover={() => { setPreviewVisible(false); void cover.resetCover(); }}
      />
    </View>
  );
}
