import { useEffect, useState } from 'react';
import { getCurrentUserProfile, subscribeUserProfileUpdated } from '../composition';
import type { UserProfile } from '../domain/UserProfile';

/** 资料提交后的事实同步所有已挂载消费者，返回列表无需保留另一份编辑状态。 */
export function useCurrentUserProfile() {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  useEffect(() => {
    let active = true;
    let updated = false;
    setError(null);
    const unsubscribe = subscribeUserProfileUpdated((next) => { updated = true; setProfile(next); });
    void getCurrentUserProfile().then((next) => {
      if (active && !updated) setProfile(next);
    }).catch((cause: unknown) => {
      console.error('[个人资料] 读取失败', cause);
      if (active) setError('个人资料读取失败，请重试。');
    });
    return () => { active = false; unsubscribe(); };
  }, [reloadKey]);
  return { profile, error, reload: () => setReloadKey((key) => key + 1) };
}
