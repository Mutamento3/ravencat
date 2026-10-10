import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

function loadTypeScriptModule(relativePath) {
  const absolutePath = path.join(repoRoot, relativePath);
  const compiled = ts.transpileModule(read(relativePath), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: absolutePath,
    reportDiagnostics: true,
  });
  const errors = (compiled.diagnostics ?? []).filter(
    (diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error,
  );
  assert.deepEqual(errors, [], `${relativePath} 无法编译`);

  const module = { exports: {} };
  const executeModule = new Function(
    'exports',
    'require',
    'module',
    '__filename',
    '__dirname',
    compiled.outputText,
  );
  executeModule(
    module.exports,
    () => {
      throw new Error(`${relativePath} 不应存在运行时依赖`);
    },
    module,
    absolutePath,
    path.dirname(absolutePath),
  );
  return module.exports;
}

const packageCatalogModule = loadTypeScriptModule(
  'src/features/phoneTools/toolPackages/ToolPackageCatalog.ts',
);
const directCatalogModule = loadTypeScriptModule(
  'src/features/phoneTools/domain/PhoneToolCatalog.ts',
);
const displayModelModule = loadTypeScriptModule(
  'src/features/miniPrograms/presentation/phoneTools/ToolPackageDisplayModel.ts',
);

const {
  getPhoneToolPackageById,
  PHONE_TOOL_PACKAGE_CATALOG,
} = packageCatalogModule;
const { PHONE_TOOL_CATALOG, PHONE_TOOL_CATEGORIES } = directCatalogModule;
const { buildToolPackageDisplayModel } = displayModelModule;

assert.notStrictEqual(
  PHONE_TOOL_PACKAGE_CATALOG,
  PHONE_TOOL_CATALOG,
  'Tool Package Catalog 必须独立于直接 Phone Tool Catalog',
);

const neteaseMusic = getPhoneToolPackageById('neteaseMusic');
assert.ok(neteaseMusic, '必须存在网易云音乐工具包 shell');
assert.equal(neteaseMusic.title, '网易云音乐工具包');
assert.equal(neteaseMusic.implementationStatus, 'available');
assert.deepEqual(
  neteaseMusic.tools.map(({ toolName }) => toolName),
  [
    'netease_search_songs',
    'netease_search_public_playlists',
    'netease_get_public_playlist',
    'netease_get_song_lyrics',
    'netease_resolve_share_link',
    'netease_play_song',
    'netease_get_playback_state',
    'netease_control_playback',
  ],
  'NetEase package 必须展示八个已上线 child Tools',
);
assert.ok(
  neteaseMusic.tools.every(({ implementationStatus }) => implementationStatus === 'available'),
);
assert.equal(getPhoneToolPackageById('unknown'), undefined, '未知 package id 必须安全返回 undefined');

const packageIds = PHONE_TOOL_PACKAGE_CATALOG.map((toolPackage) => toolPackage.id);
assert.equal(new Set(packageIds).size, packageIds.length, 'Tool Package id 不得重复');

const packageToolNames = PHONE_TOOL_PACKAGE_CATALOG.flatMap(
  (toolPackage) => toolPackage.tools.map((tool) => tool.toolName),
);
assert.equal(
  new Set(packageToolNames).size,
  packageToolNames.length,
  'Tool Package child toolName 必须在整个目录中唯一',
);

for (const descriptor of [
  ...PHONE_TOOL_PACKAGE_CATALOG,
  ...PHONE_TOOL_PACKAGE_CATALOG.flatMap((toolPackage) => toolPackage.tools),
]) {
  for (const runtimeField of ['owner', 'risk', 'hostOnly', 'idempotency', 'execution']) {
    assert.equal(
      Object.hasOwn(descriptor, runtimeField),
      false,
      `Tool Package 产品目录不得复制 Runtime metadata：${runtimeField}`,
    );
  }
}

assert.equal(
  PHONE_TOOL_CATEGORIES.some((category) => category.id === 'integration'),
  false,
  'Tool Package 不得重新成为直接 Tool category',
);
assert.equal(
  PHONE_TOOL_CATALOG.some(
    (tool) => tool.toolName === 'play_music' || tool.id === 'musicPlayback',
  ),
  false,
  '旧 generic play_music 产品占位必须退役',
);

const expectedDirectTools = [
  'search_installed_apps',
  'get_foreground_app',
  'get_app_usage',
  'read_screen_accessibility',
  'read_screen_ocr',
  'open_app',
  'soft_lock_app',
  'release_soft_lock',
];
assert.deepEqual(
  PHONE_TOOL_CATALOG.map((tool) => tool.toolName).sort(),
  expectedDirectTools.sort(),
  '当前手机工具目录必须完整保留直接工具',
);
assert.ok(
  PHONE_TOOL_CATALOG.every((tool) => tool.implementationStatus === 'available'),
  '现有直接 Phone Tools 必须全部 available',
);

