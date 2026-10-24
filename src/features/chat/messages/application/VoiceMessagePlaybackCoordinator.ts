import { resolveMediaAsset } from '@features/media';
import { localAudioPlaybackCoordinator } from '@platform/device';
import { markVoiceMessagePlayed } from './MarkVoiceMessagePlayed';

export type VoicePlaybackTarget = { kind: 'message'; id: number; isIncoming: boolean } | { kind: 'favorite' | 'quote' | 'reply_version'; id: string };
export function getVoicePlaybackKey(target: VoicePlaybackTarget): number | string {
  return target.kind === 'message' ? target.id : `${target.kind}:${target.id}`;
}

/** Chat 只拥有消息身份与已播放事实，文件播放和互斥由公共本地音频 owner 负责。 */
export const voiceMessagePlaybackCoordinator = {
  subscribe: localAudioPlaybackCoordinator.subscribe.bind(localAudioPlaybackCoordinator),
  stop: () => localAudioPlaybackCoordinator.stop(),
  toggle(target: VoicePlaybackTarget, mediaAssetId: string, durationMs: number): Promise<void> {
    return localAudioPlaybackCoordinator.toggle({
      key: getVoicePlaybackKey(target), scope: 'chat-voice', durationMs,
      resolveUri: async () => (await resolveMediaAsset(mediaAssetId)).localUri,
      onStarted: target.kind === 'message' && target.isIncoming ? () => {
        void markVoiceMessagePlayed(target.id).catch(error => console.warn('[VoiceMessagePlayback] 写入已播放状态失败', error));
      } : undefined,
    });
  },
};
