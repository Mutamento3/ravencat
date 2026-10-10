/** RavenCat 权限与后台运行路由。 */

import { useRouter } from 'expo-router';
import { CompanionSystemAccessScreen } from '@features/companion';

export default function RavenCatSystemAccessRoute() {
  const router = useRouter();
  return <CompanionSystemAccessScreen onBack={() => router.back()} />;
}
