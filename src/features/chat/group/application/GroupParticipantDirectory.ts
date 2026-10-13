/** 从群成员关系与当前资料构建群聊自己的参与者目录。 */

import { getChatGroupRuntimeDependencies } from './ChatGroupRuntime';
import type {
  GroupAssistantParticipant,
  GroupParticipantDirectory,
} from '../domain/GroupParticipantDirectory';

export async function getGroupParticipantDirectory(
  groupId: string,
): Promise<GroupParticipantDirectory | null> {
  const runtime = getChatGroupRuntimeDependencies();
  const details = await runtime.groups.getById(groupId);
  if (!details) {
    return null;
  }

  const [currentUser, assistantProfiles] = await Promise.all([
    runtime.currentUserDirectory.getCurrent(),
    Promise.all(
      details.members
        .filter((member) => member.enabled)
        .map((member) => runtime.assistantDirectory.getById(member.aiAssistantId)),
    ),
  ]);
  const assistants = assistantProfiles
    .filter((profile): profile is NonNullable<typeof profile> => profile !== null)
    .map<GroupAssistantParticipant>((profile) => ({
      targetType: 'assistant',
      assistantId: profile.id,
      displayName: profile.name,
      nickname: profile.nickname,
      avatar: profile.avatar,
      avatarMediaAssetId: profile.avatarMediaAssetId,
    }));

  return {
    groupId: details.group.id,
    currentUser: {
      targetType: 'user',
      userProfileId: currentUser.id,
      displayName: currentUser.name,
      avatar: currentUser.avatar,
      avatarMediaAssetId: currentUser.avatarMediaAssetId,
    },
    assistants,
  };
}
