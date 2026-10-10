/** RavenCat「主动生活」路由。 */
import { useRouter } from 'expo-router';
import { ProactiveLifeScreen } from '@features/companion';

export default function RavenCatProactiveLifeRoute() {
  const router = useRouter();
  return (
    <ProactiveLifeScreen
      onBack={() => router.back()}
    />
  );
}
