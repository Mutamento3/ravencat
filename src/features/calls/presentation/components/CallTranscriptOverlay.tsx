import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ScrollView,
  Text,
  View,
  type GestureResponderEvent,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';

import type { CallEvent } from '../../domain/CallEvent';
import { useThemedStyles } from '@shared/theme';
import { createCallTranscriptOverlayStyles } from './CallTranscriptOverlay.styles';

interface TranscriptRow {
  id: string;
  role: 'ai' | 'user';
  text: string;
  interrupted: boolean;
}

interface CallTranscriptOverlayProps {
  events: CallEvent[];
  /** 用户实时识别的临时文本。 */
  interimText?: string | null;
  /** 结束页传 true：整通电话没有任何按句播放事件（TTS 全程不可用）时，
   * 回退按句拆分显示 AI 全文。通话中不传——AI 句子只在合成完成开播后出现。 */
  showFullTextFallback?: boolean;
  /** 结束页传 false：记录始终展开且不可收起。 */
  collapsible?: boolean;
}

/**
 * 聚焦梯度：视口中心的句子最大最亮，离中心越远越小越淡。
 * 行高永远不变（样式里 fontSize 16 / lineHeight 24 固定），聚焦只通过
 * transform scale 和透明度连续插值表达——不触发文字重排，滑动时不跳档、
 * 不震荡（歌词流流畅的关键）。
 */
/** 视口中心缩放 ≈ 18px 观感。 */
const MAX_SCALE = 1.13;
/** 视口边缘缩放 ≈ 11px 观感。 */
const MIN_SCALE = 0.69;
const MIN_OPACITY = 0.22;

/** 贴底判定阈值：距可滚末端 24px 内视为"用户在底部"。 */
const BOTTOM_THRESHOLD = 24;

function parseInterruptedText(payloadJson: string | null): string | null {
  if (!payloadJson) {
    return null;
  }
  try {
    const payload = JSON.parse(payloadJson) as { interruptedText?: unknown };
    return typeof payload.interruptedText === 'string' ? payload.interruptedText : null;
  } catch {
    return null;
  }
}

/**
 * 中间聚焦歌词流通话记录：全部居中竖排，不用气泡卡片、不分左右。
 * 内容上下各垫半个视口高度，任意一句都能滚到视口正中央；
 * 行高固定不变，每行的缩放/透明度由"该行中心到视口中心的距离"连续插值，
 * 自动滚动和手动翻页共用同一套规则——翻到哪儿，哪儿最大最亮。
 * 用户句子用品牌蓝、AI 句子用白色区分；句子完整显示，不截断。
 *
 * 贴底跟随：新内容（新句子、ASR 临时文本）只在用户本来就在底部时自动滚到底；
 * 用户上滑翻历史期间绝不打扰，滑回底部后恢复跟随。
 *
 * 记录按句渲染：AI 侧以已按句落库的 ttsStarted 事件为准（每句开播才出现，
 * 未播放的句子不会提前显示）；ttsInterrupted 把对应句标记为已打断。
 * 通话中绝不渲染 aiSpeechText 全文：全文落库早于首句合成完成，直接渲染会先整段
 * 闪现再切成分段。只有结束页（showFullTextFallback）在整通电话没有任何
 * ttsStarted（TTS 全程不可用）时，才回退按句拆分显示全文。
 *
 * 点击对话内容收起（无提示条），点击同一区域恢复；滑动只用于翻查，不触发收起。
 */
