/** 管理 Chat shell 使用的 AI 助手列表状态。 */

import { useCallback, useRef, useState } from 'react';
import type { AIProfile } from '@features/assistants';
import {
  deleteAIAssistant,
  listAIAssistants,
} from '@features/assistants';
import { withArrivedConversationPreview } from './arrivedConversationPreview';
import { getAssistantMessageArrivalSnapshot } from '../../reply/delivery/AssistantMessageArrival';

export default function useAIAssistants() {
  const [aiList, setAiList] = useState<AIProfile[]>([]);
  const [aiListReady, setAiListReady] = useState(false);
  const loadFlightRef = useRef<{ arrival: ReturnType<typeof getAssistantMessageArrivalSnapshot>; promise: Promise<AIProfile[]> } | null>(null);

  const loadAIAssistants = useCallback(() => {
    const arrival = getAssistantMessageArrivalSnapshot();
    const existingFlight = loadFlightRef.current;
    if (existingFlight?.arrival === arrival) {
      return existingFlight.promise;
    }

    const loadFlight = listAIAssistants().then(async (profiles) => {
      const list = await Promise.all(profiles.map((profile) => withArrivedConversationPreview(profile, profile.canonicalConversationId)));
      if (loadFlightRef.current?.promise === loadFlight && arrival === getAssistantMessageArrivalSnapshot()) {
        setAiList(list);
        setAiListReady(true);
      }
      return list;
    });
    loadFlightRef.current = { arrival, promise: loadFlight };
    const clearFlight = () => {
      if (loadFlightRef.current?.promise === loadFlight) {
        loadFlightRef.current = null;
      }
    };
    void loadFlight.then(clearFlight, clearFlight);
    return loadFlight;
  }, []);

  const removeAIAssistant = useCallback(async (aiId: string) => {
    await deleteAIAssistant(aiId);
    await loadAIAssistants();
  }, [loadAIAssistants]);

  return {
    aiList,
    aiListReady,
    loadAIAssistants,
    removeAIAssistant,
    setAiList,
  };
}
