import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { AppState, BackHandler } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { AutoSaveDraftEditor, type DraftCommit } from './AutoSaveDraftEditor';

/** 页面负责交互生命周期；后台提交与前台返回复用同一输入确认 owner。 */
export function useAutoSaveDraft<D extends object, P>({
  initial, parse, save, enabled = true,
}: {
  initial: D;
  parse(draft: D, changed: (keyof D)[]): DraftCommit<D, P>;
  save(patch: P): Promise<void>;
  enabled?: boolean;
}) {
  const saveRef = useRef(save);
  saveRef.current = save;
  const [editor] = useState(() => new AutoSaveDraftEditor(initial, parse, (patch) => saveRef.current(patch)));
  const state = useSyncExternalStore(editor.subscribe, editor.getSnapshot);
  useEffect(() => { editor.rebase(initial); }, [editor, initial]);
  useEffect(() => {
    if (!enabled) return;
    const subscription = AppState.addEventListener('change', (next) => {
      if (next !== 'active' && editor.getSnapshot().dirty) void editor.flush();
    });
    return () => { subscription.remove(); editor.cancelTimer(); };
  }, [editor, enabled]);
  const change = useCallback((patch: Partial<D>, immediate = false) => {
    editor.change(patch, enabled && immediate);
    if (!enabled) editor.cancelTimer();
  }, [editor, enabled]);
  return { ...state, change, flush: editor.flush, restore: editor.restore, validateAll: editor.validateAll, getSnapshot: editor.getSnapshot };
}

export function useAutoSaveNavigation(
  flush: () => Promise<boolean>,
  onBack: () => void,
  revealErrors: () => void,
  enabled = true,
) {
  const leaving = useRef(false);
  const leave = useCallback(async (action: () => void) => {
    if (leaving.current) return;
    leaving.current = true;
    try {
      if (!enabled || await flush()) action();
      else revealErrors();
    } finally { leaving.current = false; }
  }, [enabled, flush, revealErrors]);
  const back = useCallback(() => { void leave(onBack); }, [leave, onBack]);
  useFocusEffect(useCallback(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      back();
      return true;
    });
    return () => subscription.remove();
  }, [back]));
  return { leave, back };
}
