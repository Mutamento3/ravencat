/** 星云和远星保持静态；固定图元预算，不随屏幕像素面积增长。 */
import React, { memo, useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Defs, Ellipse, Path, RadialGradient, Stop } from 'react-native-svg';
import { useTheme } from '@shared/theme';
import { DISTANT_STARS, GALAXY_DUST } from './galaxyStarField';

function dot(x: number, y: number, radius: number) {
  return `M${x - radius},${y}a${radius},${radius} 0 1,0 ${radius * 2},0a${radius},${radius} 0 1,0 ${-radius * 2},0`;
}

function GalaxyBackground({ width, height }: { width: number; height: number }) {
  const theme = useTheme();
  const starlight = theme.mode === 'dark' ? theme.colors.text.primary : theme.colors.text.inverse;
  const paths = useMemo(() => {
    const distant: string[] = [];
    const bright: string[] = [];
    const dust: string[] = [];
    for (const star of DISTANT_STARS) {
      (star.brightness > 0.8 ? bright : distant).push(dot(star.x * width, star.y * height, star.size));
    }
    for (const star of GALAXY_DUST) {
      const spread = (star.y - 0.5) * height * 0.25;
      dust.push(dot(star.x * width, height * (0.24 + star.x * 0.4) + spread, star.size * 0.4));
    }
    return { distant: distant.join(''), bright: bright.join(''), dust: dust.join('') };
  }, [width, height]);

  return <View style={StyleSheet.absoluteFill} pointerEvents="none">
    <Svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
      <Defs>
        {[0, 1, 2].map(i => {
          return <RadialGradient key={i} id={`nebula-${i}`} cx="50%" cy="50%" rx="50%" ry="50%">
            <Stop offset="0" stopColor={theme.colors.brand.primary} stopOpacity={0.18} />
            <Stop offset="0.45" stopColor={theme.colors.brand.primary} stopOpacity={0.07} />
            <Stop offset="1" stopColor={theme.colors.brand.primary} stopOpacity={0} />
          </RadialGradient>;
        })}
      </Defs>
      {[0, 1, 2].map(i => <Ellipse key={i} cx={width * (0.08 + i * 0.44)} cy={height * (0.28 + i * 0.18)} rx={width * 0.65} ry={height * 0.22} fill={`url(#nebula-${i})`} />)}
      <Path d={paths.dust} fill={starlight} opacity={0.16} />
      <Path d={paths.distant} fill={starlight} opacity={0.35} />
      <Path d={paths.bright} fill={starlight} opacity={0.65} />
    </Svg>
  </View>;
}

export default memo(GalaxyBackground);