const syntheticModel = buildToolPackageDisplayModel({
  id: 'synthetic',
  title: '测试工具包',
  description: '只用于验证通用 display model。',
  implementationStatus: 'available',
  tools: [
    {
      id: 'availableTool',
      toolName: 'synthetic_available_tool',
      title: '可用工具',
      description: '可用状态测试。',
      implementationStatus: 'available',
    },
    {
      id: 'plannedTool',
      toolName: 'synthetic_planned_tool',
      title: '规划工具',
      description: '规划状态测试。',
      implementationStatus: 'planned',
    },
  ],
});
assert.deepEqual(
  syntheticModel.tools.map((tool) => tool.statusLabel),
  ['可使用', '开发中'],
  '通用详情 display model 必须支持未来非空 tools 的两种状态',
);

const homeScreen = read(
  'src/features/miniPrograms/presentation/phoneTools/PhoneToolsScreen.tsx',
);
assert.match(homeScreen, /PHONE_TOOL_PACKAGE_CATALOG\.map\(/, '主页 package 区域必须来自 Package Catalog');
assert.match(homeScreen, /应用工具包/, '主页必须包含独立的应用工具包区域');
assert.ok(
  homeScreen.indexOf('PHONE_TOOL_SECTIONS.map') < homeScreen.indexOf('PHONE_TOOL_PACKAGE_CATALOG.map'),
  '应用工具包区域必须位于普通 Tool sections 之后',
);
assert.doesNotMatch(homeScreen, /neteaseMusic|网易云音乐工具包/, '主页 JSX 不得硬编码网易云 package');
assert.match(homeScreen, /TouchableOpacity[\s\S]*onOpenToolPackage/, 'planned package 必须保持可导航');
assert.match(homeScreen, /chevron-forward-outline/, 'package 行必须显示 chevron');

const directoryModel = read(
  'src/features/miniPrograms/presentation/phoneTools/PhoneToolsDirectoryModel.ts',
);
assert.match(directoryModel, /PHONE_TOOL_CATALOG|catalog/, '直接 Tool directory 必须继续消费直接 Catalog');
assert.doesNotMatch(directoryModel, /PHONE_TOOL_PACKAGE_CATALOG/, 'Tool Packages 不得污染直接 Tool directory');

const detailScreen = read(
  'src/features/miniPrograms/presentation/phoneTools/ToolPackageScreen.tsx',
);
assert.match(detailScreen, /getPhoneToolPackageById/, '通用详情页必须按 package id resolve');
assert.match(detailScreen, /工具包不存在/, '通用详情页必须安全显示 unknown package');
assert.match(detailScreen, /tools\.length === 0/, '通用详情页必须处理 empty tools');
assert.match(detailScreen, /当前暂无可用工具/, '通用详情页必须显示 empty state');
assert.doesNotMatch(detailScreen, /neteaseMusic|网易云/, '通用详情页不得包含 App-specific branch 或文案');

const dynamicRoute = 'src/app/phone-tools/packages/[packageId].tsx';
assert.equal(fs.existsSync(path.join(repoRoot, dynamicRoute)), true, '必须存在通用动态 package route');
assert.match(read(dynamicRoute), /ToolPackageScreen/, '动态 route 必须只适配通用详情页');
assert.equal(
  fs.existsSync(path.join(repoRoot, 'src/app/phone-tools/netease-music.tsx')),
  false,
  '不得建立网易云硬编码 route',
);

const scopedSources = [
  'src/features/phoneTools/toolPackages/ToolPackageCatalog.ts',
  'src/features/miniPrograms/presentation/phoneTools/PhoneToolsScreen.tsx',
  'src/features/miniPrograms/presentation/phoneTools/ToolPackageScreen.tsx',
].map(read).join('\n');
for (const forbidden of [
  'get_tool_package_tools',
  'discover_tool_package',
  'activate_tool_package',
  'SkillRegistry',
  'SkillLoader',
  'SkillPlanner',
]) {
  assert.equal(scopedSources.includes(forbidden), false, `PHONE-7A 禁止新增 ${forbidden}`);
}
assert.doesNotMatch(scopedSources, /Netease\w*Tool/, 'PHONE-7A 禁止新增网易云真实 Tool');

console.log('Phone Tool Package catalog and UI contracts verified.');
