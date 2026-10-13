import { getAssistantDisplayName } from '@features/assistants';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
  type AppStateStatus,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Headphones } from 'lucide-react-native';
import { AVATAR_SHAPE } from '@shared/avatar/avatarConstants';
import { GlassSurface, useTheme } from '@shared/theme';
import { AIAvatar, UserAvatar } from '@shared/ui';
import {
  clampCollapsedVerticalOffset,
  resolveCollapsedVerticalOffsetBounds,
  resolveIndicatorReleaseMode,
  type TogetherListeningIndicatorDisplayMode,
} from './togetherListeningIndicatorPolicy';
import {
  loadTogetherListeningIndicatorPosition,
  saveTogetherListeningIndicatorPosition,
  type TogetherListeningIndicatorPosition,
} from './togetherListeningIndicatorPositionStorage';
import { useTogetherListeningInAppPresentation } from './useTogetherListeningInAppPresentation';

export interface TogetherListeningInAppIndicatorProps {
  appState: AppStateStatus;
  bottomOffset: number;
  visible: boolean;
  onOpenConversation: (hostAiId: string, chatSessionId: string) => void;
}

const EXPANDED_HORIZONTAL_MARGIN = 16;
const EXPANDED_MIN_HEIGHT = 68;
const COLLAPSED_EDGE_MARGIN = 4;
const COLLAPSED_SIZE = 48;
const COLLAPSED_TOP_MARGIN = 4;
const INDICATOR_CORNER_RADIUS = 14;
const PAN_ACTIVATION_OFFSET = 14;
const SPRING_CONFIG = { damping: 22, stiffness: 260, mass: 0.75 };

