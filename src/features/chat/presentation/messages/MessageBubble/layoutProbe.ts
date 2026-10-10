/**
 * 开发态聊天气泡布局探针。
 *
 * 用途：给 B（Default 主题消息间异常大空白）与 C（Liquid Glass Markdown 列表宽度塌缩）
 * 提供**真实 onLayout 数据**：既有同一帧的横向一致性，也有从 mount 到稳定的完整高度轨迹。
 * 其中 `rowDelta` 字段是 B 的回归判据（`bubbleWithArrow` 比 `bubble` 高出的像素，正常应为 0）。
 *
 * 约束：
 * - 仅 `__DEV__` 生效；生产构建里所有函数退化为 no-op。
 * - 开关 `LAYOUT_PROBE_ENABLED` 默认关闭（本地诊断时打开）。
 * - 只注入 `onLayout` / `onTextLayout` 回调：不改 style、不新增布局节点、不改变渲染树。
 *   因此**禁止为了测量包一层 View** —— 包装层会改变 fit-content 宽度与收缩行为，
 *   测到的就不再是真实布局（markdown 根层过去就是这样被包出来的，已移除）。
 * - 不触碰用户数据、不写库、不碰 FlashList 正式逻辑。
 *
 * 帧（tick）语义：同一次 commit 派发的 onLayout 会在同一个 JS 任务里同步到达，所以用微任务切分批次：
 * 同一任务的样本共享一个 tick，任务结束后 tick 自增。每个样本另带 `seq`（到达顺序）与
 * `t`（相对探针启动的毫秒数）。`sync=ok` 表示各层最新采样都在同一批次里；`sync=STALE` 只表示
 * 某些层最近一次 onLayout 早于最新批次，Δt 才是判断"是不是真的停在旧帧"的依据（Δt≈0 可忽略）。
 *
 * 打印策略：同一 messageId 的首个采样到达后 400ms 打印一次；条目**不随打印销毁**，
 * 因此每次打印都包含该消息自 mount 起的累计轨迹（每层最多保留 HISTORY_LIMIT 条）。
 */

import React from 'react';
import {
  View,
  type LayoutChangeEvent,
  type NativeSyntheticEvent,
  type TextLayoutEventData,
} from 'react-native';

/** 唯一开关。诊断完成后可整体删除本文件与其调用点。 */
export const LAYOUT_PROBE_ENABLED = false;

const PRINT_DEBOUNCE_MS = 400;
/** 每层保留的采样上限：要覆盖"mount → 稳定"的完整轨迹，而不是只留最后一次。 */
const HISTORY_LIMIT = 40;
/** 轨迹打印时每层最多逐条列出的采样数，超出则首 2 + 末 4 折叠。 */
const MAX_SERIES_ENTRIES = 12;
/** 同时跟踪的消息数上限（Map 插入序淘汰最早的）。避免长时间诊断无限增长。 */
const MAX_TRACKED_MESSAGES = 40;

/**
 * 被测量的层：
 * - `listCell`：FlashList 自己测量的 cell 容器（它的 y 就是消息在列表内容里的偏移）。
 * - `messageListItem`：列表项根 View，即 FlashList 之外的最外层自有节点。
 * - `touchWrapper`：`TouchableMessageBubble` 的内容包装 View；`TouchableWithoutFeedback`
 *   本身不落原生节点，所以这是该组件能测到的最外层。
 * - `container`…`tokenInfo`：`MessageBubble` 内部各层。
 * - `middleView`：`bubbleWrapper` 与 `bubbleWithArrow` 之间的无样式包装 View（isSelected 那层）。
 *   F（宽度塌缩）要判断"宽度是在这一层丢的还是在气泡自己丢的"，必须测它。
 * - `plainTextLines`：纯文本路径的 `onTextLayout` 行数/文本高度（`w`=行数，`h`=各行高度之和）。
 *   Markdown 路径拿不到（库内部渲染，注入必须改渲染树），所以它只对纯文本消息有效。
 * - `listOuter` / `listItemContent`：markdown 列表节点，服务 F/C 的宽度判断。
 */
export type LayoutProbeLayer =
  | 'listCell'
  | 'messageListItem'
  | 'touchWrapper'
  | 'container'
  | 'bubbleWrapper'
  | 'middleView'
  | 'bubbleWithArrow'
  | 'bubble'
  | 'tokenInfo'
  | 'plainTextLines'
  | 'listOuter'
  | 'listItemContent';

export interface LayoutProbeSample {
  layer: LayoutProbeLayer;
  x: number;
  y: number;
  width: number;
  height: number;
  /** 同一次 commit 的批次号，越大越新。 */
  tick: number;
  /** 全局到达序号，用于判断同一批次内的先后。 */
  seq: number;
  /** 相对探针启动的毫秒数。 */
  t: number;
  /** 非几何采样（例如文本行数）的附加说明；几何采样为 undefined。 */
  note?: string;
}

