import { useEffect, useState } from 'react';
import { AppState } from 'react-native';

/** AppState 是 route focus 无法表达的前后台 presentation 边界。 */
export function useIsAppActive() {
  const [isAppActive, setIsAppActive] = useState(AppState.currentState === 'active');

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      setIsAppActive(state === 'active');
    });
    return () => subscription.remove();
  }, []);

  return isAppActive;
}
