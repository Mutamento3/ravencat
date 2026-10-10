import type { AIProfile } from '@features/assistants';
import type { UserProfile } from '@features/profile';
import type { TogetherListeningInAppState } from '../application/PrepareTogetherListeningInAppPresentation';

export interface TogetherListeningInAppViewModel {
  activityId: string;
  hostAiId: string;
  chatSessionId: string;
  user: { name: string; avatar: string | null };
  ai: { name: string; avatar: string | null };
  title: string;
  subtitle: string;
}

export function buildTogetherListeningInAppViewModel(input: {
  state: TogetherListeningInAppState;
  userProfile: UserProfile | null;
  aiProfile: AIProfile | null;
  durationText: string | null;
}): TogetherListeningInAppViewModel {
  const { state } = input;
  const statusTitle = state.playback.status === 'available'
    ? {
        playing: '正在一起听',
        paused: '已暂停',
        buffering: '正在缓冲',
        connecting: '正在连接',
      }[state.playback.state]
    : '正在一起听';
  const title = input.durationText ? `${statusTitle} · ${input.durationText}` : statusTitle;
  const subtitle = state.playback.status === 'available'
    ? `《${state.playback.title}》${state.playback.artist ? ` — ${state.playback.artist}` : ''}`
    : '暂时无法读取网易云播放状态';
  return {
    activityId: state.activityId,
    hostAiId: state.hostAiId,
    chatSessionId: state.chatSessionId,
    user: {
      name: input.userProfile?.name || '用户',
      avatar: input.userProfile?.avatar ?? null,
    },
    ai: {
      name: input.aiProfile?.name || 'AI',
      avatar: input.aiProfile?.avatar ?? null,
    },
    title,
    subtitle,
  };
}