/** 列表外层（cell / 列表项 / Touchable 包装）无法得知 MessageBubble 内部才有的宽度策略。 */
export interface LayoutProbeMessageIdentity {
  messageId: number;
  senderType: string;
  isMe: boolean;
  themeId: string;
  presentationRunKey: string | null;
}

export interface LayoutProbeMessageContext extends LayoutProbeMessageIdentity {
  /** 仅 `MessageBubble` 内部能算出；外层一律传 null，合并时以非空值优先。 */
  isWideMarkdown: boolean | null;
}

interface LayerHistory {
  items: LayoutProbeSample[];
  /** 被 HISTORY_LIMIT 截掉的更早采样数量，用于在日志里标出轨迹不完整。 */
  dropped: number;
}

interface PendingEntry {
  context: LayoutProbeMessageContext;
  histories: Map<LayoutProbeLayer, LayerHistory>;
  timer: ReturnType<typeof setTimeout> | null;
}

const pendingEntries = new Map<number, PendingEntry>();

const probeStartedAt = Date.now();
let sampleSeq = 0;
let currentTick = 0;
let tickCloseScheduled = false;

/**
 * 取得当前批次号，并在本 JS 任务结束（同一个 commit 的 onLayout 全部到达）后关闭该批次。
 * 用 Promise 微任务而不是 timer：微任务只会在当前任务栈清空后运行，正好等于"这一次派发结束"。
 */
function openTick(): number {
  if (!tickCloseScheduled) {
    tickCloseScheduled = true;
    Promise.resolve().then(() => {
      currentTick += 1;
      tickCloseScheduled = false;
    });
  }
  return currentTick;
}

/** 同一 messageId 的各层来自不同组件，各自只能提供自己知道的那部分上下文。 */
function mergeContext(
  previous: LayoutProbeMessageContext,
  next: LayoutProbeMessageContext
): LayoutProbeMessageContext {
  return {
    messageId: previous.messageId,
    senderType: previous.senderType || next.senderType,
    isMe: previous.isMe,
    themeId: previous.themeId || next.themeId,
    presentationRunKey: previous.presentationRunKey ?? next.presentationRunKey,
    isWideMarkdown: previous.isWideMarkdown ?? next.isWideMarkdown,
  };
}

function recordGeometry(
  context: LayoutProbeMessageContext,
  layer: LayoutProbeLayer,
  geometry: { x: number; y: number; width: number; height: number; note?: string }
): void {
  const sample: LayoutProbeSample = {
    layer,
    x: geometry.x,
    y: geometry.y,
    width: geometry.width,
    height: geometry.height,
    tick: openTick(),
    seq: (sampleSeq += 1),
    t: Date.now() - probeStartedAt,
    note: geometry.note,
  };

  const existing = pendingEntries.get(context.messageId);
  if (!existing && pendingEntries.size >= MAX_TRACKED_MESSAGES) {
    const oldestMessageId = pendingEntries.keys().next().value;
    if (oldestMessageId !== undefined) {
      pendingEntries.delete(oldestMessageId);
    }
  }
  const entry = existing ?? {
    context,
    histories: new Map<LayoutProbeLayer, LayerHistory>(),
    timer: null,
  };
  entry.context = mergeContext(entry.context, context);

  const history = entry.histories.get(layer) ?? { items: [], dropped: 0 };
  const items = [...history.items, sample];
  const overflow = items.length - HISTORY_LIMIT;
  entry.histories.set(layer, overflow > 0
    ? { items: items.slice(overflow), dropped: history.dropped + overflow }
    : { items, dropped: history.dropped });

  if (entry.timer === null) {
    entry.timer = setTimeout(() => flushEntry(context.messageId), PRINT_DEBOUNCE_MS);
  }
  pendingEntries.set(context.messageId, entry);
}

