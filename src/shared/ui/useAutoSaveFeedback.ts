import { useCallback, useRef, useState } from 'react';
import { ScrollView, type LayoutChangeEvent } from 'react-native';

export function useAutoSaveFeedback(errors: Partial<Record<string, string>>) {
  const scrollRef = useRef<ScrollView>(null);
  const positions = useRef<Record<string, number>>({});
  const [blocked, setBlocked] = useState(false);
  const fieldLayout = (keys: string[]) => (event: LayoutChangeEvent) => {
    for (const key of keys) positions.current[key] = event.nativeEvent.layout.y;
  };
  const revealErrors = useCallback((currentErrors = errors) => {
    setBlocked(true);
    const first = Object.keys(currentErrors).find((key) => positions.current[key] !== undefined);
    scrollRef.current.scrollTo({ y: first ? positions.current[first] : 0, animated: true });
  }, [errors]);
  return { scrollRef, blocked, setBlocked, fieldLayout, revealErrors };
}
