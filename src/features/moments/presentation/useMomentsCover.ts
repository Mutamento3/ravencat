/** Profile-owned momentsCover 的唯一 presentation controller，供 Header 与设置页共用。 */
import { showAppDialog } from '@shared/ui';
import { useCallback, useEffect, useState } from 'react';
import { type ImageSourcePropType } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { pickCroppedImage } from '@platform/device/DeviceMediaService';
import {
  DEFAULT_USER_PROFILE,
  getCurrentUserProfile,
  updateCurrentUserMomentsCover,
  type UserProfile,
} from '@features/profile';


export const DEFAULT_MOMENTS_COVER_SOURCE = require('../../../../assets/ravenphone_bg.png');
/**
 * @param refreshRevision 保活路由的焦点刷新版本：设置页改为独立路由后调用方不再重挂载，
 * 封面 / 用户名等 Profile 变更必须靠 revision 递增触发重读。
 */
export function useMomentsCover(refreshRevision = 0) {
  const [currentUser, setCurrentUser] = useState<UserProfile>(DEFAULT_USER_PROFILE as UserProfile);
  const [coverSource, setCoverSource] = useState<ImageSourcePropType>(DEFAULT_MOMENTS_COVER_SOURCE);
  const [isUpdatingCover, setIsUpdatingCover] = useState(false);

  useEffect(() => {
    void getCurrentUserProfile().then(setCurrentUser).catch((error) => {
      console.error('Failed to load user profile for moments cover:', error);
    });
  }, [refreshRevision]);

  useEffect(() => {
    setCoverSource(currentUser.momentsCover ? { uri: currentUser.momentsCover } : DEFAULT_MOMENTS_COVER_SOURCE);
  }, [currentUser.momentsCover]);

  const pickCover = useCallback(async () => {
    setIsUpdatingCover(true);
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) { showAppDialog({ title: '需要权限', message: '请允许访问相册以更换时刻封面', tone: 'warning' }); return; }
      const asset = await pickCroppedImage({ aspect: [16, 9] });
      if (!asset) return;
      setCurrentUser(await updateCurrentUserMomentsCover(asset.uri, asset.width));
      showAppDialog({ title: '成功', message: '时刻封面已更新', tone: 'success' });
    } catch (error) {
      console.error('Failed to update moments cover:', error);
      showAppDialog({ title: '错误', message: '更换时刻封面失败，请稍后重试', tone: 'error' });
    } finally { setIsUpdatingCover(false); }
  }, []);

  const resetCover = useCallback(() => new Promise<void>((resolve) => {
    showAppDialog({ title: '恢复默认封面', message: '确定要恢复时刻默认封面吗？', buttons: [
      { text: '取消', style: 'cancel', onPress: () => resolve() },
      { text: '恢复默认', style: 'destructive', onPress: async () => {
        setIsUpdatingCover(true);
        try {
          setCurrentUser(await updateCurrentUserMomentsCover(null));
          showAppDialog({ title: '成功', message: '已恢复默认时刻封面', tone: 'success' });
        } catch (error) {
          console.error('Failed to reset moments cover:', error);
          showAppDialog({ title: '错误', message: '恢复默认封面失败', tone: 'error' });
        } finally { setIsUpdatingCover(false); resolve(); }
      } },
    ] });
  }), []);

  return {
    currentUser,
    coverSource,
    hasCustomCover: currentUser.momentsCoverMediaAssetId !== null || !!currentUser.momentsCover,
    isUpdatingCover,
    pickCover,
    resetCover,
    handleCoverError: () => setCoverSource(DEFAULT_MOMENTS_COVER_SOURCE),
  };
}
