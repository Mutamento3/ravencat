/** 用户侧 Moments 事实写命令；当前用户身份在这里固定，不由 Presentation 传入。 */
import { getCurrentUserProfile, SELF_USER_PROFILE_ID } from '@features/profile';
import { throwIfAbortSignalAborted } from '@shared/runtime/abortSignal';
import { releaseMediaAssetCandidates } from '@features/media';
import type {
  IMomentRepository,
  MomentComment,
  MomentLike,
} from '../domain/MomentRepository';
import { MomentDomainError } from '../domain/MomentErrors';
import { createMomentCommentId } from './MomentIds';

function normalizeContent(content: string): string {
  const trimmed = typeof content === 'string' ? content.trim() : '';
  if (!trimmed) throw new MomentDomainError('empty_content', '内容不能为空');
  return trimmed;
}

/** 用户评论/回复；回复归属由 Repository 在同一事务内校验。 */
export async function commentMomentAsUser(
  repository: IMomentRepository,
  momentId: string,
  content: string,
  parentCommentId: string | null = null,
  abortSignal?: AbortSignal
): Promise<MomentComment> {
  const [moment, profile] = await Promise.all([
    repository.getMomentForUser(momentId),
    getCurrentUserProfile(),
  ]);
  if (!moment) throw new MomentDomainError('moment_not_found', '时刻不存在', momentId);
  const input = {
    id: createMomentCommentId(),
    momentId: moment.id,
    authorType: 'user' as const,
    authorId: SELF_USER_PROFILE_ID,
    authorNameSnapshot: profile.name,
    parentCommentId,
    content: normalizeContent(content),
  };
  throwIfAbortSignalAborted(abortSignal);
  const [comment] = await repository.insertComments([input]);
  return comment!;
}

export async function likeMomentAsUser(
  repository: IMomentRepository,
  momentId: string,
  abortSignal?: AbortSignal
): Promise<MomentLike | null> {
  const [moment, profile] = await Promise.all([
    repository.getMomentForUser(momentId),
    getCurrentUserProfile(),
  ]);
  if (!moment) throw new MomentDomainError('moment_not_found', '时刻不存在', momentId);
  throwIfAbortSignalAborted(abortSignal);
  return repository.insertLike({
    momentId: moment.id,
    actorType: 'user',
    actorId: SELF_USER_PROFILE_ID,
    actorNameSnapshot: profile.name,
  });
}

export async function unlikeMomentAsUser(
  repository: IMomentRepository,
  momentId: string,
  abortSignal?: AbortSignal
): Promise<boolean> {
  const moment = await repository.getMomentForUser(momentId);
  if (!moment) throw new MomentDomainError('moment_not_found', '时刻不存在', momentId);
  throwIfAbortSignalAborted(abortSignal);
  return repository.removeLike(moment.id, 'user', SELF_USER_PROFILE_ID);
}

export async function deleteOwnMomentAsUser(
  repository: IMomentRepository,
  momentId: string,
  abortSignal?: AbortSignal
): Promise<boolean> {
  const moment = await repository.getMomentForUser(momentId);
  if (!moment) throw new MomentDomainError('moment_not_found', '时刻不存在', momentId);
  if (moment.authorType !== 'user' || moment.authorId !== SELF_USER_PROFILE_ID) {
    throw new MomentDomainError('not_moment_owner', '只能删除自己发布的时刻', momentId);
  }
  throwIfAbortSignalAborted(abortSignal);
  // Moment 媒体引用随 moment_media 行一起消失：删除前收集候选，不做全库媒体扫描。
  const mediaAssetCandidates = (await repository.listMedia(moment.id))
    .map((media) => media.mediaAssetId);
  const deleted = await repository.deleteMoment(moment.id);
  if (deleted) {
    await releaseMediaAssetCandidates(mediaAssetCandidates);
  }
  return deleted;
}

/** 用户可删除自己的评论，也可管理自己 Moment 下的 AI 评论。 */
export async function deleteMomentCommentAsUser(
  repository: IMomentRepository,
  commentId: string,
  abortSignal?: AbortSignal
): Promise<boolean> {
  const comment = await repository.getComment(commentId);
  if (!comment) throw new MomentDomainError('comment_not_found', '评论不存在', commentId);
  const isOwnComment = comment.authorType === 'user'
    && comment.authorId === SELF_USER_PROFILE_ID;
  if (!isOwnComment) {
    const moment = await repository.getMomentForUser(comment.momentId);
    const canModerateOwnMoment = moment?.authorType === 'user'
      && moment.authorId === SELF_USER_PROFILE_ID;
    if (!canModerateOwnMoment) {
      throw new MomentDomainError('not_comment_owner', '无权删除该评论', commentId);
    }
  }
  throwIfAbortSignalAborted(abortSignal);
  return repository.deleteComment(comment.id);
}
