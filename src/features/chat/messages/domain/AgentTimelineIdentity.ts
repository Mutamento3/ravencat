/** canonical Agent timeline 的稳定 identity contract。 */

export const AGENT_TIMELINE_CLIENT_MESSAGE_PREFIX = 'agent-timeline:';

export interface AgentTimelineClientIdentity {
  runId: string;
  sequence: number;
  segmentIndex: number;
}

export function buildAgentTimelineIdentity(runId: string, sequence: number): string {
  return `${AGENT_TIMELINE_CLIENT_MESSAGE_PREFIX}${encodeURIComponent(runId)}:${sequence}`;
}

export function buildAgentTimelineClientMessageId(
  runId: string,
  sequence: number,
  segmentIndex = 0,
): string {
  return `${buildAgentTimelineIdentity(runId, sequence)}:${segmentIndex}`;
}

export function parseAgentTimelineClientMessageId(
  clientMessageId: string,
): AgentTimelineClientIdentity | null {
  if (!clientMessageId.startsWith(AGENT_TIMELINE_CLIENT_MESSAGE_PREFIX)) {
    return null;
  }

  const parts = clientMessageId.slice(AGENT_TIMELINE_CLIENT_MESSAGE_PREFIX.length).split(':');
  if (parts.length !== 3) {
    return null;
  }

  const runId = decodeURIComponent(parts[0]);
  const sequence = Number(parts[1]);
  const segmentIndex = Number(parts[2]);
  if (
    !runId
    || !Number.isInteger(sequence)
    || sequence < 1
    || !Number.isInteger(segmentIndex)
    || segmentIndex < 0
  ) {
    return null;
  }

  return { runId, sequence, segmentIndex };
}
