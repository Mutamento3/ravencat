import { useCallback, useEffect, useRef, useState } from 'react';
import type { AppStateStatus } from 'react-native';
import { getAIAssistantById, type AIProfile } from '@features/assistants';
import {
  getCurrentUserProfile,
  subscribeUserProfileUpdated,
  type UserProfile,
} from '@features/profile';
import {
  leaveTogetherListeningByUser,
} from '../application/LeaveTogetherListeningByUser';
import {
  prepareTogetherListeningInAppPresentationState,
  type TogetherListeningInAppState,
} from '../application/PrepareTogetherListeningInAppPresentation';
import { subscribeTogetherListeningChanged } from '../application/TogetherListeningChangedSignal';
import { TogetherListeningPresentationRefreshController } from './TogetherListeningPresentationRefreshController';
import {
  formatTogetherListeningDuration,
  TogetherListeningDurationTicker,
} from './togetherListeningDuration';
import { buildTogetherListeningInAppViewModel } from './togetherListeningInAppViewModel';

const REFRESH_CADENCE_MS = 2000;
const DURATION_CADENCE_MS = 1000;

export function useTogetherListeningInAppPresentation(appState: AppStateStatus) {
  const mountedRef = useRef(true);
  const [state, setState] = useState<TogetherListeningInAppState | null>(null);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [aiProfile, setAIProfile] = useState<AIProfile | null>(null);
  const [leavePending, setLeavePending] = useState(false);
  const [elapsedMs, setElapsedMs] = useState<number | null>(null);

  const refresh = useCallback(async (): Promise<boolean> => {
    try {
      const next = await prepareTogetherListeningInAppPresentationState();
      if (mountedRef.current) setState(next);
      return next !== null;
    } catch (error) {
      console.warn('[TogetherListening] App 内状态刷新失败：', error);
      return state !== null;
    }
  }, [state]);

  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;
  const controllerRef = useRef<TogetherListeningPresentationRefreshController | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    const controller = new TogetherListeningPresentationRefreshController({
      cadenceMs: REFRESH_CADENCE_MS,
      refresh: () => refreshRef.current(),
      scheduler: {
        setInterval: (callback, cadenceMs) => globalThis.setInterval(callback, cadenceMs),
        clearInterval: (handle) => globalThis.clearInterval(handle as ReturnType<typeof setInterval>),
      },
    });
    controllerRef.current = controller;
    controller.start(false);
    const unsubscribeActivity = subscribeTogetherListeningChanged(() => controller.invalidate());
    const unsubscribeProfile = subscribeUserProfileUpdated(setUserProfile);
    return () => {
      mountedRef.current = false;
      unsubscribeActivity();
      unsubscribeProfile();
      controller.stop();
      if (controllerRef.current === controller) controllerRef.current = null;
    };
  }, []);

  useEffect(() => {
    controllerRef.current?.setForeground(appState === 'active');
  }, [appState]);

  const durationTickerRef = useRef<TogetherListeningDurationTicker | null>(null);
  useEffect(() => {
    const ticker = new TogetherListeningDurationTicker({
      cadenceMs: DURATION_CADENCE_MS,
      nowEpochMs: Date.now,
      onElapsedMs: setElapsedMs,
      scheduler: {
        setInterval: (callback, cadenceMs) => globalThis.setInterval(callback, cadenceMs),
        clearInterval: (handle) => globalThis.clearInterval(handle as ReturnType<typeof setInterval>),
      },
    });
    durationTickerRef.current = ticker;
    return () => {
      ticker.stop();
      if (durationTickerRef.current === ticker) durationTickerRef.current = null;
    };
  }, []);

  const activityId = state?.activityId ?? null;
  const activatedAtEpochMs = state?.activatedAtEpochMs ?? null;
  useEffect(() => {
    durationTickerRef.current?.update(activatedAtEpochMs, appState === 'active');
  }, [activatedAtEpochMs, activityId, appState]);

  const hostAiId = state?.hostAiId ?? null;
  useEffect(() => {
    let cancelled = false;
    if (!activityId || !hostAiId) {
      setAIProfile(null);
      return () => { cancelled = true; };
    }
    void Promise.allSettled([
      getCurrentUserProfile(),
      getAIAssistantById(hostAiId),
    ]).then(([userResult, aiResult]) => {
      if (cancelled) return;
      setUserProfile(userResult.status === 'fulfilled' ? userResult.value : null);
      setAIProfile(aiResult.status === 'fulfilled' ? aiResult.value : null);
    });
    return () => { cancelled = true; };
  }, [activityId, hostAiId]);

  const leave = useCallback(async () => {
    if (!state || leavePending) return;
    setLeavePending(true);
    try {
      await leaveTogetherListeningByUser({
        activityId: state.activityId,
        source: 'in_app_indicator',
      });
      await refreshRef.current();
    } finally {
      if (mountedRef.current) setLeavePending(false);
    }
  }, [leavePending, state]);

  return {
    viewModel: state
      ? buildTogetherListeningInAppViewModel({
          state,
          userProfile,
          aiProfile,
          durationText: elapsedMs === null
            ? null
            : formatTogetherListeningDuration(elapsedMs),
        })
      : null,
    leave,
    leavePending,
  };
}
