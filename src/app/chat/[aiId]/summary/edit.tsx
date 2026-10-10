/** 摘要新建与编辑路由。 */
import { Redirect, type Href, useLocalSearchParams } from 'expo-router';
import { ChatSummaryEditorRouteScreen } from '@features/chat';

export default function ChatSummaryEditorRoute() {
  const params = useLocalSearchParams<{ aiId?: string | string[]; segmentId?: string | string[] }>();
  const aiId = Array.isArray(params.aiId) ? params.aiId[0] : params.aiId;
  const segmentId = Array.isArray(params.segmentId) ? params.segmentId[0] : params.segmentId;
  return aiId ? <ChatSummaryEditorRouteScreen aiId={aiId} segmentId={segmentId} />
    : <Redirect href={'/conversations' as Href} />;
}
