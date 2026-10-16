/** 搜索配置入口与返回由 App 路由适配拥有。 */
import { useRouter } from 'expo-router';
import { WebSearchSettingsScreen } from '@features/webTools';
import { useRetainedRouteRefreshRevision } from '@host';

export default function WebSearchSettingsRoute() {
  const router = useRouter();
  const refreshRevision = useRetainedRouteRefreshRevision();
  return <WebSearchSettingsScreen onBack={() => router.back()} refreshRevision={refreshRevision} />;
}
