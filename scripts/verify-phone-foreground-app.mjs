import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

function loadTypeScriptModule(relativePath, mocks = {}) {
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
    (specifier) => {
      assert.ok(Object.hasOwn(mocks, specifier), `${relativePath} 存在未声明依赖：${specifier}`);
      return mocks[specifier];
    },
    module,
    absolutePath,
    path.dirname(absolutePath),
  );
  return module.exports;
}

const abortSignalRuntime = loadTypeScriptModule('src/shared/runtime/abortSignal.ts');
const protectedAppsPolicy = loadTypeScriptModule(
  'src/features/phoneTools/application/ProtectedAppsPolicy.ts',
);

let currentHostAiId = 'host-ai';
let windowState;
let protectedPackages;
let windowReadCount = 0;

const toolModule = loadTypeScriptModule(
  'src/features/phoneTools/aiTools/GetForegroundAppTool.ts',
  {
    '@features/assistants': {
      runAsCurrentHostAuthority: async (actorAiId, action) => (
        actorAiId === currentHostAiId
          ? { status: 'authorized', value: await action() }
          : { status: 'not_current_host' }
      ),
    },
    '@shared/runtime/abortSignal': abortSignalRuntime,
    '../application/CurrentProtectedAppsPolicy': {
      loadCurrentProtectedPackages: async () => protectedPackages,
    },
    '../application/ForegroundAppRuntimeDependencies': {
      getForegroundAppRuntimeDependencies: () => ({
        getCurrentWindowState: async () => {
          windowReadCount += 1;
          return windowState;
        },
      }),
    },
    '../application/ProtectedAppsPolicy': protectedAppsPolicy,
  },
);

const context = {
  getAIId: () => 'host-ai',
  abortSignal: new AbortController().signal,
};

assert.equal(toolModule.definition.name, 'get_foreground_app');
assert.deepEqual(toolModule.definition.parameters.properties, {});
assert.equal(toolModule.definition.parameters.additionalProperties, false);

windowState = { packageName: 'com.example.notes', detectionReliable: true };
protectedPackages = [];
let result = await toolModule.execute({}, context);
assert.equal(result.success, true);
assert.deepEqual(result.data, {
  packageName: 'com.example.notes',
  protected: false,
});

windowState = { packageName: 'com.example.bank', detectionReliable: true };
protectedPackages = ['com.example.bank'];
result = await toolModule.execute({}, context);
assert.equal(result.success, true);
assert.deepEqual(result.data, {
  packageName: 'com.example.bank',
  protected: true,
});

const systemProtectedPackage = protectedAppsPolicy.SYSTEM_PROTECTED_PACKAGES[0];
windowState = { packageName: systemProtectedPackage, detectionReliable: true };
protectedPackages = protectedAppsPolicy.getEffectiveProtectedPackages([]);
result = await toolModule.execute({}, context);
assert.equal(result.success, true);
assert.deepEqual(result.data, {
  packageName: systemProtectedPackage,
  protected: true,
});

windowState = { packageName: 'COM.EXAMPLE.BANK', detectionReliable: true };
protectedPackages = ['com.example.bank'];
result = await toolModule.execute({}, context);
assert.equal(result.success, true);
assert.equal(result.data.protected, true, 'Protected Apps normalization 必须由共用 policy 生效');

for (const unavailableWindowState of [
  { packageName: null, detectionReliable: true },
  { packageName: 'com.example.notes', detectionReliable: false },
]) {
  windowState = unavailableWindowState;
  result = await toolModule.execute({}, context);
  assert.equal(result.success, false);
  assert.match(result.error, /^foreground_app_unavailable:/u);
  assert.equal(Object.hasOwn(result, 'data'), false, '不可用状态不得返回伪造前台 App');
}

currentHostAiId = 'new-host-ai';
windowReadCount = 0;
result = await toolModule.execute({}, context);
assert.equal(result.success, false);
assert.match(result.error, /^not_current_host:/u);
assert.equal(windowReadCount, 0, '过期主理 AI 不得读取当前窗口事实');

const phoneToolBoundaryFiles = [
  'src/features/phoneTools/aiTools/GetForegroundAppTool.ts',
  'src/features/phoneTools/application/ForegroundAppRuntimeDependencies.ts',
];
for (const relativePath of phoneToolBoundaryFiles) {
  const sourceFile = ts.createSourceFile(
    relativePath,
    read(relativePath),
    ts.ScriptTarget.Latest,
    true,
  );
  const imports = sourceFile.statements
    .filter(ts.isImportDeclaration)
    .map((statement) => statement.moduleSpecifier.text);
  assert.ok(
    imports.every((specifier) => (
      !specifier.includes('screenCapture')
      && !specifier.includes('companion')
      && !specifier.includes('SelfWake')
    )),
    `${relativePath} 不得依赖 Screen Observation、Companion 或 WAKE`,
  );
}

console.log('PHONE-3 foreground app awareness contracts verified.');
