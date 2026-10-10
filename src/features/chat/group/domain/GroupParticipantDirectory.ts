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
  avatar: string | null;
  avatarMediaAssetId: string | null;
}

export interface GroupParticipantDirectory {
  groupId: string;
  currentUser: GroupUserParticipant;
  assistants: GroupAssistantParticipant[];
}
