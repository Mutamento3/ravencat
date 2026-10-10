/** 页面提交期间沿用弹窗的返回约束，避免重复提交或提前离开。 */
import { useCallback } from 'react';
import { BackHandler } from 'react-native';
import { useFocusEffect } from 'expo-router';

export default function useBusyBackHandler(busy: boolean) {
  useFocusEffect(useCallback(() => {
    if (!busy) return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => true);
    return () => subscription.remove();
  }, [busy]));
}
