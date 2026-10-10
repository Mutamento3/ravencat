/**
 * 解析群消息正文中的自然 @。
 *
 * 解析器只负责把 AI 最终输出中已经确定的群参与者映射为结构化事实，
 * 不改写正文，也不触发发言任务。用户 @ 已由候选选择事实负责，不从用户
 * 手写正文反推。可见目录由 GroupParticipantDirectory application owner
 * 提供：disabled、已删除或不存在的成员不会进入目录，blocked 成员仍可
 * 作为明确称呼目标。
 */

import type { GroupMessageMention } from '../../messages/domain/chatMessageMetadata';
import type { GroupParticipantDirectory } from '../domain/GroupParticipantDirectory';

interface MentionCandidate {
  targetType: 'user' | 'assistant';
  targetId: string;
  displayNameAtSend: string;
}

interface MentionMatch {
  index: number;
  length: number;
  candidate: MentionCandidate;
}

/**
 * 按正文中首次出现顺序解析自然 @，同一来源对同一目标只保留一次。
 *
 * 名称映射必须唯一；当多个可见参与者拥有同一显示名时，所有该显示名
 * 的文本都被视为无法消歧，而不是猜测一个目标。英文/数字/下划线以及
 * Unicode 字母、数字、组合标记属于名称连续字符，避免 @小明 错配
 * @小明明 或 @Bob_2。
 */
export function parseGroupMessageMentions(params: {
  text: string;
  directory: GroupParticipantDirectory;
  actorAssistantId: string;
}): GroupMessageMention[] {
  const candidates = buildMentionCandidates(params.directory);
  if (!params.text || candidates.length === 0) {
    return [];
  }

  const uniqueCandidates = candidates.filter((candidate, index) => (
    candidates.findIndex((other) => (
      other.targetType === candidate.targetType
      && other.targetId === candidate.targetId
    )) === index
  ));
  const candidatesByName = new Map<string, MentionCandidate[]>();
  for (const candidate of uniqueCandidates) {
    const sameName = candidatesByName.get(candidate.displayNameAtSend);
    if (sameName) {
      sameName.push(candidate);
    } else {
      candidatesByName.set(candidate.displayNameAtSend, [candidate]);
    }
  }

  const unambiguousCandidates = [...candidatesByName.values()]
    .filter((sameName) => sameName.length === 1)
    .map((sameName) => sameName[0]);
  if (unambiguousCandidates.length === 0) {
    return [];
  }

  const matches: MentionMatch[] = [];
  for (const candidate of unambiguousCandidates) {
    const token = `@${candidate.displayNameAtSend}`;
    let searchFrom = 0;
    while (searchFrom < params.text.length) {
      const index = params.text.indexOf(token, searchFrom);
      if (index < 0) {
        break;
      }

      const nextCharacter = params.text[index + token.length];
      if (isMentionBoundaryAfter(nextCharacter)) {
        matches.push({
          index,
          length: token.length,
          candidate,
        });
      }
      searchFrom = index + 1;
    }
  }

  matches.sort((left, right) => (
    left.index - right.index
    || right.length - left.length
  ));

  const mentions: GroupMessageMention[] = [];
  const seenTargets = new Set<string>();
  const acceptedRanges: { start: number; end: number }[] = [];
  for (const match of matches) {
    const rangeEnd = match.index + match.length;
    if (acceptedRanges.some((range) => (
      match.index < range.end && range.start < rangeEnd
    ))) {
      continue;
    }

    const targetKey = `${match.candidate.targetType}:${match.candidate.targetId}`;
    if (seenTargets.has(targetKey)) {
      continue;
    }
    seenTargets.add(targetKey);
    acceptedRanges.push({ start: match.index, end: rangeEnd });
    if (
      match.candidate.targetType === 'assistant'
      && match.candidate.targetId === params.actorAssistantId
    ) {
      continue;
    }
    mentions.push(toGroupMessageMention(params.actorAssistantId, match.candidate));
  }

  return mentions;
}

function buildMentionCandidates(
  directory: GroupParticipantDirectory,
): MentionCandidate[] {
  const candidates: MentionCandidate[] = [];
  const currentUser = directory.currentUser;
  if (currentUser.userProfileId.trim() && currentUser.displayName.trim()) {
    candidates.push({
      targetType: 'user',
      targetId: currentUser.userProfileId,
      displayNameAtSend: currentUser.displayName,
    });
  }

  for (const assistant of directory.assistants) {
    if (!assistant.assistantId.trim() || !assistant.displayName.trim()) {
      continue;
    }
    candidates.push({
      targetType: 'assistant',
      targetId: assistant.assistantId,
      displayNameAtSend: assistant.displayName,
    });
  }

  return candidates;
}

function toGroupMessageMention(
  actorAssistantId: string,
  candidate: MentionCandidate,
): GroupMessageMention {
  return {
    actorType: 'assistant',
    actorAssistantId,
    target: candidate.targetType === 'user'
      ? {
          targetType: 'user',
          userProfileId: candidate.targetId,
          displayNameAtSend: candidate.displayNameAtSend,
        }
      : {
          targetType: 'assistant',
          assistantId: candidate.targetId,
          displayNameAtSend: candidate.displayNameAtSend,
        },
  };
}

function isMentionBoundaryAfter(character: string | undefined): boolean {
  return !character || !isNameContinuation(character);
}

function isNameContinuation(character: string): boolean {
  return /[\p{L}\p{N}\p{M}_]/u.test(character);
}
