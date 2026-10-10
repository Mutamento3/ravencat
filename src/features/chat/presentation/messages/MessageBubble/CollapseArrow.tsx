/** 渲染思维链折叠状态对应的箭头指示。 */

import React from 'react';
import { Text } from 'react-native';

interface CollapseArrowProps {
  isExpanded: boolean;
  styles: {
    arrow: any;
    arrowExpanded: any;
  };
}

export const CollapseArrow = ({ isExpanded, styles }: CollapseArrowProps) => (
  <Text style={[styles.arrow, isExpanded && styles.arrowExpanded]}>
    {'<'}
  </Text>
);
