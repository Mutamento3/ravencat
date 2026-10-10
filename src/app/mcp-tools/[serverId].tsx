/** MCP Server 配置路由适配。 */
import { useLocalSearchParams, useRouter } from 'expo-router';
import { McpServerConfigScreen } from '@features/mcpTools';

export default function McpServerConfigRoute() {
  const router = useRouter();
  const params = useLocalSearchParams<{ serverId: string }>();
  return (
    <McpServerConfigScreen
      serverId={params.serverId}
      onBack={() => router.back()}
    />
  );
}
