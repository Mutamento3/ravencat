/** 单聊文件预览路由；文件信息保留在聊天 Provider，不写入 URL。 */
import { Redirect, type Href, useLocalSearchParams } from 'expo-router';
import { ChatFilePreviewRouteScreen } from '@features/chat';

export default function ChatFilePreviewRoute() {
  const params = useLocalSearchParams<{ aiId?: string | string[] }>();
  const aiId = Array.isArray(params.aiId) ? params.aiId[0] : params.aiId;
  return aiId ? <ChatFilePreviewRouteScreen aiId={aiId} /> : <Redirect href={'/conversations' as Href} />;
}
