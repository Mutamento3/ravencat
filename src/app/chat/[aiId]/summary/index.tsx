/** 聊天摘要与其他单聊管理页面共用原生 Stack。 */
import { Redirect, type Href, useLocalSearchParams, useRouter } from 'expo-router';
import { ChatSummaryRouteScreen } from '@features/chat';

export default function ChatSummaryRoute() {
  const router = useRouter();
  const params = useLocalSearchParams<{ aiId?: string | string[] }>();
  const aiId = Array.isArray(params.aiId) ? params.aiId[0] : params.aiId;
  return aiId ? <ChatSummaryRouteScreen aiId={aiId}
    onCreateSummary={() => router.push(`/chat/${encodeURIComponent(aiId)}/summary/edit` as Href)}
    onEditSummary={(segmentId) => router.push({ pathname: `/chat/${encodeURIComponent(aiId)}/summary/edit`, params: { segmentId } } as Href)}
  /> : <Redirect href={'/conversations' as Href} />;
}
