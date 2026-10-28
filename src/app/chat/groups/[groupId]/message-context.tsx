/** 群聊原文上下文路由。 */
import { Redirect, type Href, useLocalSearchParams } from 'expo-router';
import { GroupSearchRouteScreen } from '@features/chat';

export default function GroupMessageContextRoute() {
  const params = useLocalSearchParams<{ groupId?: string | string[]; messageId?: string | string[] }>();
  const groupId = Array.isArray(params.groupId) ? params.groupId[0] : params.groupId;
  const messageId = Number(Array.isArray(params.messageId) ? params.messageId[0] : params.messageId);
  if (!groupId || !Number.isSafeInteger(messageId) || messageId <= 0) return <Redirect href={'/conversations' as Href} />;
  return <GroupSearchRouteScreen groupId={groupId} messageId={messageId} />;
}
