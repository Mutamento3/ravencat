/** 为纸条主题绘制随消息滚动的横线，并固定姓名与正文的行结构。 */
import React, { memo, useCallback, useMemo, useState, type ReactNode } from 'react';
import { StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';

import { useThemedStyles } from '@shared/theme';
import { createMessageBubbleStyles } from './styles';

const PAPER_LINE_HEIGHT = 30;

interface PaperNoteMessageFrameProps {
  speakerName: string;
  children: ReactNode;
  isSelected?: boolean;
}

function PaperNoteMessageFrame({
  speakerName,
  children,
  isSelected = false,
}: PaperNoteMessageFrameProps) {
  const styles = useThemedStyles(createMessageBubbleStyles);
  const [height, setHeight] = useState(PAPER_LINE_HEIGHT * 2);
  const lineCount = Math.max(2, Math.ceil(height / PAPER_LINE_HEIGHT));
  const lines = useMemo(
    () => Array.from({ length: lineCount }, (_, index) => index),
    [lineCount]
  );

  const handleLayout = useCallback((event: LayoutChangeEvent) => {
    const nextHeight = event.nativeEvent.layout.height;
    setHeight((previousHeight) => previousHeight === nextHeight ? previousHeight : nextHeight);
  }, []);

  return (
    <View
      style={[styles.paperNoteFrame, { minHeight: lineCount * PAPER_LINE_HEIGHT }]}
    >
      <View pointerEvents="none" style={styles.paperNoteRules}>
        {lines.map((lineIndex) => (
          <View
            key={lineIndex}
            style={[
              styles.paperNoteRule,
              { top: (lineIndex + 1) * PAPER_LINE_HEIGHT - StyleSheet.hairlineWidth },
            ]}
          />
        ))}
      </View>
      {isSelected ? <View pointerEvents="none" style={styles.paperNoteSelection} /> : null}
      <View onLayout={handleLayout}>
        <Text numberOfLines={1} style={styles.paperNoteSpeaker}>
          {speakerName}：
        </Text>
        <View style={styles.paperNoteBody}>{children}</View>
      </View>
    </View>
  );
}

export default memo(PaperNoteMessageFrame);
