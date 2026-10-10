/** 本轮完整读取的凭据：避免只拿到摘要 ID 就直接点赞，也避免同批预排的调用绕过读取。 */
import { readMomentDetail } from '../application/ReadMomentDetail';
import type { MomentToolContext } from './MomentToolContext';

interface ReadReceipt { agentId: string; momentId: string; token: string }

export async function readMomentForTool(context: MomentToolContext, agentId: string, momentId: string) {
  const detail = await readMomentDetail(context.repositories.moment!, agentId, momentId);
  const receipt: ReadReceipt = {
    agentId,
    momentId,
    token: `moment_read_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`,
  };
  const receipts = context.sharedState.momentReadReceipts as Map<string, ReadReceipt> | undefined;
  const current = receipts ?? new Map<string, ReadReceipt>();
  current.set(momentId, receipt);
  context.sharedState.momentReadReceipts = current;
  return {
    success: true,
    message: `${detail.message}\n\nreadReceipt: ${receipt.token}\n若决定点赞，请将这个 readReceipt 与 momentId 一起传给 aiLikeMoment。`,
    data: { ...detail.data, readReceipt: receipt.token },
  };
}

export function hasMomentReadReceipt(context: MomentToolContext, agentId: string, momentId: string, token: string | undefined): boolean {
  const receipt = (context.sharedState.momentReadReceipts as Map<string, ReadReceipt> | undefined)?.get(momentId);
  return receipt !== undefined && receipt.agentId === agentId && receipt.token === token;
}
