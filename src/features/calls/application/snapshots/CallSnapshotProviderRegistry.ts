import type { AttachCallSnapshotResult } from './AttachCallSnapshot';

export type CallSnapshotRequestReason = 'look_at_user';

export type CallSnapshotProviderResult =
  | {
      status: 'captured';
      result: AttachCallSnapshotResult;
    }
  | {
      status: 'camera_disabled' | 'camera_not_ready' | 'busy' | 'failed';
      message: string;
    };

export type CallSnapshotProvider = (
  reason: CallSnapshotRequestReason
) => Promise<CallSnapshotProviderResult>;

const snapshotProviders = new Map<string, CallSnapshotProvider>();

export function registerCallSnapshotProvider(
  callId: string,
  provider: CallSnapshotProvider
): () => void {
  snapshotProviders.set(callId, provider);

  return () => {
    if (snapshotProviders.get(callId) === provider) {
      snapshotProviders.delete(callId);
    }
  };
}

export async function requestCallSnapshotFromProvider(
  callId: string,
  reason: CallSnapshotRequestReason
): Promise<CallSnapshotProviderResult> {
  const provider = snapshotProviders.get(callId);
  if (!provider) {
    return {
      status: 'camera_disabled',
      message: '摄像头未开启',
    };
  }

  return provider(reason);
}
