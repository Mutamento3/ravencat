/**
 * @fileoverview 表现层默认用户配置兼容层
 *
 * 当前项目仍有部分旧 UI 直接从这里读取默认用户信息。
 * 第三阶段迁移后，真实用户头像来源应优先走 userProfileRepository；
 * 本文件仅保留为“默认值来源 + 兼容导出”。
 */

import { DEFAULT_SELF_USER_NAME, SELF_USER_PROFILE_ID } from '../domain/UserProfile';

export const DEFAULT_USER_PROFILE = {
  id: SELF_USER_PROFILE_ID,
  name: DEFAULT_SELF_USER_NAME,
  gender: '',
  age: null as number | null,
  identity: '',
  region: '',
  other: '',
  signature: '',
  avatar: null as string | null,
  avatarMediaAssetId: null as string | null,
  momentsCover: null as string | null,
  momentsCoverMediaAssetId: null as string | null,
  updatedAt: new Date(0).toISOString(),
};

export const DEFAULT_USER_NAME = DEFAULT_USER_PROFILE.name;
export const DEFAULT_USER_AVATAR = DEFAULT_USER_PROFILE.avatar;
