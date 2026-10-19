/** 展开意图归会话列表所有，尺寸仍归可回收的卡片实例所有。 */
import { createContext, useCallback, useContext } from 'react';
import { useRecyclingState } from '@shopify/flash-list';

export const ReasoningExpansionContext = createContext<Set<string | number> | null>(null);

export function useReasoningExpansion(key: string | number): [boolean, (expanded: boolean) => void] {
  const expandedKeys = useContext(ReasoningExpansionContext)!;
  const [expanded, setExpanded] = useRecyclingState(() => expandedKeys.has(key), [expandedKeys, key]);
  const updateExpanded = useCallback((next: boolean) => {
    if (next) expandedKeys.add(key);
    else expandedKeys.delete(key);
    setExpanded(next);
  }, [expandedKeys, key, setExpanded]);
  return [expanded, updateExpanded];
}
