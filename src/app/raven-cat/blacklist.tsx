/** RavenCat 设备观察软件黑名单路由。 */
import { useRouter } from 'expo-router';
import { CompanionBlacklistScreen } from '@features/companion';

export default function RavenCatBlacklistRoute() {
  const router = useRouter();
  return (
    <CompanionBlacklistScreen
      onBack={() => router.back()}
    />
  );
}
