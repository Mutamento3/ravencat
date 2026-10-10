/** 单聊模型设置路由。 */
import { Redirect, type Href, useLocalSearchParams, useRouter } from 'expo-router';
import { ChatModelSettingsRouteScreen } from '@features/chat';

export default function ChatModelSettingsRoute() {
  const router = useRouter();
  const params = useLocalSearchParams<{ aiId?: string | string[] }>();
  const aiId = Array.isArray(params.aiId) ? params.aiId[0] : params.aiId;
  return aiId ? (
    <ChatModelSettingsRouteScreen
      aiId={aiId}
      onManageModels={(kind) => router.push(`/auxiliary-models/capabilities/${kind}` as Href)}
    />
  ) : <Redirect href={'/conversations' as Href} />;
}
