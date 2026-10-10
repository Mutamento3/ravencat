/** 渲染官方复刻风格的思维链或工具过程卡片，并协调嵌套滚动。 */

import React, { memo, useCallback, useEffect, useRef } from 'react';
import {
  type GestureResponderEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  ScrollView,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import type { createMessageBubbleStyles } from './styles';
import type { PresentationTheme } from '@shared/theme';

type ProcessCardIconName = React.ComponentProps<typeof Ionicons>['name'];

interface OfficialReplicaProcessCardProps {
  title: string;
  iconName: ProcessCardIconName;
  theme: PresentationTheme;
  styles: ReturnType<typeof createMessageBubbleStyles>;
  children?: React.ReactNode;
  collapsible?: boolean;
  expanded?: boolean;
  onToggle?: () => void;
  scrollable?: boolean;
  showsVerticalScrollIndicator?: boolean;
  onBodyLayout?: React.ComponentProps<typeof ScrollView>['onLayout'];
  onContentSizeChange?: React.ComponentProps<typeof ScrollView>['onContentSizeChange'];
  onNestedScrollActiveChange?: (isActive: boolean) => void;
}

const SCROLL_BOUNDARY_EPSILON = 2;
const SCROLL_DIRECTION_THRESHOLD = 3;

function OfficialReplicaProcessCard({
  title,
  iconName,
  theme,
  styles,
  children,
  collapsible = false,
  expanded = false,
  onToggle,
  scrollable = false,
  showsVerticalScrollIndicator = false,
  onBodyLayout,
  onContentSizeChange,
  onNestedScrollActiveChange,
}: OfficialReplicaProcessCardProps) {
  const touchStartYRef = useRef(0);
  const scrollOffsetYRef = useRef(0);
  const bodyHeightRef = useRef(0);
  const contentHeightRef = useRef(0);
  const isNestedScrollActiveRef = useRef(false);

  // Moon Kimi reasoning cards live inside FlashList. Keep this handshake intact:
  // the child scroll only owns the gesture while it can move away from its own edges.
  const setNestedScrollActive = useCallback((isActive: boolean) => {
    if (isNestedScrollActiveRef.current === isActive) {
      return;
    }

    isNestedScrollActiveRef.current = isActive;
    onNestedScrollActiveChange?.(isActive);
  }, [onNestedScrollActiveChange]);

  const getMaxScrollOffset = useCallback(() => (
    Math.max(0, contentHeightRef.current - bodyHeightRef.current)
  ), []);

  const canConsumeDrag = useCallback((dragDeltaY: number) => {
    if (!scrollable) {
      return false;
    }

    if (Math.abs(dragDeltaY) < SCROLL_DIRECTION_THRESHOLD) {
      return isNestedScrollActiveRef.current;
    }

    const maxScrollOffset = getMaxScrollOffset();
    if (maxScrollOffset <= SCROLL_BOUNDARY_EPSILON) {
      return false;
    }

    const currentOffsetY = scrollOffsetYRef.current;
    const isDraggingDown = dragDeltaY > 0;
    const isDraggingUp = dragDeltaY < 0;

    // At top/bottom boundaries, return control to the parent FlashList.
    if (isDraggingDown) {
      return currentOffsetY > SCROLL_BOUNDARY_EPSILON;
    }

    if (isDraggingUp) {
      return currentOffsetY < maxScrollOffset - SCROLL_BOUNDARY_EPSILON;
    }

    return false;
  }, [getMaxScrollOffset, scrollable]);

  useEffect(() => {
    if (!expanded || !scrollable) {
      setNestedScrollActive(false);
    }
  }, [expanded, scrollable, setNestedScrollActive]);

  useEffect(() => (
    () => setNestedScrollActive(false)
  ), [setNestedScrollActive]);

  const handleBodyLayout = useCallback<NonNullable<React.ComponentProps<typeof ScrollView>['onLayout']>>((event) => {
    bodyHeightRef.current = event.nativeEvent.layout.height;
    onBodyLayout?.(event);
  }, [onBodyLayout]);

  const handleContentSizeChange = useCallback((width: number, height: number) => {
    contentHeightRef.current = height;
    onContentSizeChange?.(width, height);
  }, [onContentSizeChange]);

  const handleTouchStart = useCallback((event: GestureResponderEvent) => {
    touchStartYRef.current = event.nativeEvent.pageY;
  }, []);

  const handleTouchMove = useCallback((event: GestureResponderEvent) => {
    const dragDeltaY = event.nativeEvent.pageY - touchStartYRef.current;
    setNestedScrollActive(canConsumeDrag(dragDeltaY));
  }, [canConsumeDrag, setNestedScrollActive]);

  const handleTouchEnd = useCallback(() => {
    setNestedScrollActive(false);
  }, [setNestedScrollActive]);

  const handleScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
    scrollOffsetYRef.current = Math.max(0, contentOffset.y);
    contentHeightRef.current = contentSize.height;
    bodyHeightRef.current = layoutMeasurement.height;

    const maxScrollOffset = getMaxScrollOffset();
    if (
      scrollOffsetYRef.current <= SCROLL_BOUNDARY_EPSILON ||
      scrollOffsetYRef.current >= maxScrollOffset - SCROLL_BOUNDARY_EPSILON
    ) {
      setNestedScrollActive(false);
    }
  }, [getMaxScrollOffset, setNestedScrollActive]);

  const headerContent = (
    <>
      <Ionicons
        name={iconName}
        size={20}
        color={theme.colors.icon.secondary}
        style={styles.moonKimiProcessIcon}
      />
      <Text style={styles.moonKimiProcessLabel}>{title}</Text>
      {collapsible ? (
        <Ionicons
          name={expanded ? 'chevron-down' : 'chevron-forward'}
          size={18}
          color={theme.colors.text.tertiary}
        />
      ) : null}
    </>
  );

  return (
    <View style={styles.moonKimiProcessCard}>
      {collapsible ? (
        <TouchableOpacity
          style={styles.moonKimiProcessHeader}
          onPress={onToggle}
          activeOpacity={0.8}
        >
          {headerContent}
        </TouchableOpacity>
      ) : (
        <View style={styles.moonKimiProcessHeader}>
          {headerContent}
        </View>
      )}

      {expanded && children ? (
        <ScrollView
          style={styles.moonKimiProcessBody}
          contentContainerStyle={styles.moonKimiProcessBodyContent}
          nestedScrollEnabled
          scrollEnabled={scrollable}
          showsVerticalScrollIndicator={showsVerticalScrollIndicator}
          keyboardShouldPersistTaps="handled"
          overScrollMode="never"
          scrollEventThrottle={16}
          onLayout={handleBodyLayout}
          onContentSizeChange={handleContentSizeChange}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
          onTouchCancel={handleTouchEnd}
          onScroll={handleScroll}
          onScrollEndDrag={handleTouchEnd}
          onMomentumScrollEnd={handleTouchEnd}
        >
          {children}
        </ScrollView>
      ) : null}
    </View>
  );
}

export default memo(OfficialReplicaProcessCard);
