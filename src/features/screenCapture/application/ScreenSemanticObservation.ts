/** 当前窗口 Accessibility 语义观察的安全 application contract。 */

import {
  getCurrentWindowState,
  getDeviceObserverConnectionState,
  readDeviceObserverSemanticSnapshot,
  type DeviceObserverSemanticNode,
  type DeviceObserverSemanticSnapshot,
} from '@features/deviceControl';
import { loadCurrentProtectedPackages } from '@features/phoneTools';
import {
  assertScreenObservationWindowAllowed,
  ScreenObservationPolicyError,
} from './ScreenObservationPolicy';
import {
  ScreenSemanticObservationError,
  type ScreenSemanticObservationFailureReason,
} from './ScreenSemanticObservationPolicy';

export const SCREEN_SEMANTIC_LIMITS = {
  maxNodes: 256,
  maxDepth: 32,
  maxFieldCharacters: 1_000,
  maxTotalCharacters: 32_768,
} as const;

export interface ScreenSemanticNode {
  depth: number;
  text?: string;
  contentDescription?: string;
  className?: string;
  clickable?: boolean;
  editable?: boolean;
  password?: boolean;
}

export interface ScreenSemanticSnapshot {
  packageName: string;
  windowId: number;
  capturedAtEpochMs: number;
  nodes: ScreenSemanticNode[];
  plainText: string;
  truncated: boolean;
  truncation: {
    nodeLimitReached: boolean;
    depthLimitReached: boolean;
    characterLimitReached: boolean;
  };
}

export async function readAccessibilitySemanticsForCurrentWindow(): Promise<ScreenSemanticSnapshot> {
  const [connection, windowState, protectedPackages] = await Promise.all([
    getDeviceObserverConnectionState(),
    getCurrentWindowState(),
    loadCurrentProtectedPackages(),
  ]);

  if (!connection.accessibilityEnabled) {
    throw new ScreenSemanticObservationError(
      'accessibility_disabled',
      '请先在 Android 设置中启用 RavenCat 设备观察。',
    );
  }
  if (!connection.accessibilityConnected) {
    throw new ScreenSemanticObservationError(
      'accessibility_disconnected',
      '设备观察服务当前未连接，请返回设置页刷新后重试。',
    );
  }
  if (!connection.canRetrieveWindowContent) {
    throw new ScreenSemanticObservationError(
      'semantic_read_failed',
      '当前 Android 无障碍服务没有窗口内容读取能力。',
    );
  }

  let expectedWindow;
  try {
    expectedWindow = assertScreenObservationWindowAllowed(
      windowState,
      protectedPackages,
    );
  } catch (error) {
    if (!(error instanceof ScreenObservationPolicyError)) throw error;
    throw new ScreenSemanticObservationError(error.reason, error.message);
  }

  try {
    const nativeSnapshot = await readDeviceObserverSemanticSnapshot({
      expectedWindow,
    });
    return normalizeScreenSemanticSnapshot(nativeSnapshot);
  } catch (error) {
    throw normalizeScreenSemanticObservationError(error);
  }
}

/** Native bridge 是外部边界；这里产生业务可消费的有界、无密码值快照。 */
export function normalizeScreenSemanticSnapshot(
  snapshot: DeviceObserverSemanticSnapshot,
): ScreenSemanticSnapshot {
  const nodes: ScreenSemanticNode[] = [];
  let totalCharacters = 0;
  let nodeLimitReached = snapshot.truncation.nodeLimitReached;
  let depthLimitReached = snapshot.truncation.depthLimitReached;
  let characterLimitReached = snapshot.truncation.characterLimitReached;

  for (const rawNode of snapshot.nodes) {
    if (rawNode.depth > SCREEN_SEMANTIC_LIMITS.maxDepth) {
      depthLimitReached = true;
      continue;
    }
    if (nodes.length >= SCREEN_SEMANTIC_LIMITS.maxNodes) {
      nodeLimitReached = true;
      break;
    }
    const normalized = normalizeNode(rawNode, SCREEN_SEMANTIC_LIMITS.maxTotalCharacters - totalCharacters);
    characterLimitReached ||= normalized.characterLimitReached;
    if (!normalized.node) {
      if (totalCharacters >= SCREEN_SEMANTIC_LIMITS.maxTotalCharacters) break;
      continue;
    }
    const nodeCharacters = countNodeCharacters(normalized.node);
    totalCharacters += nodeCharacters;
    nodes.push(normalized.node);
    if (totalCharacters >= SCREEN_SEMANTIC_LIMITS.maxTotalCharacters) {
      characterLimitReached = true;
      break;
    }
  }

  const plainText = buildPlainText(nodes);
  const truncation = {
    nodeLimitReached,
    depthLimitReached,
    characterLimitReached,
  };
  return {
    packageName: snapshot.packageName,
    windowId: snapshot.windowId,
    capturedAtEpochMs: snapshot.capturedAtEpochMs,
    nodes,
    plainText,
    truncated: Object.values(truncation).some(Boolean),
    truncation,
  };
}

