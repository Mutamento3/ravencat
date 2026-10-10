export const USER_PROFILE_FIELDS = ['name', 'gender', 'age', 'identity', 'region', 'other', 'signature'] as const;
export type UserProfileField = typeof USER_PROFILE_FIELDS[number];

/** 路由参数是外部输入，仅在路由适配边界识别字段。 */
export function isUserProfileField(value: unknown): value is UserProfileField {
  return USER_PROFILE_FIELDS.some((field) => field === value);
}
