/** 从锁文件记录全部 npm 依赖，并保留已安装包内的许可原文；不猜测缺失许可。 */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const lockText = fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8').replace(/\r\n/g, '\n');
const lock = JSON.parse(lockText);
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const legalName = /^(?:(?:(?:MIT|BSD|APACHE|THIRD[-_]PARTY)[-_])?licen[cs]es?(?:[._-].*)?|copying(?:[._-].*)?|notice(?:[._-].*)?|copyright(?:[._-].*)?|unlicense(?:[._-].*)?|ofl(?:[._-].*)?)$/i;

function legalFiles(directory, relative = '') {
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const name = path.posix.join(relative, entry.name);
    if (entry.isDirectory() && !['node_modules', '.git'].includes(entry.name)) {
      files.push(...legalFiles(path.join(directory, entry.name), name));
    } else if (entry.isFile() && legalName.test(entry.name)) {
      files.push(name);
    }
  }
  return files.sort();
}

const packages = [];
const noticeGroups = new Map();
const upstreamDirectory = path.join(root, 'docs', 'third-party', 'upstream');
const upstreamSources = JSON.parse(fs.readFileSync(path.join(upstreamDirectory, 'sources.json'), 'utf8'));
// 补充原文只绑定已核对的包版本；升级后不沿用旧版本的授权归属。
const packageLicenses = new Map(upstreamSources.filter((source) => source.packages).flatMap((source) =>
  source.packages.map((id) => [id, source])));
