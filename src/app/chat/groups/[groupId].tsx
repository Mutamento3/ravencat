/** 群聊详情路由。 */
import { useCallback, useState } from 'react';
import { Redirect, type Href, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { GroupConversationRouteScreen } from '@features/chat';

export default function GroupConversationRoute() {
  const [routeFocused, setRouteFocused] = useState(false);
  useFocusEffect(useCallback(() => {
    setRouteFocused(true);
    return () => setRouteFocused(false);
  }, []));
  const params = useLocalSearchParams<{ groupId?: string | string[] }>();
  const groupId = Array.isArray(params.groupId) ? params.groupId[0] : params.groupId;
  return groupId
    ? <GroupConversationRouteScreen groupId={groupId} routeFocused={routeFocused} />
    : <Redirect href={'/conversations' as Href} />;
}