export default function CallTranscriptOverlay({
  events,
  interimText,
  showFullTextFallback = false,
  collapsible = true,
}: CallTranscriptOverlayProps) {
  const styles = useThemedStyles(createCallTranscriptOverlayStyles);
  const scrollRef = useRef<ScrollView | null>(null);
  const [collapsed, setCollapsed] = useState(false);

  const rows = useMemo<TranscriptRow[]>(() => {
    const hasSentenceEvents = events.some((event) => event.kind === 'ttsStarted' && event.text);
    const result: TranscriptRow[] = [];

    for (const event of events) {
      if (event.kind === 'userSpeechText' && event.text) {
        result.push({ id: event.id, role: 'user', text: event.text, interrupted: false });
        continue;
      }
      const isAiRow = showFullTextFallback && !hasSentenceEvents
        ? event.kind === 'aiSpeechText'
        : event.kind === 'ttsStarted';
      if (isAiRow && event.text) {
        // 全文本身由句子按 '\n' join 落库；回退渲染时按句拆开，
        // 与正常路径的逐句显示保持一致。
        const sentences = event.text.split('\n').filter((sentence) => sentence.length > 0);
        sentences.forEach((sentence, sentenceIndex) => {
          result.push({
            id: `${event.id}#${sentenceIndex}`,
            role: 'ai',
            text: sentence,
            interrupted: false,
          });
        });
        continue;
      }
      if (event.kind === 'ttsInterrupted') {
        const interruptedText = parseInterruptedText(event.payloadJson);
        for (let index = result.length - 1; index >= 0; index -= 1) {
          const row = result[index];
          if (
            row.role === 'ai'
            && !row.interrupted
            && (!interruptedText || row.text === interruptedText)
          ) {
            result[index] = { ...row, interrupted: true };
            break;
          }
        }
      }
    }
    return result;
  }, [events, showFullTextFallback]);

  // 已提交的逐句事实即时送达；AI 行只有这一个来源，不再用单行占位覆盖历史句子。
  const displayRows = useMemo<TranscriptRow[]>(() => {
    const result = [...rows];
    // 识别中/待落库的用户文本同理：已在事件里的不重复追加。
    if (interimText && !result.some((row) => row.role === 'user' && row.text === interimText)) {
      result.push({ id: '__interim__', role: 'user', text: interimText, interrupted: false });
    }
    // 占位行与落库后的正式行文本相同：按"角色+文本+出现次序"生成稳定 id，
    // 占位切换成正式行时 React 复用同一元素和已测布局，不因换 id 重测闪烁。
    const seen = new Map<string, number>();
    return result.map((row) => {
      const base = `${row.role}:${row.text}`;
      const occurrence = seen.get(base) ?? 0;
      seen.set(base, occurrence + 1);
      return { ...row, id: `${base}#${occurrence}` };
    });
  }, [rows, interimText]);

  // 贴底跟随：逐句事实与 ASR 临时文本持续刷新，无条件 scrollToEnd
  // 会把翻历史的用户拽回底部。只有用户本来就在底部时才自动跟随新内容。
  const followingRef = useRef(true);
  const scrollToEndIfFollowing = () => {
    if (followingRef.current) {
      scrollRef.current?.scrollToEnd({ animated: true });
    }
  };

  useEffect(() => {
    requestAnimationFrame(scrollToEndIfFollowing);
  }, [displayRows.length]);

  // 中间聚焦：每行档位由该行中心到视口中心的距离决定。
  const [viewportHeight, setViewportHeight] = useState(0);
  const [scrollY, setScrollY] = useState(0);
  const rowLayoutsRef = useRef(new Map<string, { y: number; height: number }>());
  // 行布局写入 ref 不触发渲染；用版本号在布局变化后重算一次聚焦档位。
  const [layoutVersion, setLayoutVersion] = useState(0);

  useEffect(() => {
    // 清理已消失行的布局缓存，避免 Map 无限增长。
    const ids = new Set(displayRows.map((row) => row.id));
    rowLayoutsRef.current.forEach((_, key) => {
      if (!ids.has(key)) {
        rowLayoutsRef.current.delete(key);
      }
    });
  }, [displayRows]);

  const handleRowLayout = (id: string) => (event: LayoutChangeEvent) => {
    const { y, height } = event.nativeEvent.layout;
    const prev = rowLayoutsRef.current.get(id);
    if (!prev || prev.y !== y || prev.height !== height) {
      rowLayoutsRef.current.set(id, { y, height });
      setLayoutVersion((version) => version + 1);
    }
  };

  const handleScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
    setScrollY(contentOffset.y);
    const maxOffset = Math.max(contentSize.height - layoutMeasurement.height, 0);
    followingRef.current = contentOffset.y >= maxOffset - BOTTOM_THRESHOLD;
  };

  const focusStyleFor = (id: string): { scale: number; opacity: number } => {
    // 布局版本只用于让本函数在布局更新后重算，不参与计算本身。
    void layoutVersion;
    const layout = rowLayoutsRef.current.get(id);
    if (!layout || viewportHeight <= 0) {
      // 尚未测量的行（通常是刚追加的最新行）按边缘档位进入，
      // 随后随滚动连续长大归位；若默认给最大档会"先大再跳小再大"。
      return { scale: MIN_SCALE, opacity: MIN_OPACITY };
    }
    const distance = Math.abs(layout.y + layout.height / 2 - (scrollY + viewportHeight / 2));
    const ratio = Math.min(distance / (viewportHeight / 2), 1);
    return {
      scale: MAX_SCALE - (MAX_SCALE - MIN_SCALE) * ratio,
      opacity: 1 - (1 - MIN_OPACITY) * ratio,
    };
  };

  // 用普通 View 的触摸监听 + 位移阈值识别"点击"，不抢占手势响应者，
  // 滑动完全交给 ScrollView；Touchable 包裹会抢走触摸导致滑不动、一碰就收起。
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);

  const handleAreaTouchStart = (event: GestureResponderEvent) => {
    touchStartRef.current = { x: event.nativeEvent.pageX, y: event.nativeEvent.pageY };
  };

  const handleAreaTouchEnd = (event: GestureResponderEvent, action: () => void) => {
    const start = touchStartRef.current;
    touchStartRef.current = null;
    if (!collapsible || !start) {
      return;
    }
    const dx = Math.abs(event.nativeEvent.pageX - start.x);
    const dy = Math.abs(event.nativeEvent.pageY - start.y);
    if (dx < 10 && dy < 10) {
      action();
    }
  };

  if (collapsible && collapsed) {
    // 收起后不渲染任何提示条；点击原区域恢复显示。
    // 恢复时 ScrollView 是全新挂载、滚动位置从头开始：重置跟随权为贴底，
    // 让挂载后的 onContentSizeChange 把记录滚回最新消息。
    return (
      <View
        style={styles.collapsedPlaceholder}
        onTouchStart={handleAreaTouchStart}
        onTouchEnd={(event) => handleAreaTouchEnd(event, () => {
          followingRef.current = true;
          setCollapsed(false);
        })}
      />
    );
  }

  return (
    <View
      style={styles.container}
      onTouchStart={handleAreaTouchStart}
      onTouchEnd={(event) => handleAreaTouchEnd(event, () => setCollapsed(true))}
    >
      {displayRows.length === 0 ? (
        <View style={styles.emptyWrap}>
          <Text style={styles.emptyText}>本次通话还没有文字内容</Text>
        </View>
      ) : (
        <ScrollView
          ref={scrollRef}
          style={styles.lyrics}
          contentContainerStyle={[
            styles.lyricsContent,
            // 上下各垫半个视口：首句和末句才能滚到视口正中央获得聚焦档位。
            { paddingTop: viewportHeight / 2, paddingBottom: viewportHeight / 2 },
          ]}
          showsVerticalScrollIndicator={false}
          onLayout={(event) => setViewportHeight(event.nativeEvent.layout.height)}
          onScroll={handleScroll}
          scrollEventThrottle={32}
          onScrollBeginDrag={() => {
            // 用户一旦上手拖动就交出跟随权；拖回底部时由 handleScroll 恢复。
            followingRef.current = false;
          }}
          onContentSizeChange={scrollToEndIfFollowing}
        >
          {displayRows.map((row) => {
            const focus = focusStyleFor(row.id);
            return (
              <Text
                key={row.id}
                onLayout={handleRowLayout(row.id)}
                style={[
                  styles.lyricLine,
                  row.role === 'user' ? styles.lyricLineUser : null,
                  row.interrupted ? styles.lyricLineInterrupted : null,
                  {
                    opacity: focus.opacity,
                    transform: [{ scale: focus.scale }],
                  },
                ]}
              >
                {row.text}
              </Text>
            );
          })}
        </ScrollView>
      )}
    </View>
  );
}
