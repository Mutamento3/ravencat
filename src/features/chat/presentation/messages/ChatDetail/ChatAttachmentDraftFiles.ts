/** 输入草稿与失败乐观气泡共同持有发送源；最后一个真实消费者退出时才释放文件。 */
import { deletePersistentMediaIfExists } from '@platform/device/DeviceMediaService';
import type { ChatAttachment } from '../../../messages/domain/ChatAttachment';

interface DraftFile { uri: string; holders: number }
const draftFiles = new Map<string, DraftFile>();

function release(files: readonly DraftFile[]): () => void {
  let released = false;
  return () => {
    if (released) return;
    released = true;
    for (const file of files) {
      file.holders -= 1;
      if (file.holders > 0) continue;
      draftFiles.delete(file.uri);
      void deletePersistentMediaIfExists(file.uri).catch((error) => {
        console.warn('[ChatAttachmentDraftFiles] 发送源释放失败：', error);
      });
    }
  };
}

/** 只登记本次 picker 准备的源文件；历史 committed legacy 文件不属于草稿回收范围。 */
export function ownChatAttachmentDraftFile(uri: string): () => void {
  const file = { uri, holders: 1 };
  draftFiles.set(uri, file);
  return release([file]);
}

export function retainChatAttachmentDraftFiles(attachments: readonly ChatAttachment[]): () => void {
  const files: DraftFile[] = [];
  for (const attachment of attachments) {
    if (!attachment.localUri) continue;
    const file = draftFiles.get(attachment.localUri);
    if (!file) continue;
    file.holders += 1;
    files.push(file);
  }
  return release(files);
}
