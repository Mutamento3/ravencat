import type { ReactNode } from 'react';
import type { ViewProps } from 'react-native';

export interface LiquidGlassMaterial {
  blurRadius: number;
  cornerRadius: number;
  refractionHeight: number;
  refractionOffset: number;
  dispersion: number;
  tintColor: string;
  tintAlpha: number;
}

export interface LiquidGlassBackdropProps extends ViewProps {
  children: ReactNode;
  sceneId: string;
}

export interface LiquidGlassEffectProps extends Omit<ViewProps, 'children'> {
  material?: Partial<LiquidGlassMaterial>;
  sceneId: string;
  /** 融合轮廓（dp）：栏顶、球心 x/y、球半径 x/y、融合半径；缺省为圆角矩形。 */
  fluidShape?: number[];
}
