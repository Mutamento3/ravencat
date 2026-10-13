/** 群聊参与者目录的稳定展示 DTO；内部 actor key 不进入展示边界。 */

export interface GroupUserParticipant {
  targetType: 'user';
  userProfileId: string;
  displayName: string;
  avatar: string | null;
  avatarMediaAssetId: string | null;
}

export interface GroupAssistantParticipant {
  targetType: 'assistant';
  assistantId: string;
  displayName: string;
  /** 仅用户 UI 使用；模型与 AI mention 解析继续使用公开 displayName。 */
  nickname?: string | null;
  avatar: string | null;
  avatarMediaAssetId: string | null;
}

export interface GroupParticipantDirectory {
  groupId: string;
  currentUser: GroupUserParticipant;
  assistants: GroupAssistantParticipant[];
}
