/** 新增 MCP Server 路由适配。 */
import { useRouter } from 'expo-router';
import { McpServerConfigScreen } from '@features/mcpTools';

export default function NewMcpServerRoute() {
  const router = useRouter();
  return (
    <McpServerConfigScreen
      serverId={null}
      onBack={() => router.back()}
    />
  );
}
