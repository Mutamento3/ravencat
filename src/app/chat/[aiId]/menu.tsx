/** 单聊菜单路由。 */
import { Redirect, type Href, useLocalSearchParams } from 'expo-router';
import { ChatMenuRouteScreen } from '@features/chat';

export default function ChatMenuRoute() {
  const params = useLocalSearchParams<{ aiId?: string | string[] }>();
  const aiId = Array.isArray(params.aiId) ? params.aiId[0] : params.aiId;
  return aiId ? <ChatMenuRouteScreen aiId={aiId} /> : <Redirect href={'/conversations' as Href} />;
}
