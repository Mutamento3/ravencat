/** RavenCat 悬浮交互设置路由。 */

import { type Href, useRouter } from 'expo-router';
import { FloatingInteractionScreen } from '@features/floatingLayer';

export default function RavenCatFloatingInteractionRoute() {
  const router = useRouter();
  return (
    <FloatingInteractionScreen
      onBack={() => router.back()}
      onOpenSystemAccess={() => router.push('/raven-cat/system-access' as Href)}
    />
  );
}
