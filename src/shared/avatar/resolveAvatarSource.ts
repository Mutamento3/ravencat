import type { ImageSourcePropType } from 'react-native';

import { DEFAULT_SELF_NAME } from '@shared';
import {
  getDefaultAIAvatarAsset,
  getDefaultGroupAvatarAsset,
  getDefaultUserAvatarAsset,
} from './avatarRegistry';

export interface AvatarIdentityLike {
  name?: string | null;
}

export interface UserAvatarProfileLike extends AvatarIdentityLike {
  avatar?: string | null;
}

export interface ResolvedAvatarSource {
  source: ImageSourcePropType | null;
  fallbackSource: ImageSourcePropType | null;
  fallbackText: string;
}

function normalizeName(name?: string | null, fallback = '?'): string {
  const trimmed = String(name || '').trim();
  return trimmed || fallback;
}

function isLikelyAvatarUri(value?: string | null): boolean {
  const trimmed = String(value || '').trim();
  if (!trimmed) return false;

  return (
    trimmed.startsWith('file://') ||
    trimmed.startsWith('content://') ||
    trimmed.startsWith('http://') ||
    trimmed.startsWith('https://') ||
    trimmed.startsWith('/') ||
    /^[a-zA-Z]:[\\/]/.test(trimmed)
  );
}

function toUriSource(uri?: string | null): ImageSourcePropType | null {
  if (!isLikelyAvatarUri(uri)) {
    return null;
  }

  const normalizedUri = String(uri).trim();
  const sourceUri = normalizedUri.startsWith('/') ? `file://${normalizedUri}` : normalizedUri;
  return { uri: sourceUri };
}

export function resolveAvatarFallback(
  identity?: AvatarIdentityLike | null,
  kind: 'user' | 'ai' = 'ai'
): string {
  const fallbackName = kind === 'user' ? DEFAULT_SELF_NAME : 'AI';
  const name = normalizeName(identity?.name, fallbackName);
  return name.charAt(0).toUpperCase() || fallbackName.charAt(0).toUpperCase();
}

export function resolveUserAvatarSource(
  profile?: UserAvatarProfileLike | null
): ResolvedAvatarSource {
  const customSource = toUriSource(profile?.avatar);
  const defaultSource = getDefaultUserAvatarAsset();

  return {
    source: customSource || defaultSource,
    fallbackSource: customSource ? defaultSource : null,
    fallbackText: resolveAvatarFallback(profile, 'user'),
  };
}

export interface AIAvatarProfileLike extends AvatarIdentityLike {
  avatar?: string | null;
}

export function resolveAIAvatarSource(
  aiProfile?: AIAvatarProfileLike | null
): ResolvedAvatarSource {
  const customSource = toUriSource(aiProfile?.avatar);
  const defaultSource = getDefaultAIAvatarAsset();

  return {
    source: customSource || defaultSource,
    fallbackSource: customSource ? defaultSource : null,
    fallbackText: resolveAvatarFallback(aiProfile, 'ai'),
  };
}

export function resolveGroupAvatarSource(
  group?: UserAvatarProfileLike | null
): ResolvedAvatarSource {
  const customSource = toUriSource(group?.avatar);
  const defaultSource = getDefaultGroupAvatarAsset();

  return {
    source: customSource || defaultSource,
    fallbackSource: customSource ? defaultSource : null,
    fallbackText: resolveAvatarFallback(group, 'ai'),
  };
}
