/** 消息 ID 在路由边界校验，所属会话与可见资格由仓储查询裁决。 */
import { Redirect, type Href, useLocalSearchParams } from 'expo-router';
import { ChatSearchRouteScreen } from '@features/chat';

export default function ChatMessageContextRoute() {
  const params = useLocalSearchParams<{ aiId?: string | string[]; messageId?: string | string[] }>();
  const aiId = Array.isArray(params.aiId) ? params.aiId[0] : params.aiId;
  const messageId = Number(Array.isArray(params.messageId) ? params.messageId[0] : params.messageId);
  if (!aiId || !Number.isSafeInteger(messageId) || messageId <= 0) return <Redirect href={'/conversations' as Href} />;
  return <ChatSearchRouteScreen aiId={aiId} messageId={messageId} />;
}