export default function TogetherListeningInAppIndicator({
  appState,
  bottomOffset,
  visible,
  onOpenConversation,
}: TogetherListeningInAppIndicatorProps) {
  const theme = useTheme();
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const safeAreaTop = useSafeAreaInsets().top;
  const presentationAppState = visible ? appState : 'inactive';
  const { viewModel, leave, leavePending } = useTogetherListeningInAppPresentation(
    presentationAppState,
  );
  const activityId = viewModel?.activityId ?? null;
  const [displayMode, setDisplayMode] = useState<TogetherListeningIndicatorDisplayMode>('expanded');
  const [loadedPosition, setLoadedPosition] = useState<{
    activityId: string;
    position: TogetherListeningIndicatorPosition | null;
  } | null>(null);
  const [restoredActivityId, setRestoredActivityId] = useState<string | null>(null);
  const displayModeRef = useRef(displayMode);
  const appliedActivityIdRef = useRef<string | null>(null);
  const swipeConsumedRef = useRef(false);
  const left = useSharedValue(EXPANDED_HORIZONTAL_MARGIN);
  const indicatorWidth = useSharedValue(
    Math.max(COLLAPSED_SIZE, windowWidth - EXPANDED_HORIZONTAL_MARGIN * 2),
  );
  // 纵向自由偏移只服务于 collapsed 态：expanded 不挂载 vertical transform style，
  // worklet 不需要额外的 boolean SharedValue 来决定 transform 是否生效。
  // collapsed 拖动更新；新 Activity 重置为 0；同 Activity 内收起后保留 Y 位置。
  const verticalOffset = useSharedValue(0);
  const verticalDragStart = useSharedValue(0);
  // collapsed 纵向允许的最大向上位移（负数），供 UI 线程 worklet 拖动时 clamp。
  const minVerticalOffset = useSharedValue(0);

  const collapsedVerticalBounds = useMemo(
    () => resolveCollapsedVerticalOffsetBounds({
      windowHeight,
      safeAreaTop,
      bottomOffset,
      chipHeight: COLLAPSED_SIZE,
      topMargin: COLLAPSED_TOP_MARGIN,
    }),
    [windowHeight, safeAreaTop, bottomOffset],
  );

  // 几何变化（旋转、safe area、bottomOffset）时重新 clamp，保证当前位置仍合法。
  useEffect(() => {
    minVerticalOffset.value = collapsedVerticalBounds.minOffset;
    verticalOffset.value = clampCollapsedVerticalOffset(verticalOffset.value, collapsedVerticalBounds);
  }, [collapsedVerticalBounds, minVerticalOffset, verticalOffset]);

  const setMode = useCallback((mode: TogetherListeningIndicatorDisplayMode) => {
    displayModeRef.current = mode;
    setDisplayMode(mode);
  }, []);

  useEffect(() => {
    let cancelled = false;
    appliedActivityIdRef.current = null;
    setRestoredActivityId(null);
    setLoadedPosition(null);
    if (!activityId) return () => { cancelled = true; };

    void loadTogetherListeningIndicatorPosition(activityId).then((position) => {
      if (!cancelled) setLoadedPosition({ activityId, position });
    });
    return () => { cancelled = true; };
  }, [activityId]);

  const geometryForMode = useCallback((mode: TogetherListeningIndicatorDisplayMode) => {
    if (mode === 'collapsed_left') {
      return { left: COLLAPSED_EDGE_MARGIN, width: COLLAPSED_SIZE };
    }
    if (mode === 'collapsed_right') {
      return {
        left: Math.max(COLLAPSED_EDGE_MARGIN, windowWidth - COLLAPSED_SIZE - COLLAPSED_EDGE_MARGIN),
        width: COLLAPSED_SIZE,
      };
    }
    return {
      left: EXPANDED_HORIZONTAL_MARGIN,
      width: Math.max(COLLAPSED_SIZE, windowWidth - EXPANDED_HORIZONTAL_MARGIN * 2),
    };
  }, [windowWidth]);

  useEffect(() => {
    if (
      !activityId
      || loadedPosition?.activityId !== activityId
      || appliedActivityIdRef.current === activityId
    ) {
      return;
    }

    const mode = loadedPosition.position?.displayMode ?? 'expanded';
    const restoredVerticalOffset = clampCollapsedVerticalOffset(
      loadedPosition.position?.collapsedVerticalOffset ?? 0,
      collapsedVerticalBounds,
    );
    const geometry = geometryForMode(mode);
    appliedActivityIdRef.current = activityId;
    displayModeRef.current = mode;
    verticalOffset.value = restoredVerticalOffset;
    left.value = geometry.left;
    indicatorWidth.value = geometry.width;
    setDisplayMode(mode);
    setRestoredActivityId(activityId);
  }, [
    activityId,
    collapsedVerticalBounds,
    geometryForMode,
    indicatorWidth,
    left,
    loadedPosition,
    verticalOffset,
  ]);

  const persistPosition = useCallback((mode: TogetherListeningIndicatorDisplayMode) => {
    if (!activityId || restoredActivityId !== activityId) return;
    void saveTogetherListeningIndicatorPosition({
      activityId,
      displayMode: mode,
      collapsedVerticalOffset: verticalOffset.value,
    });
  }, [activityId, restoredActivityId, verticalOffset]);

  const animateToMode = useCallback((mode: TogetherListeningIndicatorDisplayMode) => {
    setMode(mode);
    const geometry = geometryForMode(mode);
    left.value = withSpring(geometry.left, SPRING_CONFIG);
    indicatorWidth.value = withSpring(geometry.width, SPRING_CONFIG);
    persistPosition(mode);
  }, [geometryForMode, indicatorWidth, left, persistPosition, setMode]);

  useEffect(() => {
    const geometry = geometryForMode(displayModeRef.current);
    left.value = geometry.left;
    indicatorWidth.value = geometry.width;
  }, [geometryForMode, indicatorWidth, left]);

  const handleRelease = useCallback((translationX: number, velocityX: number) => {
    animateToMode(resolveIndicatorReleaseMode({ translationX, velocityX }));
  }, [animateToMode]);

  const markSwipeConsumed = useCallback(() => {
    swipeConsumedRef.current = true;
  }, []);

  const persistCollapsedPosition = useCallback(() => {
    persistPosition(displayModeRef.current);
  }, [persistPosition]);

  const handleBodyPress = useCallback(() => {
    if (swipeConsumedRef.current || !viewModel) return;
    onOpenConversation(viewModel.hostAiId, viewModel.chatSessionId);
  }, [onOpenConversation, viewModel]);

  const panGesture = useMemo(() => Gesture.Pan()
    .activeOffsetX([-PAN_ACTIVATION_OFFSET, PAN_ACTIVATION_OFFSET])
    .failOffsetY([-PAN_ACTIVATION_OFFSET, PAN_ACTIVATION_OFFSET])
    .onStart(() => {
      runOnJS(markSwipeConsumed)();
    })
    .onUpdate((event) => {
      left.value = EXPANDED_HORIZONTAL_MARGIN + event.translationX;
    })
    .onEnd((event) => {
      runOnJS(handleRelease)(event.translationX, event.velocityX);
    })
    .onFinalize((_event, success) => {
      if (!success) {
        left.value = withSpring(EXPANDED_HORIZONTAL_MARGIN, SPRING_CONFIG);
      }
    }), [handleRelease, left, markSwipeConsumed]);

  // collapsed 态纵向拖动：X 锁定边缘不动，只跟 Y；全过程 clamp 到合法范围，
  // 松手保留位置，不 spring 回边缘。
  const collapsedPanGesture = useMemo(() => Gesture.Pan()
    .activeOffsetY([-PAN_ACTIVATION_OFFSET, PAN_ACTIVATION_OFFSET])
    .failOffsetX([-PAN_ACTIVATION_OFFSET, PAN_ACTIVATION_OFFSET])
    .onStart(() => {
      runOnJS(markSwipeConsumed)();
      verticalDragStart.value = verticalOffset.value;
    })
    .onUpdate((event) => {
      const next = verticalDragStart.value + event.translationY;
      verticalOffset.value = Math.max(minVerticalOffset.value, Math.min(0, next));
    })
    .onEnd(() => {
      runOnJS(persistCollapsedPosition)();
    }), [
    markSwipeConsumed,
    minVerticalOffset,
    persistCollapsedPosition,
    verticalDragStart,
    verticalOffset,
  ]);

  // 水平几何与 collapsed 纵向偏移拆成两个 animated style：expanded 不挂载
  // vertical transform，worklet 不引用任何控制视觉状态的 boolean SharedValue。
  const animatedGeometryStyle = useAnimatedStyle(() => ({
    left: left.value,
    width: indicatorWidth.value,
  }));

  const collapsedVerticalStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: verticalOffset.value }],
  }));

  if (!visible || !viewModel || restoredActivityId !== activityId) return null;

  const container = (
    <Animated.View
      style={[
        styles.container,
        animatedGeometryStyle,
        displayMode !== 'expanded' && collapsedVerticalStyle,
        {
          bottom: bottomOffset,
          backgroundColor: theme.effects.glass.enabled ? 'transparent' : theme.colors.surface.raised,
          borderColor: theme.effects.glass.enabled ? theme.effects.glass.borderColor : theme.colors.border.light,
          shadowColor: theme.shadow.md.shadowColor,
        },
        displayMode !== 'expanded' && styles.collapsedContainer,
      ]}
    >
      {theme.effects.glass.enabled && (
        <GlassSurface
          pointerEvents="none"
          bordered={false}
          material={{ cornerRadius: INDICATOR_CORNER_RADIUS }}
          style={[StyleSheet.absoluteFill, { borderRadius: INDICATOR_CORNER_RADIUS }]}
        />
      )}
      {/* 两种 Pan 的方向契约不同，key 必须隔离 native handler 生命周期，禁止 React 原地复用。 */}
      {displayMode === 'expanded' ? (
        <>
          <GestureDetector key="expanded" gesture={panGesture}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`返回与${getAssistantDisplayName(viewModel.ai)}的聊天`}
              style={styles.body}
              onPressIn={() => { swipeConsumedRef.current = false; }}
              onPress={handleBodyPress}
            >
              <View style={styles.avatars}>
                <AIAvatar
                  name={getAssistantDisplayName(viewModel.ai)}
                  avatarUrl={viewModel.ai.avatar}
                  size="small"
                  shape={AVATAR_SHAPE.circle}
                />
                <UserAvatar
                  name={viewModel.user.name}
                  avatarUrl={viewModel.user.avatar}
                  size="small"
                  shape={AVATAR_SHAPE.circle}
                  style={styles.userAvatar}
                />
              </View>
              <Headphones size={18} color={theme.colors.brand.primary} />
              <View style={styles.textBlock}>
                <Text style={[styles.title, { color: theme.colors.text.primary }]} numberOfLines={1}>
                  {viewModel.title}
                </Text>
                <Text style={[styles.subtitle, { color: theme.colors.text.secondary }]} numberOfLines={1}>
                  {viewModel.subtitle}
                </Text>
              </View>
            </Pressable>
          </GestureDetector>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="退出一起听"
            disabled={leavePending}
            hitSlop={8}
            style={[styles.leaveButton, { borderColor: theme.colors.border.light }]}
            onPress={() => void leave()}
          >
            {leavePending ? (
              <ActivityIndicator size="small" color={theme.colors.brand.primary} />
            ) : (
              <Text style={[styles.leaveText, { color: theme.colors.brand.primary }]}>退出</Text>
            )}
          </Pressable>
        </>
      ) : (
        <GestureDetector key="collapsed" gesture={collapsedPanGesture}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="展开一起听状态"
            style={styles.collapsedButton}
            onPressIn={() => { swipeConsumedRef.current = false; }}
            onPress={() => {
              if (swipeConsumedRef.current) return;
              animateToMode('expanded');
            }}
          >
            <Headphones size={22} color={theme.colors.brand.primary} />
          </Pressable>
        </GestureDetector>
      )}
    </Animated.View>
  );

  return container;
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    minHeight: EXPANDED_MIN_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: INDICATOR_CORNER_RADIUS,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.16,
    shadowRadius: 14,
    elevation: 8,
    zIndex: 30,
  },
  collapsedContainer: {
    minHeight: COLLAPSED_SIZE,
    height: COLLAPSED_SIZE,
    borderRadius: INDICATOR_CORNER_RADIUS,
  },
  body: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    paddingLeft: 12,
  },
  avatars: {
    width: 48,
    flexDirection: 'row',
    alignItems: 'center',
  },
  userAvatar: {
    marginLeft: -10,
  },
  textBlock: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    fontSize: 14,
    fontWeight: '700',
  },
  subtitle: {
    marginTop: 3,
    fontSize: 12,
  },
  leaveButton: {
    width: 52,
    minHeight: 36,
    marginHorizontal: 10,
    alignItems: 'center',
    justifyContent: 'center',
    borderLeftWidth: StyleSheet.hairlineWidth,
  },
  leaveText: {
    fontSize: 13,
    fontWeight: '700',
  },
  collapsedButton: {
    width: COLLAPSED_SIZE,
    height: COLLAPSED_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
