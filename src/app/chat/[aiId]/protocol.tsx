/** 单聊协议空间路由。 */
import { Redirect, type Href, useLocalSearchParams } from 'expo-router';
import { ChatProtocolRouteScreen } from '@features/chat';
import { transferProtocolToMemory } from '@host/application/TransferProtocolToMemory';

export default function ChatProtocolRoute() {
  const params = useLocalSearchParams<{ aiId?: string | string[] }>();
  const aiId = Array.isArray(params.aiId) ? params.aiId[0] : params.aiId;
  return aiId ? <ChatProtocolRouteScreen aiId={aiId} onConvertToMemory={(protocol, values) => transferProtocolToMemory(aiId, protocol, values)} /> : <Redirect href={'/conversations' as Href} />;
}