/** 打印后**保留**条目：下一次打印仍能给出自 mount 起的累计轨迹。 */
function flushEntry(messageId: number): void {
  const entry = pendingEntries.get(messageId);
  if (!entry) {
    return;
  }
  entry.timer = null;

  const histories = [...entry.histories.values()];
  const latestSamples = histories.map((history) => history.items[history.items.length - 1]);
  const newestTick = latestSamples.reduce((max, sample) => Math.max(max, sample.tick), 0);
  const newestSample = latestSamples.find((sample) => sample.tick === newestTick);
  const allTicks = new Set(
    histories.flatMap((history) => history.items.map((sample) => sample.tick))
  );
  // 滞后项同时给出 tick 差与时间差：Δt 只有几十毫秒以上才是真的"停在旧帧"，
  // Δt≈0 的 lag 更可能是同一次派发被切成了两个批次（见文件头对 tick 的说明）。
  const laggingLayers = latestSamples
    .filter((sample) => sample.tick < newestTick)
    .map((sample) => `${sample.layer}:tick=${sample.tick},Δt=${(newestSample?.t ?? sample.t) - sample.t}ms`);
  const lagSummary = laggingLayers.length === 0
    ? 'sync=ok'
    : `sync=STALE(${laggingLayers.slice(0, 4).join(',')}${laggingLayers.length > 4 ? `,+${laggingLayers.length - 4}` : ''})`;

  // 派生标记：row 比它唯一的高子节点高出多少。正常消息应为 0；非 0 就是 B 现象，
  // 直接 `grep rowDelta=` 就能在长日志里捞出 ghost 消息，不需要人工比对高度。
  const bubbleSample = latestSamples.find((sample) => sample.layer === 'bubble');
  const rowSample = latestSamples.find((sample) => sample.layer === 'bubbleWithArrow');
  const rowDelta = bubbleSample && rowSample
    ? Math.round(rowSample.height - bubbleSample.height)
    : 0;

  // 宽度链一行速读（F 塌缩只需要看这一行）：
  // 可用宽度上限 ≈ 消息项宽 × container.maxWidth(84%) − avatar(36 + marginHorizontal 6×2)，
  // 只对 default / Liquid Glass 这一条渲染分支成立（moonKimi / paperNote 各有自己的宽度规则）。
  // `fill` 低不等于 bug（短消息本来就贴合文字），判据是"有列表层却 fill 很低"或"同一消息在
  // fexp=off / keep-row 之间 fill 明显不同"。
  const chainOrder: LayoutProbeLayer[] = [
    'container',
    'bubbleWrapper',
    'middleView',
    'bubbleWithArrow',
    'bubble',
    'listOuter',
    'listItemContent',
  ];
  const chainLabels: Record<string, string> = {
    container: '容器',
    bubbleWrapper: '包裹',
    middleView: '中间',
    bubbleWithArrow: '行',
    bubble: '气泡',
    listOuter: '列表',
    listItemContent: '项',
  };
  const chainSamples = chainOrder
    .map((layer) => latestSamples.find((sample) => sample.layer === layer))
    .filter((sample): sample is LayoutProbeSample => sample !== undefined);
  const itemSample = latestSamples.find((sample) => sample.layer === 'messageListItem');
  const availableWidth = itemSample ? Math.round(itemSample.width * 0.84) - 48 : 0;
  const chainLine = chainSamples.length > 1
    ? `  ── 宽度链：${chainSamples.map((sample) => `${chainLabels[sample.layer]}${Math.round(sample.width)}`).join(' → ')}${bubbleSample && availableWidth > 0 ? `（气泡 fill≈${Math.round((bubbleSample.width / availableWidth) * 100)}%，avail≈${availableWidth}）` : ''}`
    : '';

  const header = [
    `[LayoutProbe] msg=${entry.context.messageId}`,
    `theme=${entry.context.themeId}`,
    `sender=${entry.context.senderType}`,
    `isMe=${entry.context.isMe}`,
    `wide=${entry.context.isWideMarkdown === null ? '?' : entry.context.isWideMarkdown}`,
    `run=${entry.context.presentationRunKey ?? '-'}`,
    `passes=${allTicks.size}`,
    lagSummary,
    rowDelta === 0 ? '' : `rowDelta=${rowDelta > 0 ? '+' : ''}${rowDelta}`,
  ].filter((field) => field.length > 0).join(' ');

  const summary = histories
    .map((history) => ({ history, latest: history.items[history.items.length - 1] }))
    .sort((left, right) => left.latest.layer.localeCompare(right.latest.layer))
    .map(({ latest }) => {
      const parts = [
        `  ${latest.layer.padEnd(18)}`,
        `tick=${latest.tick}`,
        `lag=${newestTick - latest.tick}`,
        `seq=${latest.seq}`,
        `t=${latest.t}ms`,
      ];
      parts.push(latest.note
        ? latest.note
        : `x=${Math.round(latest.x)} y=${Math.round(latest.y)} w=${Math.round(latest.width)} h=${Math.round(latest.height)}`);
      return parts.join(' ');
    })
    .join('\n');

  // 完整轨迹：**不按"是否变化"过滤** —— "某层恒定 122"本身就是要观察的证据，
  // 过滤掉它就无法区分"保持原值"和"根本没被测到"。
  const series = histories
    .filter((history) => history.items.length > 1)
    .sort((left, right) => left.items[0].layer.localeCompare(right.items[0].layer))
    .map((history) => {
      const items = history.items;
      const visible = items.length <= MAX_SERIES_ENTRIES
        ? items
        : [...items.slice(0, 2), undefined, ...items.slice(-4)];
      const values = visible
        .map((item) => (item
          ? `${Math.round(item.width)}x${Math.round(item.height)}@${item.t}`
          : '…'))
        .join(' → ');
      const suffix = items.length <= MAX_SERIES_ENTRIES ? '' : ` (共 ${items.length} 次采样)`;
      const prefix = history.dropped > 0 ? `…+${history.dropped} ` : '';
      return `  ${items[0].layer.padEnd(18)} ${prefix}${values}${suffix}`;
    });

  // 速读顺序：头信息（含 rowDelta）→ 宽度链（F）→ 分层表 → 完整轨迹。
  console.info([
    header,
    chainLine,
    summary,
    series.length === 0 ? '' : `  ── 轨迹（自 mount 起，w x h @ t ms）──\n${series.join('\n')}`,
  ].filter((block) => block.length > 0).join('\n'));
}

