import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function loadTypeScriptModule(relativePath) {
  const absolutePath = path.join(repoRoot, relativePath);
  const source = fs.readFileSync(absolutePath, 'utf8');
  const compiled = ts.transpileModule(source, {
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

const catalogModule = loadTypeScriptModule(
  'src/features/phoneTools/domain/PhoneToolCatalog.ts',
);
const directoryModule = loadTypeScriptModule(
  'src/features/miniPrograms/presentation/phoneTools/PhoneToolsDirectoryModel.ts',
);

const { PHONE_TOOL_CATALOG, PHONE_TOOL_CATEGORIES } = catalogModule;
const { buildPhoneToolsDirectory } = directoryModule;

const expectedAvailableNames = [
  'search_installed_apps',
  'get_foreground_app',
  'get_app_usage',
  'read_screen_accessibility',
  'read_screen_ocr',
  'open_app',
  'soft_lock_app',
  'release_soft_lock',
];
const expectedPlannedNames = [];

for (const toolName of expectedAvailableNames) {
  const item = PHONE_TOOL_CATALOG.find((candidate) => candidate.toolName === toolName);
  assert.ok(item, `Phone catalog 必须包含 ${toolName}`);
  assert.equal(item.implementationStatus, 'available', `${toolName} 必须标记为 available`);
}

for (const toolName of expectedPlannedNames) {
  const item = PHONE_TOOL_CATALOG.find((candidate) => candidate.toolName === toolName);
  assert.ok(item, `Phone catalog 必须包含 ${toolName}`);
  assert.equal(item.implementationStatus, 'planned', `${toolName} 必须标记为 planned`);
}

const toolNames = PHONE_TOOL_CATALOG.map((item) => item.toolName);
assert.equal(new Set(toolNames).size, toolNames.length, 'Phone catalog 的 toolName 不得重复');

const categoryIds = new Set(PHONE_TOOL_CATEGORIES.map((category) => category.id));
assert.equal(categoryIds.has('integration'), false, '旧 integration category 必须退役');
assert.equal(toolNames.includes('play_music'), false, '旧 generic play_music 占位必须退役');
assert.equal(
  PHONE_TOOL_CATALOG.some((item) => item.id === 'musicPlayback'),
  false,
  '旧 musicPlayback 产品项必须退役',
);
for (const item of PHONE_TOOL_CATALOG) {
  assert.ok(categoryIds.has(item.category), `${item.toolName} 必须使用合法 category`);
  for (const runtimeField of ['owner', 'risk', 'hostOnly', 'idempotency', 'execution']) {
    assert.equal(
      Object.hasOwn(item, runtimeField),
      false,
      `Phone catalog 不得复制 Runtime metadata：${item.toolName}.${runtimeField}`,
    );
  }
}

const directory = buildPhoneToolsDirectory(PHONE_TOOL_CATALOG, PHONE_TOOL_CATEGORIES);
const directoryItems = directory.flatMap((section) => section.items);
assert.deepEqual(
  directoryItems.map((item) => item.toolName).sort(),
  [...toolNames].sort(),
  '手机工具页面目录必须完整来自 Phone catalog',
);

console.log('Phone Tools catalog contracts verified.');
