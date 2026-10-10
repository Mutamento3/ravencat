/** 在共享主题边界内封装原生背景源，并向后代传递当前玻璃场景 ID。 */
import React, { createContext, useContext } from 'react';
import type { ReactNode } from 'react';
import type { ViewProps } from 'react-native';
import { LiquidGlassBackdrop } from '../../../../modules/liquid-glass';

export const APP_GLASS_SCENE_ID = 'app';

const GlassSceneContext = createContext(APP_GLASS_SCENE_ID);

interface GlassSceneProviderProps {
  children: ReactNode;
  sceneId: string;
}

interface GlassBackdropProps extends ViewProps {
  children: ReactNode;
  sceneId: string;
}

export function getChatGlassSceneId(chatKey?: string | null): string {
  return `chat:${chatKey ?? 'default'}`;
}

export function GlassSceneProvider({
  children,
  sceneId,
}: GlassSceneProviderProps) {
  return (
    <GlassSceneContext.Provider value={sceneId}>
      {children}
    </GlassSceneContext.Provider>
  );
}

export function GlassBackdrop({
  children,
  sceneId,
  ...viewProps
}: GlassBackdropProps) {
  return (
    <LiquidGlassBackdrop
      {...viewProps}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      pointerEvents="none"
      sceneId={sceneId}
    >
      {children}
    </LiquidGlassBackdrop>
  );
}

export function useGlassSceneId(): string {
  return useContext(GlassSceneContext);
}
