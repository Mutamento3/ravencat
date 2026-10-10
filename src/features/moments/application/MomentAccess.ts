/**
 * Moments 的 AI 可见性断言与受保护写命令。
 *
 * 可见性是数据访问权限，不是 Prompt 建议：AI consumer 只能通过这些入口读写，
 * 不允许先取全量再在自己的层里过滤。评论/回复/点赞全部继承所属 Moment 的可见性，
 * 因此这里不建立任何独立的 comment/reply/like ACL。
 */

import type {
  IMomentRepository,
  InsertMomentCommentInput,
  Moment,
  MomentComment,
  MomentLike,
} from '../domain/MomentRepository';
import { throwIfAbortSignalAborted } from '@shared/runtime/abortSignal';
import { releaseMediaAssetCandidates } from '@features/media';
import { MomentDomainError } from '../domain/MomentErrors';
import { createMomentCommentId } from './MomentIds';

/** AI 侧 actor：`agentId` 是不可变身份，`nameSnapshot` 只是写入当时的展示名称。 */
export interface MomentAgentActor {
  agentId: string;
  nameSnapshot: string;
}

/**
 * 断言 Moment 对 viewer 可见并返回它。
 *
 * "不存在"与"对该 viewer 不可见"使用同一个失败原因，否则 AI 可以通过错误差异
 * 探测隐藏 Moment 的存在性。
 */
export async function assertMomentVisibleToAgent(
  repository: IMomentRepository,
  viewerAgentId: string,
  momentId: string
): Promise<Moment> {
  const moment = await repository.getVisibleMomentForAgent(viewerAgentId, momentId);
  if (!moment) {
    throw new MomentDomainError(
      'moment_not_visible',
      '该时刻不存在或对你不可见',
      momentId
    );
  }
  return moment;
}

function normalizeContent(content: string): string {
  const trimmed = typeof content === 'string' ? content.trim() : '';
  if (!trimmed) {
    throw new MomentDomainError('empty_content', '内容不能为空');
  }
  return trimmed;
}

/** 点赞；重复点赞是幂等空操作（返回 null）。 */
export async function likeMomentAsAgent(
  repository: IMomentRepository,
  actor: MomentAgentActor,
  momentId: string,
  abortSignal?: AbortSignal
): Promise<MomentLike | null> {
  await assertMomentVisibleToAgent(repository, actor.agentId, momentId);
  throwIfAbortSignalAborted(abortSignal);
  return repository.insertLike({
    momentId,
    actorType: 'ai',
    actorId: actor.agentId,
    actorNameSnapshot: actor.nameSnapshot,
  });
}

/** 评论；不可见的 Moment 不允许评论。一次调用的多条评论在同一事务内提交。 */
export async function commentMomentAsAgent(
  repository: IMomentRepository,
  actor: MomentAgentActor,
  momentId: string,
  contents: readonly string[],
  abortSignal?: AbortSignal
): Promise<MomentComment[]> {
  const moment = await assertMomentVisibleToAgent(repository, actor.agentId, momentId);
  if (contents.length === 0) {
    throw new MomentDomainError('empty_content', '内容不能为空');
  }
  const inputs: InsertMomentCommentInput[] = contents.map((content) => ({
      id: createMomentCommentId(),
      momentId: moment.id,
      authorType: 'ai',
      authorId: actor.agentId,
      authorNameSnapshot: actor.nameSnapshot,
      parentCommentId: null,
      content: normalizeContent(content),
    }));
  throwIfAbortSignalAborted(abortSignal);
  return repository.insertComments(inputs);
}

/**
 * 回复评论。
 *
 * Moment 由 parent comment 反查，调用方不需要（也不允许）另行传 momentId；
 * 回复目标必须属于对该 AI 可见的 Moment。
 */
export async function replyMomentCommentAsAgent(
  repository: IMomentRepository,
  actor: MomentAgentActor,
  parentCommentId: string,
  contents: readonly string[],
  abortSignal?: AbortSignal
): Promise<MomentComment[]> {
  const parent = await repository.getComment(parentCommentId);
  if (!parent) {
    throw new MomentDomainError('comment_not_found', '回复目标评论不存在', parentCommentId);
  }
  await assertMomentVisibleToAgent(repository, actor.agentId, parent.momentId);
  if (contents.length === 0) {
    throw new MomentDomainError('empty_content', '内容不能为空');
  }
  const inputs: InsertMomentCommentInput[] = contents.map((content) => ({
      id: createMomentCommentId(),
      momentId: parent.momentId,
      authorType: 'ai',
      authorId: actor.agentId,
      authorNameSnapshot: actor.nameSnapshot,
      parentCommentId: parent.id,
      content: normalizeContent(content),
    }));
  throwIfAbortSignalAborted(abortSignal);
  return repository.insertComments(inputs);
}

/** 取消自己的点赞；Moment ACL 与点赞一样在写入前校验。 */
export async function unlikeMomentAsAgent(
  repository: IMomentRepository,
  actor: MomentAgentActor,
  momentId: string,
  abortSignal?: AbortSignal
): Promise<boolean> {
  await assertMomentVisibleToAgent(repository, actor.agentId, momentId);
  throwIfAbortSignalAborted(abortSignal);
  return repository.removeLike(momentId, 'ai', actor.agentId);
}

/** AI 只能删除自己发布的 Moment。 */
export async function deleteOwnMomentAsAgent(
  repository: IMomentRepository,
  actor: MomentAgentActor,
  momentId: string,
  abortSignal?: AbortSignal
): Promise<boolean> {
  const moment = await assertMomentVisibleToAgent(repository, actor.agentId, momentId);
  if (moment.authorType !== 'ai' || moment.authorId !== actor.agentId) {
    throw new MomentDomainError('not_moment_owner', '只能删除自己发布的时刻', momentId);
  }
  throwIfAbortSignalAborted(abortSignal);
  // 与用户侧删除同一条规则：先收集本次删除会失去引用的媒体，再删事实。
  const mediaAssetCandidates = (await repository.listMedia(moment.id))
    .map((media) => media.mediaAssetId);
  const deleted = await repository.deleteMoment(moment.id);
  if (deleted) {
    await releaseMediaAssetCandidates(mediaAssetCandidates);
  }
  return deleted;
}

/** AI 只能删除自己的评论；目标 Moment 不可见时同样拒绝。 */
export async function deleteOwnMomentCommentAsAgent(
  repository: IMomentRepository,
  actor: MomentAgentActor,
  commentId: string,
  abortSignal?: AbortSignal
): Promise<boolean> {
  const comment = await repository.getComment(commentId);
  if (!comment) {
    throw new MomentDomainError('comment_not_found', '评论不存在', commentId);
  }
  await assertMomentVisibleToAgent(repository, actor.agentId, comment.momentId);
  if (comment.authorType !== 'ai' || comment.authorId !== actor.agentId) {
    throw new MomentDomainError('not_comment_owner', '只能删除自己的评论', commentId);
  }
  throwIfAbortSignalAborted(abortSignal);
  return repository.deleteComment(comment.id);
}
