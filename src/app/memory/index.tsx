/** 记忆管理页的路由适配。 */
import { type Href, useRouter } from 'expo-router';
import { MemoryScreen } from '@features/memory';
export default function MemoryRoute() {
  const router = useRouter();
  return <MemoryScreen
    onBack={() => router.back()}
    onOpenSettings={(assistantId) => router.push({ pathname: '/memory/settings', params: { assistantId } } as Href)}
    onCreateMemory={(assistantId) => router.push({ pathname: '/memory/edit', params: { assistantId } } as Href)}
    onEditMemory={(assistantId, memoryId) => router.push({ pathname: '/memory/edit', params: { assistantId, memoryId } } as Href)}
    onOpenTrigger={(assistantId, triggerId) => router.push({ pathname: '/memory/trigger', params: { assistantId, triggerId } } as Href)}
  />;
}
