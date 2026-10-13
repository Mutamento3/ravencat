/** 按网易云精确歌曲身份与本轮播放采样，只向 consumer 返回当前一句歌词。 */

import { getNetEasePlaybackRuntimeDependencies, type NetEaseMediaSessionPlaybackState } from './NetEasePlaybackRuntimeDependencies';

export interface NetEaseLyricPlayback {
  mediaId: string | null;
  playbackState: NetEaseMediaSessionPlaybackState;
  positionMs: number | null;
  speed: number | null;
  updatedAtEpochMs: number | null;
  durationMs: number | null;
}

export interface NetEaseCurrentLyric {
  text: string;
  startTimeMs: number;
  positionMs: number;
}

interface TimedLine { startTimeMs: number; text: string }
interface TimedLyrics { lines: TimedLine[]; truncated: boolean }

// 只保留当前查询歌曲的解析结果；同曲并发共享请求，切歌不复用上一首的歌词。
let currentLyrics: { songId: number; request: Promise<TimedLyrics | null> } | null = null;

function parseTimedLyrics(text: string): TimedLine[] {
  const offset = Number(text.match(/\[offset:([+-]?\d+)\]/i)?.[1] ?? 0);
  if (!Number.isFinite(offset)) return [];
  const lines: TimedLine[] = [];
  for (const row of text.split(/\r?\n/)) {
    const tags = [...row.matchAll(/\[(\d+):([0-5]\d)(?:\.(\d{1,3}))?\]/g)];
    const lyric = row.replace(/\[(\d+):([0-5]\d)(?:\.(\d{1,3}))?\]/g, '').trim();
    for (const tag of tags) {
      const startTimeMs = Number(tag[1]) * 60_000 + Number(tag[2]) * 1000
        + Number((tag[3] ?? '').padEnd(3, '0')) - offset;
      if (Number.isFinite(startTimeMs)) lines.push({ startTimeMs, text: lyric });
    }
  }
  return lines.sort((left, right) => left.startTimeMs - right.startTimeMs);
}

async function loadTimedLyrics(songId: number): Promise<TimedLyrics | null> {
  const result = await getNetEasePlaybackRuntimeDependencies().getSongLyrics(songId);
  if (!result.ok) return null;
  return result.data.status === 'available'
    ? { lines: parseTimedLyrics(result.data.text), truncated: result.data.truncated }
    : { lines: [], truncated: false };
}

export async function getNetEaseCurrentLyric(
  playback: NetEaseLyricPlayback,
  capturedAtEpochMs: number,
): Promise<NetEaseCurrentLyric | null> {
  // MediaSession 的 mediaId 是外部身份；只接受可证明为歌曲 ID 的正整数，不按标题搜索补配。
  if (playback.mediaId === null || !/^[1-9]\d*$/.test(playback.mediaId)) return null;
  const songId = Number(playback.mediaId);
  if (!Number.isSafeInteger(songId)) return null;
  if (playback.positionMs === null || playback.positionMs < 0) return null;
  let positionMs = playback.positionMs;
  if (playback.playbackState === 'playing') {
    if (playback.updatedAtEpochMs === null || playback.speed === null) return null;
    positionMs += Math.max(0, capturedAtEpochMs - playback.updatedAtEpochMs) * playback.speed;
  } else if (!['paused', 'buffering', 'connecting'].includes(playback.playbackState)) {
    return null;
  }
  positionMs = Math.max(0, positionMs);
  if (playback.durationMs !== null && playback.durationMs > 0 && positionMs >= playback.durationMs) return null;

  if (currentLyrics?.songId !== songId) {
    currentLyrics = { songId, request: loadTimedLyrics(songId) };
  }
  const cached = currentLyrics;
  const lyrics = await cached.request;
  if (lyrics === null) {
    // typed 网络失败不永久缓存；后续真实请求可以重新读取，不在当前调用内 retry。
    if (currentLyrics === cached) currentLyrics = null;
    return null;
  }
  let index = -1;
  for (let cursor = 0; cursor < lyrics.lines.length && lyrics.lines[cursor].startTimeMs <= positionMs; cursor += 1) {
    index = cursor;
  }
  // 空白时间戳表示间奏；截断响应的最后一行无法证明完整，不向后无限延续。
  if (index < 0 || (lyrics.truncated && index === lyrics.lines.length - 1)) return null;
  const line = lyrics.lines[index];
  return line.text ? { text: line.text, startTimeMs: line.startTimeMs, positionMs } : null;
}
