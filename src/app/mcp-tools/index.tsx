/** MCP 工具中心路由适配。 */
import { type Href, useRouter } from 'expo-router';
import { McpToolsCenterScreen } from '@features/mcpTools';
import { useRetainedRouteRefreshRevision } from '@host';

export default function McpToolsRoute() {
  const router = useRouter();
  const refreshRevision = useRetainedRouteRefreshRevision();
  return (
    <McpToolsCenterScreen
      refreshRevision={refreshRevision}
      onBack={() => router.back()}
      onAddServer={() => router.push('/mcp-tools/new' as Href)}
      onOpenServer={(serverId) => {
        router.push(`/mcp-tools/${encodeURIComponent(serverId)}` as Href);
      }}
    />
  );
}
