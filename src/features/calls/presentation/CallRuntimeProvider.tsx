import React, { createContext, useContext, useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import { readCallRuntimeView, subscribeCallRuntimeView } from '../application/runtime/CallMediaRuntimeRegistry';
import { getCallRuntimeDependencies } from '../application/runtime/CallRuntimeDependencies';
import type { CallRuntimeView } from '../application/runtime/CallMediaRuntime';

const CallRuntimeContext = createContext<{ callId: string; runtime: CallRuntimeView } | null | undefined>(undefined);

/** 只投影 Headless 持有的媒体状态；卸载不停止采集或 AI 执行。 */
export function CallRuntimeProvider({ callId, minimized, children, onMinimizedCallEnded }: {
  callId: string | null; minimized: boolean; children: ReactNode;
  onMinimizedCallEnded: () => void;
}) {
  const runtime = useSyncExternalStore(subscribeCallRuntimeView, () => callId ? readCallRuntimeView(callId) : null);
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (minimized && runtime?.shouldExit) onMinimizedCallEnded();
  }, [minimized, onMinimizedCallEnded, runtime?.shouldExit]);
  useEffect(() => {
    if (!runtime?.call?.acceptedAt) return;
    const started = Date.parse(runtime.call.acceptedAt);
    const update = () => setElapsed(Math.max(0, Math.floor((Date.now() - started) / 1000)));
    update();
    const timer = setInterval(update, 1000);
    return () => clearInterval(timer);
  }, [runtime?.call?.acceptedAt]);
  useEffect(() => {
    if (callId) void getCallRuntimeDependencies().native.execution.setPresentation(callId, !minimized)
      .catch(error => console.warn('[Calls] 通话展示状态同步失败', error));
  }, [callId, minimized, runtime?.call?.state]);
  return (
    <CallRuntimeContext.Provider value={callId && runtime ? { callId, runtime: { ...runtime, elapsedSeconds: elapsed } } : null}>
      {children}
    </CallRuntimeContext.Provider>
  );
}

export function useCallRuntime(callId: string): CallRuntimeView | null {
  const state = useContext(CallRuntimeContext);
  if (state === undefined) throw new Error('通话页面必须位于 CallRuntimeProvider 内');
  return state?.callId === callId ? state.runtime : null;
}
