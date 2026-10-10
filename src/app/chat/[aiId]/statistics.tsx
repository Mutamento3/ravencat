/** 相遇痕迹与「更多」的其他功能共用原生 Stack，系统手势和返回键由 Router 处理。 */
import { Redirect, type Href, useLocalSearchParams } from 'expo-router';
import { ChatStatisticsRouteScreen } from '@features/chat';

export default function ChatStatisticsRoute() {
  const params = useLocalSearchParams<{ aiId?: string | string[] }>();
  const aiId = Array.isArray(params.aiId) ? params.aiId[0] : params.aiId;
  return aiId ? <ChatStatisticsRouteScreen aiId={aiId} /> : <Redirect href={'/conversations' as Href} />;
}
