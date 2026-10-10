/** 描述保活路由获得焦点后是否应刷新页面数据。 */
export interface RetainedRouteRefreshState {
  hasFocused: boolean;
  revision: number;
}

export const INITIAL_RETAINED_ROUTE_REFRESH_STATE: RetainedRouteRefreshState = {
  hasFocused: false,
  revision: 0,
};

export function reduceRetainedRouteFocus(
  state: RetainedRouteRefreshState,
): RetainedRouteRefreshState {
  if (!state.hasFocused) {
    return {
      hasFocused: true,
      revision: state.revision,
    };
  }

  return {
    hasFocused: true,
    revision: state.revision + 1,
  };
}
