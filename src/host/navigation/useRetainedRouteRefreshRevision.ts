/** 将 Expo Router 的焦点生命周期转换成 Feature 可消费的刷新版本。 */
import { useCallback, useReducer } from 'react';
import { useFocusEffect } from 'expo-router';
import {
  INITIAL_RETAINED_ROUTE_REFRESH_STATE,
  reduceRetainedRouteFocus,
} from './retainedRouteRefreshContract';

export default function useRetainedRouteRefreshRevision(): number {
  const [refreshState, onFocus] = useReducer(
    reduceRetainedRouteFocus,
    INITIAL_RETAINED_ROUTE_REFRESH_STATE,
  );

  useFocusEffect(useCallback(() => {
    onFocus();
  }, []));

  return refreshState.revision;
}
