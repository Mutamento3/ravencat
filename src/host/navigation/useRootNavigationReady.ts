/** 订阅 Expo Router 根导航就绪状态，供冷启动自动导航统一门禁。 */
import { useCallback, useEffect, useState } from 'react';
import {
  useNavigationContainerRef,
  useRootNavigationState,
} from 'expo-router';

export function useRootNavigationReady(): boolean {
  const navigationContainerRef = useNavigationContainerRef();
  const rootNavigationState = useRootNavigationState();
  const rootNavigationKey = rootNavigationState?.key;
  const [ready, setReady] = useState(false);

  const refreshReadyState = useCallback(() => {
    setReady(Boolean(rootNavigationKey) && navigationContainerRef.isReady());
  }, [navigationContainerRef, rootNavigationKey]);

  useEffect(() => {
    refreshReadyState();
    const removeReadyListener = navigationContainerRef.addListener(
      'ready',
      refreshReadyState
    );
    const removeStateListener = navigationContainerRef.addListener(
      'state',
      refreshReadyState
    );

    return () => {
      removeReadyListener();
      removeStateListener();
    };
  }, [navigationContainerRef, refreshReadyState]);

  return ready;
}
