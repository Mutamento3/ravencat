/**
 * Device Control exact Android package target 的唯一校验入口。
 *
 * 只接受精确 packageName：trim 后非空且不含任何空白。
 * 不做 fuzzy search、中文名解析、installed-app 查询，也不做 toLowerCase 改写；
 * exact package identity 由调用方保留，Protected Apps 的大小写归一化由 policy 自行处理。
 *
 * open_app 与 browsable URI dispatch 共用这一 contract，避免两个入口各自漂移。
 */

export function isValidExactTargetPackage(packageName: unknown): packageName is string {
  return (
    typeof packageName === 'string'
    && packageName.trim().length > 0
    && !/\s/u.test(packageName)
  );
}