function normalizeNode(
  rawNode: DeviceObserverSemanticNode,
  remainingCharacters: number,
): { node: ScreenSemanticNode | null; characterLimitReached: boolean } {
  const password = rawNode.password;
  let fieldBudget = Math.max(0, remainingCharacters);
  const textResult = password
    ? { value: undefined, truncated: false }
    : normalizeField(rawNode.text, fieldBudget);
  fieldBudget -= textResult.value?.length ?? 0;
  const descriptionResult = password
    ? { value: undefined, truncated: false }
    : normalizeField(rawNode.contentDescription, fieldBudget);
  fieldBudget -= descriptionResult.value?.length ?? 0;
  const classNameResult = normalizeField(rawNode.className, fieldBudget);
  const node: ScreenSemanticNode = {
    depth: Math.max(0, Math.floor(rawNode.depth)),
    ...(textResult.value ? { text: textResult.value } : {}),
    ...(descriptionResult.value ? { contentDescription: descriptionResult.value } : {}),
    ...(classNameResult.value ? { className: classNameResult.value } : {}),
    ...(rawNode.clickable ? { clickable: true } : {}),
    ...(rawNode.editable ? { editable: true } : {}),
    ...(password ? { password: true } : {}),
  };
  const hasMeaning = Boolean(
    node.text || node.contentDescription || node.clickable || node.editable || node.password,
  );
  return {
    node: hasMeaning ? node : null,
    characterLimitReached: (
      textResult.truncated || descriptionResult.truncated || classNameResult.truncated
    ),
  };
}

function normalizeField(
  value: string | null,
  remainingCharacters: number,
): { value?: string; truncated: boolean } {
  const normalized = normalizeWhitespace(value);
  if (!normalized) return { truncated: false };
  const limit = Math.min(
    SCREEN_SEMANTIC_LIMITS.maxFieldCharacters,
    Math.max(0, remainingCharacters),
  );
  const fitted = normalized.slice(0, limit);
  return {
    value: fitted || undefined,
    truncated: fitted.length < normalized.length,
  };
}

function normalizeWhitespace(value: string | null): string {
  return value?.trim().replace(/\s+/g, ' ') ?? '';
}

function countNodeCharacters(node: ScreenSemanticNode): number {
  return (
    (node.text?.length ?? 0)
    + (node.contentDescription?.length ?? 0)
    + (node.className?.length ?? 0)
  );
}

function buildPlainText(nodes: readonly ScreenSemanticNode[]): string {
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const node of nodes) {
    for (const value of [node.text, node.contentDescription]) {
      if (value && !seen.has(value)) {
        seen.add(value);
        lines.push(value);
      }
    }
  }
  return lines.join('\n');
}

function normalizeScreenSemanticObservationError(
  error: unknown,
): ScreenSemanticObservationError {
  if (error instanceof ScreenSemanticObservationError) return error;
  const reason = error && typeof error === 'object' && 'reason' in error
    ? String((error as { reason?: unknown }).reason || '')
    : 'semantic_read_failed';
  return new ScreenSemanticObservationError(
    isScreenSemanticObservationFailureReason(reason) ? reason : 'semantic_read_failed',
    error instanceof Error ? error.message : '设备观察语义读取失败。',
  );
}

function isScreenSemanticObservationFailureReason(
  value: string,
): value is ScreenSemanticObservationFailureReason {
  return [
    'accessibility_disabled',
    'accessibility_disconnected',
    'window_unavailable',
    'window_changed',
    'protected_app',
    'semantic_read_failed',
  ].includes(value);
}