// 这些上游仓库的发布包没有各自复制根许可；使用已核对的上游原文并记录来源。
const repositoryLicenses = new Map([
  ['https://github.com/expo/expo', 'expo-54.0.33-LICENSE.txt'],
  ['https://github.com/facebook/react-native', 'react-native-0.81.5-LICENSE.txt'],
  ['https://github.com/facebook/metro', 'metro-0.83.3-LICENSE.txt'],
]);
for (const [location, entry] of Object.entries(lock.packages)) {
  if (!location) continue;
  const name = location.split('node_modules/').at(-1);
  const directory = path.join(root, location);
  const installed = fs.existsSync(path.join(directory, 'package.json'));
  const metadata = installed ? JSON.parse(fs.readFileSync(path.join(directory, 'package.json'), 'utf8')) : null;
  if (installed && metadata.version !== entry.version) {
    throw new Error(`${location} 的安装版本与锁文件不同，请先运行 npm ci。`);
  }
  if (!installed && !entry.optional) {
    throw new Error(`${location} 尚未安装，请先运行 npm ci。`);
  }
  // 少数旧包使用 licenses 字段，原样记录；不以文件内容推测许可证名称。
  const license = entry.license ?? metadata?.license ?? metadata?.licenses ?? null;
  const notices = installed ? legalFiles(directory).map((file) => ({
    file,
    text: fs.readFileSync(path.join(directory, file), 'utf8').replace(/\r\n/g, '\n'),
  })) : [];
  const rawRepository = typeof metadata?.repository === 'string' ? metadata.repository : metadata?.repository?.url;
  const githubRepository = rawRepository?.match(/github\.com[:/]([^/]+\/[^/#]+?)(?:\.git)?$/)?.[1];
  const repository = githubRepository ? `https://github.com/${githubRepository}` : rawRepository;
  const upstreamFile = repositoryLicenses.get(repository);
  const id = `${name}@${entry.version}`;
  const upstreamLicense = notices.length === 0
    ? packageLicenses.get(id) ?? (upstreamFile ? upstreamSources.find(({ file }) => file === upstreamFile) : null)
    : null;
  if (upstreamLicense) {
    const sourceKind = upstreamLicense.sourceFile ? '发布包原文' : '上游仓库';
    notices.push({ file: `${sourceKind}/${upstreamLicense.file}`, text: fs.readFileSync(path.join(upstreamDirectory, upstreamLicense.file), 'utf8') });
  }
  const record = {
    name, version: entry.version, location,
    direct: Object.hasOwn(manifest.dependencies, name) && location === `node_modules/${name}` ? 'runtime'
      : Object.hasOwn(manifest.devDependencies, name) && location === `node_modules/${name}` ? 'development' : null,
    developmentOnly: entry.dev === true,
    optional: entry.optional === true,
    installed, license,
    source: `https://www.npmjs.com/package/${name}/v/${entry.version}`,
    noticeFiles: notices.map(({ file }) => file),
    ...(upstreamLicense ? { noticeSource: upstreamLicense.source } : {}),
  };
  packages.push(record);
  if (!noticeGroups.has(id)) noticeGroups.set(id, notices);
}

const output = path.join(root, 'docs', 'third-party');
fs.mkdirSync(output, { recursive: true });
const inventory = {
  description: '锁文件中的 npm 包及安装包内许可文件清单。未安装的跨平台可选包和未附许可文件的包须另行核对；此清单不等于 APK 实际依赖清单。',
  lockfileSha256: createHash('sha256').update(lockText).digest('hex'),
  packages,
};
fs.writeFileSync(path.join(output, 'npm-inventory.json'), `${JSON.stringify(inventory, null, 2)}\n`);
const directRows = packages.filter((entry) => entry.direct).map((entry) =>
  `| [${entry.name}](${entry.source}) | ${entry.version} | ${entry.license} | ${entry.direct === 'runtime' ? '运行依赖' : '开发工具'} |`);
fs.writeFileSync(path.join(output, 'npm-direct-dependencies.md'), [
  '# npm 直接依赖', '',
  '由 `scripts/generate-third-party-notices.mjs` 从锁文件生成。完整传递依赖及许可文件状态见 [npm-inventory.json](npm-inventory.json)，许可原文见 [npm-notices.txt](npm-notices.txt)。', '',
  '| 组件 | 锁定版本 | 许可证 | 用途范围 |', '|---|---|---|---|', ...directRows, '',
].join('\n'));
const installedNoticeGaps = packages.filter((entry) => entry.installed && entry.noticeFiles.length === 0);
fs.writeFileSync(path.join(output, 'npm-notice-gaps.md'), [
  '# npm 许可原文收集缺口', '',
  '由 `scripts/generate-third-party-notices.mjs` 生成。下表只列已安装且尚未收集到完整许可原文的包；许可证名称来自包元数据，不代表没有授权，也不替代原文。', '',
  '当前源码快照不包含 `node_modules/` 或这些包的构建产物。直接分发这些包或将其打入安装包前，需要按实际分发范围补齐相应原文和署名；本表不等于 APK 依赖清单。', '',
  `${packages.filter((entry) => !entry.installed).length} 个未安装的跨平台可选包另见 [完整清单](npm-inventory.json)。`, '',
  '| 包 | 锁定版本 | 元数据许可证 |', '|---|---|---|',
  ...installedNoticeGaps.map((entry) => `| [${entry.name}](${entry.source}) | ${entry.version} | ${entry.license} |`), '',
].join('\n'));
const texts = ['第三方 npm 许可原文\n\n由 scripts/generate-third-party-notices.mjs 生成。保留上游原文，不翻译许可条款。\n'];
for (const [id, notices] of noticeGroups) {
  if (notices.length === 0) continue;
  texts.push(`\n${'='.repeat(72)}\n${id}\n`);
  for (const { file, text } of notices) texts.push(`\n--- ${file} ---\n${text.trimEnd()}\n`);
}
fs.writeFileSync(path.join(output, 'npm-notices.txt'), texts.join(''));
console.log(`已记录 ${packages.length} 个锁文件条目；${packages.filter((p) => !p.installed).length} 个跨平台可选包未安装，${installedNoticeGaps.length} 个已安装包尚未收集到完整许可原文。`);
