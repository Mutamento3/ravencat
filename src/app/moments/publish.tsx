/** 发布时刻路由：独立 push 页面。只有发布成功才返回；失败由 PublishView 提示并保留草稿。 */
import { useRouter } from 'expo-router';
import {
  createUserMomentRecord,
  PublishView,
  type PublishMomentDraft,
} from '@features/moments';

export default function MomentPublishRoute() {
  const router = useRouter();

  const handlePublish = async (draft: PublishMomentDraft) => {
    try {
      // 失败必须原样抛回 PublishView：由它提示并保留正文 / 图片 / 地点 / 可见范围。
      await createUserMomentRecord(draft);
    } catch (error) {
      console.error('Failed to publish moment:', error);
      throw error;
    }
    router.back();
  };

  return <PublishView onPublish={handlePublish} onCancel={() => router.back()} />;
}
