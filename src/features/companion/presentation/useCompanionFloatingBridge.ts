/** 连接 React 前台状态与 RavenCat 主动唤醒观察。 */

import { useCallback, useEffect, useRef } from 'react';

import {
  addCompanionWakeListener,
  getNativeHealth,
  recordProactiveAgentRunState,
  type CompanionWakeEvent,
} from '../application';

interface UseCompanionFloatingBridgeParams {
  dbReady: boolean;
  appState: string;
}

const MAX_PENDING_WAKE_EVENTS = 3;
export function useCompanionFloatingBridge({
  dbReady,
  appState,
}: UseCompanionFloatingBridgeParams) {
  const pendingWakeEventsRef = useRef<CompanionWakeEvent[]>([]);
  const handledWakeEventIdsRef = useRef(new Set<string>());
  const pendingWakeRecoveryRef = useRef(false);
  const enqueueWakeEvent = useCallback((event: CompanionWakeEvent) => {
    pendingWakeEventsRef.current = [
      ...pendingWakeEventsRef.current,
      event,
    ].slice(-MAX_PENDING_WAKE_EVENTS);
  }, []);

  const handleCompanionWake = useCallback(async (
    event: CompanionWakeEvent
  ) => {
    // 前台 observer 去重按 delivery identity，AI Schedule v1/v2 共用 scheduleId 不互相吞。
    const observerIdentity = event.deliveryEventId ?? event.eventId;
    if (handledWakeEventIdsRef.current.has(observerIdentity)) {
      return;
    }

    if (!dbReady) {
      enqueueWakeEvent(event);
      return;
    }

    handledWakeEventIdsRef.current.add(observerIdentity);
    const nativeHealth = await getNativeHealth();
    if (!nativeHealth.lastHeadlessTaskStartAccepted) {
      pendingWakeRecoveryRef.current = true;
      await recordProactiveAgentRunState({
        status: 'blocked',
        lastWakeReason: event.wakeReason,
        lastDecisionReason: 'runtime_background_deferred',
        lastError: null,
      });
      return;
    }

    console.info('[CompanionFloatingBridge] companion wake submitted to background JS', {
      eventId: event.eventId,
      wakeReason: event.wakeReason,
      source: event.source,
    });
  }, [dbReady, enqueueWakeEvent]);

  useEffect(() => {
    const subscription = addCompanionWakeListener((event) => {
      void handleCompanionWake(event).catch((error) => {
        console.error('[CompanionFloatingBridge] Failed to handle companion wake:', error);
      });
    });

    return () => {
      subscription.remove();
    };
  }, [handleCompanionWake]);

  useEffect(() => {
    if (!dbReady || appState !== 'active') {
      return;
    }
    // 正式恢复只能由 SQLite attempt + 唯一原生恢复任务驱动；前台生命周期不得补跑 AI。
    pendingWakeRecoveryRef.current = false;
  }, [appState, dbReady]);

  useEffect(() => {
    if (!dbReady || pendingWakeEventsRef.current.length === 0) {
      return;
    }

    const events = pendingWakeEventsRef.current;
    pendingWakeEventsRef.current = [];

    events.forEach((event) => {
      void handleCompanionWake(event).catch((error) => {
        console.error('[CompanionFloatingBridge] Failed to drain companion wake:', error);
      });
    });
  }, [dbReady, handleCompanionWake]);
}
