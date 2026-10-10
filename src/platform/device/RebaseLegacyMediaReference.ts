/** 仅重定位备份声明的应用私有根；外部 URI 和远程资源原样保留。 */
export function rebaseLegacyMediaReference(uri: string | null, sourceRoot: string, targetRoot: string, ownerPrefixes: readonly string[]): string | null {
  if (uri === null) return null;
  const source = uri.startsWith('/') ? `file://${uri}` : uri;
  if (!source.startsWith(sourceRoot)) return uri;
  const key = source.slice(sourceRoot.length);
  if (key.includes('%') || key.includes('\\') || key.split('/').some((part) => !part || part === '.' || part === '..')
    || !ownerPrefixes.some((prefix) => key.startsWith(prefix))) {
    throw new Error('备份中的长期媒体引用不属于声明的 owner 目录');
  }
  return `${targetRoot}${key}`;
}
