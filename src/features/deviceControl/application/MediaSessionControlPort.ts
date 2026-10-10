/**
 * Device Control 对 Android MediaSession transport control 的稳定应用层契约。
 *
 * 与 MediaSessionObservationPort 明确分开：
 * 读事实与对外副作用是两种语义，不能为了少一个文件混在同一个 port 里。
 */

/**
 * exact-package transport command。
 *
 * 刻意不提供 'play'：resume 语义是“恢复当前 session”，对应 TransportControls.play()；
 * 它不是“播放指定歌曲”，后台精确选歌不属于本 primitive。
 */
export type MediaSessionTransportCommand = 'pause' | 'resume' | 'next' | 'previous';

/**
 * command_dispatched 只代表请求已交给目标 session，不代表 playback state 已经改变。
 *
 * 执行真值与观察真值分离：最终 playback 事实必须由一次新的
 * MediaSessionObservationPort.getMediaSessionSnapshot 独立观察。
 * no_active_session 不代表目标 App 未安装，只代表当前没有该 package 的 active session。
 * action_not_supported 代表目标 session 没有 advertise 该 command 对应的 action bit，
 * 此时 transport 调用次数为 0。
 */
export type MediaSessionTransportResult =
  | {
      status: 'command_dispatched';
      packageName: string;
      command: MediaSessionTransportCommand;
    }
  | { status: 'permission_not_granted' }
  | { status: 'no_active_session'; packageName: string }
  | {
      status: 'action_not_supported';
      packageName: string;
      command: MediaSessionTransportCommand;
    }
  | { status: 'invalid_package_name'; reason: string }
  | { status: 'invalid_command'; reason: string }
  | {
      status: 'dispatch_failed';
      packageName: string;
      command: MediaSessionTransportCommand;
      reason: string;
    };

export interface MediaSessionControlPort {
  dispatchMediaSessionCommand(
    packageName: string,
    command: MediaSessionTransportCommand,
  ): Promise<MediaSessionTransportResult>;
}
