/** Device Control 原生执行端口的稳定 application contract。 */

/** 下发给 native 的 active lock 投影；只含执行所需字段，不含业务历史。 */
export interface NativeSoftLockProjection {
  id: string;
  targetPackage: string;
  expiresAtEpochMs?: number;
}

/**
 * 从 native 回读的 runtime 投影快照。
 * native toMap() 无条件带 expiresAtEpochMs 键，无到期时是 null 而不是
 * 缺失键；回读方向不能复用下行投影的「可选」表述。
 */
export interface NativeSoftLockState {
  id: string;
  targetPackage: string;
  expiresAtEpochMs: number | null;
}

export type DeviceControlRuntimeStartResult = {
  status: 'started' | 'already_running' | 'background_start_restricted' | 'failed';
  reason: string | null;
};

export type DeviceControlReconcileResult =
  | { status: 'ok'; appliedCount: number }
  | { status: 'runtime_unavailable'; reason: string }
  | { status: 'failed'; reason: string };

export type DeviceControlRuntimeStopResult = {
  status: 'stopped' | 'already_stopped' | 'still_active' | 'failed';
  activeProjectionCount: number;
  reason: string | null;
};

export type DeviceControlRuntimeFailure = {
  code:
    | 'runtime_unavailable'
    | 'background_start_restricted'
    | 'service_start_failed'
    | 'service_stop_failed'
    | 'overlay_permission_missing'
    | 'window_add_failed'
    | 'window_remove_failed'
    | 'launch_failed';
  message: string;
};

export type DeviceControlObservedWindow = {
  packageName: string | null;
  windowId: number | null;
  title: string | null;
  detectionReliable: boolean;
  checkedAtEpochMs: number;
  source: string;
};

export type DeviceControlRuntimeState = {
  serviceRunning: boolean;
  runtimeAttached: boolean;
  observerConnected: boolean;
  currentWindow: DeviceControlObservedWindow | null;
  projectedLocks: NativeSoftLockState[];
  matchingLockId: string | null;
  targetMatched: boolean;
  shouldBlock: boolean;
  attached: boolean;
  attachedLockId: string | null;
  overlayStatus: 'detached' | 'attached' | 'permission_missing' | 'add_failed' | 'remove_failed';
  diagnostics: {
    attachedAtEpochMs: number | null;
    lastReconcileAtEpochMs: number | null;
    lastWindowEventAtEpochMs: number | null;
    lastConnectionEventAtEpochMs: number | null;
    lastFailure: DeviceControlRuntimeFailure | null;
  };
};

/**
 * openApp 的 typed 原生结果。
 * launch_dispatched 只代表启动请求已交给 Android，不代表目标 App 已进入前台。
 */
export type DeviceControlAppLaunchResult =
  | { status: 'launch_dispatched'; packageName: string }
  | { status: 'app_not_launchable'; packageName: string; reason: string }
  | { status: 'launch_failed'; packageName: string; reason: string };

/**
 * dispatchBrowsableUri 的 typed 原生结果；不回传完整 URI。
 *
 * uri_dispatched 只代表 Android 接受了这次 ACTION_VIEW 请求，不代表目标页面已打开、
 * 也不代表任何业务结果（例如音乐已开始播放）。
 * route_unavailable 只代表目标 package 当前没有可接受该 URI 的入口，不断言 package 是否安装。
 */
export type DeviceControlUriDispatchResult =
  | { status: 'uri_dispatched'; packageName: string }
  | { status: 'route_unavailable'; packageName: string; reason: string }
  | { status: 'route_dispatch_failed'; packageName: string; reason: string };

export interface DeviceControlPort {
  /** 从当前合法宿主启动独立 runtime；失败时 native 必须 fail open。 */
  startRuntime(): Promise<DeviceControlRuntimeStartResult>;

  /**
   * 以 application 侧业务真值为权威同步入口：
   * 收到空数组即代表当前没有任何 active lock，native 必须撤下全部投影。
   */
  reconcileSoftLocks(
    activeLocks: NativeSoftLockProjection[]
  ): Promise<DeviceControlReconcileResult>;

  /** 读取实际 Service、observer 与 blocking window 事实，不能由 command 结果推断。 */
  getRuntimeState(): Promise<DeviceControlRuntimeState>;

  /** 仅在 authoritative projection 已为空后请求停止 runtime/Service。 */
  stopRuntimeIfIdle(): Promise<DeviceControlRuntimeStopResult>;

  /** 派发一次 exact package 的 front-door launch 请求，与 Soft Lock runtime 生命周期独立。 */
  openApp(packageName: string): Promise<DeviceControlAppLaunchResult>;

  /**
   * 派发一次 exact package 的 browsable URI 请求。
   * native 只执行 ACTION_VIEW + 单个 URI + exact package，不接受 action / extras / component。
   */
  dispatchBrowsableUri(
    packageName: string,
    uri: string,
  ): Promise<DeviceControlUriDispatchResult>;
}