export function isLayoutProbeEnabled(): boolean {
  return __DEV__ && LAYOUT_PROBE_ENABLED;
}

/**
 * 为一个 layout 层创建 onLayout handler。未开启时返回 undefined，
 * 因此不会给组件挂任何额外回调。
 */
export function createLayoutProbeHandler(
  context: LayoutProbeMessageContext,
  layer: LayoutProbeLayer
): ((event: LayoutChangeEvent) => void) | undefined {
  if (!isLayoutProbeEnabled()) {
    return undefined;
  }
  return (event: LayoutChangeEvent) => {
    const { x, y, width, height } = event.nativeEvent.layout;
    recordGeometry(context, layer, { x, y, width, height });
  };
}

/**
 * 纯文本路径的 `<Text onTextLayout>`：只拿"行数 / 各行高度之和 / 最宽行宽"，
 * 用来确认文本是否真的发生了换行变化（行数变化会直接反映在气泡内容高度上）。
 * 这是注释里禁止新增包装 View 的替代手段：onTextLayout 是 prop，不改变渲染树。
 */
export function createPlainTextLayoutProbeHandler(
  context: LayoutProbeMessageContext
): ((event: NativeSyntheticEvent<TextLayoutEventData>) => void) | undefined {
  if (!isLayoutProbeEnabled()) {
    return undefined;
  }
  return (event: NativeSyntheticEvent<TextLayoutEventData>) => {
    const lines = event.nativeEvent?.lines ?? [];
    if (lines.length === 0) {
      return;
    }
    const totalHeight = lines.reduce((sum, line) => sum + line.height, 0);
    const maxLineWidth = lines.reduce((max, line) => Math.max(max, line.width), 0);
    recordGeometry(context, 'plainTextLines', {
      x: 0,
      y: 0,
      width: lines.length,
      height: totalHeight,
      note: `lines=${lines.length} maxLineW=${Math.round(maxLineWidth)} textH=${Math.round(totalHeight)}`,
    });
  };
}

/** FlashList 传给 cell 组件的 props；除下述字段外全部原样透传给容器 View。 */
type LayoutProbeCellProps = {
  index: number;
  onLayout?: (event: LayoutChangeEvent) => void;
} & React.ComponentProps<typeof View>;

/**
 * FlashList 的 cell 容器探针。
 *
 * FlashList 2.x 用 `CellRendererComponent` 渲染每个 cell（默认组件就是 RN 的 View），并传入
 * `ref / onLayout / style / index`：其中 `ref` 与 `onLayout` 是它自己测量 cell 尺寸、维护滚动
 * 位置的通道，**必须原样转发**，否则会真的改变列表布局。本组件因此只做两件事：
 * 原样渲染 `View`，以及在转发前额外记录一次 onLayout。
 *
 * 依赖 FlashList 内部实现（`dist/recyclerview/ViewHolder.js`：`CompatView` 即 RN `View`，
 * cell props 为 `{ ref, onLayout, style, index }`）。升级 FlashList 后需同步核对。
 */
export function createLayoutProbeCellRenderer(
  resolveIdentity: (index: number) => LayoutProbeMessageIdentity | undefined
): React.ComponentType<LayoutProbeCellProps> | undefined {
  if (!isLayoutProbeEnabled()) {
    return undefined;
  }

  const LayoutProbeCell = React.forwardRef<View, LayoutProbeCellProps>((props, ref) => {
    const { onLayout, index, children, ...viewProps } = props;
    const handleLayout = (event: LayoutChangeEvent) => {
      const identity = resolveIdentity(index);
      if (identity) {
        recordGeometry({ ...identity, isWideMarkdown: null }, 'listCell', {
          ...event.nativeEvent.layout,
        });
      }
      onLayout?.(event);
    };
    return React.createElement(View, { ...viewProps, ref, onLayout: handleLayout }, children);
  });
  LayoutProbeCell.displayName = 'LayoutProbeCell';

  return LayoutProbeCell as unknown as React.ComponentType<LayoutProbeCellProps>;
}
