/** 单聊设置路由。 */
import { Redirect, type Href, useLocalSearchParams } from 'expo-router';
import { ChatSettingsRouteScreen } from '@features/chat';

export default function ChatSettingsRoute() {
  const params = useLocalSearchParams<{ aiId?: string | string[] }>();
  const aiId = Array.isArray(params.aiId) ? params.aiId[0] : params.aiId;
  return aiId ? <ChatSettingsRouteScreen aiId={aiId} /> : <Redirect href={'/conversations' as Href} />;
}
