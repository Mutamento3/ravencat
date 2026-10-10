/** RavenCat 设置主路由。 */
import { useCallback, useRef, useState } from 'react';
import { type Href, useFocusEffect, useRouter } from 'expo-router';
import { CompanionSettingsScreen } from '@features/companion';

export default function RavenCatRoute() {
  const router = useRouter();
  const [refreshRevision, setRefreshRevision] = useState(0);
  const hasFocusedRef = useRef(false);
  useFocusEffect(useCallback(() => {
    if (hasFocusedRef.current) {
      setRefreshRevision((revision) => revision + 1);
    } else {
      hasFocusedRef.current = true;
    }
  }, []));
  return (
    <CompanionSettingsScreen
      refreshRevision={refreshRevision}
      onBack={() => router.back()}
      onOpenScreen={(screen) => {
        const path = screen === 'blacklist'
          ? '/raven-cat/blacklist'
          : '/raven-cat/proactive-life';
        router.push(path as Href);
      }}
    />
  );
}
