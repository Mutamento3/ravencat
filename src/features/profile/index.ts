/** 用户资料功能公共出口，外部调用方只能从这里访问。 */
export { ProfileTab } from './presentation';
export { ProfileDetailsScreen, type ProfileNavigationState } from './presentation/ProfileDetailsScreen';
export { ProfileFieldScreen } from './presentation/ProfileFieldScreen';
export { isUserProfileField, type UserProfileField } from './domain/UserProfileField';
export {
  getCurrentUserProfile,
  updateCurrentUserAvatar,
  updateCurrentUserAvatarFromDraft,
  updateCurrentUserMomentsCover,
  clearCurrentUserLegacyCachedMomentsCover,
  updateCurrentUserProfile,
  subscribeUserProfileUpdated,
  getCurrentUserMomentsCoverImageSelection,
  changeCurrentUserAvatarFromMediaAsset,
  changeCurrentUserMomentsCoverFromMediaAsset,
} from './composition';
export { SQLiteUserProfileRepository, userProfileRepository } from './infrastructure/SQLiteUserProfileRepository';
export {
  DEFAULT_SELF_USER_NAME,
  SELF_USER_PROFILE_ID,
} from './domain/UserProfile';
export {
  DEFAULT_USER_AVATAR,
  DEFAULT_USER_NAME,
  DEFAULT_USER_PROFILE,
} from './presentation/userProfileConstants';
export type { UpdateUserProfileInput, UserProfile } from './domain/UserProfile';
export type { IUserProfileRepository } from './domain/UserProfileRepository';

export { clearLegacyCachedWallpapers, loadWallpaperState, setGlobalWallpaper, setConversationWallpaper, removeConversationWallpaperInTransaction } from './application/WallpaperSettings';
export { getWallpaperImageSelection, changeWallpaperFromMediaAsset } from './application/WallpaperSettings';
export { subscribeWallpaperChanged } from './application/WallpaperChanged';
