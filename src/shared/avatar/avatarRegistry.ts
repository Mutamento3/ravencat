
/**
 * 默认头像资源：资料里没有自定义头像时使用。
 * 历史上这里曾按 AI 名字模糊匹配专属头像，对应角色已下线，规则简化为固定默认图。
 */
const defaultUserAvatar = require('../../../assets/fengdu.png');
const defaultAIAvatar = require('../../../assets/raven.png');
const defaultGroupAvatar = require('../../../assets/icon.png');

export function getDefaultUserAvatarAsset(): number {
  return defaultUserAvatar;
}

export function getDefaultAIAvatarAsset(): number {
  return defaultAIAvatar;
}

export function getDefaultGroupAvatarAsset(): number {
  return defaultGroupAvatar;
}
