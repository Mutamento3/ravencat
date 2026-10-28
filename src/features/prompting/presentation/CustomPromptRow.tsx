/** 长按后按纵向位移交换条目；持久化排序由 application 事务负责。 */
import { ThemedSurface } from '@shared/theme';
import { ToggleField } from '@shared/ui';
import React, { useMemo, useRef, useState } from 'react';
import { PanResponder, Text, TouchableOpacity, View } from 'react-native';
import type { DefaultUserPrompt } from '../domain/PromptDefaults';
import type { UserPromptCondition } from '../domain/Prompting';
import type { createPromptCenterStyles } from './promptCenterStyles';

export function CustomPromptRow({ prompt, index, disabled, styles, onEdit, onToggle, onMove, onDelete }: {
  prompt: DefaultUserPrompt & { condition?: UserPromptCondition };
  index: number;
  disabled: boolean;
  styles: ReturnType<typeof createPromptCenterStyles>;
  onEdit: () => void;
  onToggle: (enabled: boolean) => void;
  onMove: (offset: number) => void;
  onDelete: () => void;
}) {
  const armed = useRef(false);
  const [dragging, setDragging] = useState(false);
  const pan = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponderCapture: (_, gesture) => armed.current && Math.abs(gesture.dy) > 8,
    onPanResponderTerminationRequest: () => false,
    onPanResponderRelease: (_, gesture) => {
      if (Math.abs(gesture.dy) > 30) onMove(gesture.dy > 0 ? 1 : -1);
      armed.current = false; setDragging(false);
    },
    onPanResponderTerminate: () => { armed.current = false; setDragging(false); },
  }), [onMove]);
  return <ThemedSurface variant="card" nativeGlass={false} {...pan.panHandlers} onTouchEnd={() => { armed.current = false; setDragging(false); }} style={[styles.card, dragging && styles.dragging]}>
    <ToggleField layout="inline" rowStyle={styles.cardHeader} label={prompt.name} accessibilityLabel={`启用提示词：${prompt.name}`}
      disabled={disabled} value={prompt.enabled} onValueChange={onToggle}>
      <Text style={styles.number}>{index + 1}</Text><Text style={[styles.title, styles.copy]}>{prompt.name}</Text>
    </ToggleField>
    <TouchableOpacity disabled={disabled} onPress={() => { if (armed.current) { armed.current = false; setDragging(false); } else onEdit(); }} delayLongPress={280} onLongPress={() => { armed.current = true; setDragging(true); }}><Text style={styles.body} numberOfLines={3}>{prompt.content}</Text></TouchableOpacity>
    <View style={styles.actions}><Text style={styles.subtitle}>{prompt.condition && prompt.condition !== 'always' ? `${CONDITION_LABELS[prompt.condition]} · ` : ''}长按正文上下移动</Text><TouchableOpacity disabled={disabled} onPress={onDelete}><Text style={styles.danger}>删除</Text></TouchableOpacity></View>
  </ThemedSurface>;
}

const CONDITION_LABELS: Record<UserPromptCondition, string> = {
  always: '常驻', private_chat: '仅私聊', group_chat: '仅群聊', call: '仅通话',
  image_present: '本轮有图片', tools_enabled: '工具开启时', moments: '已退役条件',
};
