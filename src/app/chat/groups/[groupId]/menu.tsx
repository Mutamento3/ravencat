/** 群聊信息路由。 */
import { Redirect, type Href, useLocalSearchParams } from 'expo-router';
import { GroupMenuRouteScreen } from '@features/chat';

export default function GroupMenuRoute() {
  const params = useLocalSearchParams<{ groupId?: string | string[] }>();
  const groupId = Array.isArray(params.groupId) ? params.groupId[0] : params.groupId;
  return groupId
    ? <GroupMenuRouteScreen groupId={groupId} />
    : <Redirect href={'/conversations' as Href} />;
}
