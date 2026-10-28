/** 群聊搜索路由与单聊复用同一检索界面。 */
import { Redirect, type Href, useLocalSearchParams, useRouter } from 'expo-router';
import { GroupSearchRouteScreen } from '@features/chat';

export default function GroupSearchRoute() {
  const router = useRouter();
  const params = useLocalSearchParams<{ groupId?: string | string[] }>();
  const groupId = Array.isArray(params.groupId) ? params.groupId[0] : params.groupId;
  if (!groupId) return <Redirect href={'/conversations' as Href} />;
  return <GroupSearchRouteScreen groupId={groupId} onOpenMessage={messageId => router.push({
    pathname: '/chat/groups/[groupId]/message-context', params: { groupId, messageId },
  } as Href)} />;
}
