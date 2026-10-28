import { EventEmitter, NativeModule, requireNativeModule } from 'expo-modules-core';

export interface NativeCallStart {
  callId: string;
  name: string;
  avatarUri: string | null;
  direction: 'incoming' | 'outgoing';
  returnUri: string;
  ringtoneUri: string | null;
  ringing: boolean;
}
export interface NativeCallCommand {
  callId: string;
  requestId: string;
  action: 'hangup' | 'interrupted' | 'mute';
  muted: boolean;
}
export interface NativeCallSnapshot { uri: string; width: number; height: number }
export interface NativeCallRouteState {
  callId: string; revision: number; route: 'earpiece' | 'speaker' | 'headset' | null;
  availableRoutes: ('earpiece' | 'speaker' | 'headset')[];
  pendingRoute: 'earpiece' | 'speaker' | 'headset' | null; errorMessage: string | null;
}
declare class CallRuntimeNative extends NativeModule {
  start(options: NativeCallStart): Promise<void>;
  ready(callId: string): Promise<void>;
  finish(callId: string): Promise<void>;
  releaseAudio(callId: string): Promise<void>;
  activate(callId: string): Promise<void>;
  isAlive(callId: string): Promise<boolean>;
  getPendingCommands(callId: string): Promise<unknown[]>;
  acknowledge(requestId: string, error: string | null): Promise<void>;
  setCamera(callId: string, enabled: boolean, facing: 'front' | 'back'): Promise<void>;
  capture(callId: string): Promise<NativeCallSnapshot>;
  deleteSnapshot(uri: string): Promise<void>;
  setMicrophone(callId: string, enabled: boolean): Promise<void>;
  setPresentation(callId: string, fullScreen: boolean): Promise<void>;
  getRouteState(): Promise<unknown>;
  selectRoute(callId: string, route: string): Promise<void>;
  hasOverlayPermission(): Promise<boolean>;
  requestOverlayPermission(): Promise<void>;
}
export const nativeCallRuntime = requireNativeModule<CallRuntimeNative>('CallRuntime');
const emitter = new EventEmitter<{
  onCommand: (data: unknown) => void;
  onCancelled: (data: { callId: string }) => void;
  onRoute: (data: unknown) => void;
}>(nativeCallRuntime);

/** 只在原生桥校验外部命令；内部消费者信任此契约。 */
function parseCommand(data: unknown): NativeCallCommand {
  if (!data || typeof data !== 'object') throw new Error('原生通话命令无效');
  const value = data as Record<string, unknown>;
  if (typeof value.callId !== 'string' || typeof value.requestId !== 'string'
    || !['hangup', 'interrupted', 'mute'].includes(value.action as string)
    || typeof value.muted !== 'boolean') throw new Error('原生通话命令无效');
  return value as unknown as NativeCallCommand;
}
export const subscribeNativeCallCommand = (listener: (data: NativeCallCommand) => void) =>
  emitter.addListener('onCommand', (data) => listener(parseCommand(data)));
export async function pendingNativeCallCommands(callId: string): Promise<NativeCallCommand[]> {
  return (await nativeCallRuntime.getPendingCommands(callId)).map(parseCommand);
}
export const subscribeNativeCallCancellation = (listener: (data: { callId: string }) => void) =>
  emitter.addListener('onCancelled', listener);

function parseRoute(data: unknown): NativeCallRouteState {
  const routes = ['earpiece', 'speaker', 'headset'];
  const routeOrNull = (value: unknown) => value === null || routes.includes(value as string);
  if (!data || typeof data !== 'object') throw new Error('原生通话路由状态无效');
  const value = data as Record<string, unknown>;
  if (typeof value.callId !== 'string' || !Number.isInteger(value.revision)
    || !routeOrNull(value.route) || !routeOrNull(value.pendingRoute)
    || !Array.isArray(value.availableRoutes) || !value.availableRoutes.every(route => routes.includes(route))
    || !(value.errorMessage === null || typeof value.errorMessage === 'string')) throw new Error('原生通话路由状态无效');
  return value as unknown as NativeCallRouteState;
}
export async function getNativeCallRoute(): Promise<NativeCallRouteState | null> {
  const state = await nativeCallRuntime.getRouteState();
  return state === null ? null : parseRoute(state);
}
export const subscribeNativeCallRoute = (listener: (state: NativeCallRouteState) => void) =>
  emitter.addListener('onRoute', data => listener(parseRoute(data)));
