/** PHONE-8D3A：Phone Tools 网易云播放产品能力行为与边界验证。 */

import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relativePath) => fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
const stripComments = (source) => source
  .replace(/\/\*[\s\S]*?\*\//gu, '')
  .replace(/\/\/[^\n]*/gu, '');

const require = createRequire(import.meta.url);
const ts = require('typescript');

function loadTypeScriptModule(relativePath, mocks = {}) {
  const sourcePath = path.join(repoRoot, relativePath);
  const compiled = ts.transpileModule(read(relativePath), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: sourcePath,
    reportDiagnostics: true,
  });
  const errors = (compiled.diagnostics ?? []).filter(
    (diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error,
  );
  assert.deepEqual(errors, [], `${relativePath} 无法编译`);

  const module = { exports: {} };
  const requireMock = (specifier) => {
    assert.ok(Object.hasOwn(mocks, specifier), `${relativePath} 存在未声明的依赖：${specifier}`);
    return mocks[specifier];
  };
  new Function('exports', 'require', 'module', compiled.outputText)(
    module.exports,
    requireMock,
    module,
  );
  return module.exports;
}

const runtimeSlotMock = {
  '@shared/runtime/RuntimeSlot': {
    createRuntimeSlot: (name) => {
      let value = null;
      return {
        configure(nextValue) {
          value = nextValue;
        },
        get() {
          if (value === null) {
            throw new Error(`${name} 运行时依赖尚未完成装配`);
          }
          return value;
        },
      };
    },
  },
};

const routeModule = loadTypeScriptModule(
  'src/features/phoneTools/application/NetEaseExactSongRoute.ts',
);
const policyModule = loadTypeScriptModule(
  'src/features/phoneTools/application/ProtectedAppsPolicy.ts',
);
const runtimeModule = loadTypeScriptModule(
  'src/features/phoneTools/application/NetEasePlaybackRuntimeDependencies.ts',
  runtimeSlotMock,
);

let protectedPackages = [];
const admissionCalls = [];
const policyWithTrace = {
  ...policyModule,
  assertProtectedAppCapabilityAllowed(packageName, packages, capabilityKind) {
    admissionCalls.push({ packageName, packages: [...packages], capabilityKind });
    return policyModule.assertProtectedAppCapabilityAllowed(packageName, packages, capabilityKind);
  },
};

const snapshot = {
  packageName: routeModule.NETEASE_MUSIC_PACKAGE,
  playback: {
    state: 'playing',
    positionMs: 1234,
    speed: 1,
    updatedAtEpochMs: 1700000000000,
  },
  metadata: {
    mediaId: 'track-1',
    title: '彼此',
    artist: '灯诱LampLure',
    album: '彼此',
    durationMs: 234000,
  },
  actions: {
    play: true,
    pause: true,
    playPause: true,
    stop: true,
    next: true,
    previous: true,
    seekTo: true,
    playFromMediaId: false,
    playFromSearch: false,
    playFromUri: false,
    prepare: false,
    prepareFromMediaId: false,
    prepareFromSearch: false,
    prepareFromUri: false,
  },
};

let snapshotOutcome = { status: 'session_snapshot_available', snapshot };
let commandOutcome = null;
const snapshotCalls = [];
const commandCalls = [];

runtimeModule.configureNetEasePlaybackRuntimeDependencies({
  async getMediaSessionSnapshot(packageName) {
    snapshotCalls.push(packageName);
    return snapshotOutcome;
  },
  async dispatchMediaSessionCommand(packageName, command) {
    commandCalls.push({ packageName, command });
    return commandOutcome ?? { status: 'command_dispatched', packageName, command };
  },
});

const capabilityModule = loadTypeScriptModule(
  'src/features/phoneTools/application/NetEasePlayback.ts',
  {
    './CurrentProtectedAppsPolicy': {
      loadCurrentProtectedPackages: async () => protectedPackages,
    },
    './NetEaseExactSongRoute': routeModule,
    './NetEasePlaybackRuntimeDependencies': runtimeModule,
    './ProtectedAppsPolicy': policyWithTrace,
  },
);

const {
  controlNetEasePlayback,
  getNetEasePlaybackSnapshot,
  NetEasePlaybackContractError,
  NetEasePlaybackError,
} = capabilityModule;
const targetPackage = routeModule.NETEASE_MUSIC_PACKAGE;

function reset() {
  protectedPackages = [];
  admissionCalls.length = 0;
  snapshotCalls.length = 0;
  commandCalls.length = 0;
  snapshotOutcome = { status: 'session_snapshot_available', snapshot };
  commandOutcome = null;
}

// observation 成功：先以 observation 准入，再以固定 package 读取并原样保留稳定事实字段。
reset();
assert.deepEqual(await getNetEasePlaybackSnapshot(), {
  status: 'playback_snapshot_available',
  targetPackage,
  snapshot: {
    playback: snapshot.playback,
    metadata: snapshot.metadata,
    actions: snapshot.actions,
  },
});
assert.deepEqual(admissionCalls, [{
  packageName: targetPackage,
  packages: [],
  capabilityKind: 'observation',
}]);
assert.deepEqual(snapshotCalls, [targetPackage]);

// observation protected：policy 在 primitive 前拒绝，native read 次数保持 0。
reset();
protectedPackages = [targetPackage];
await assert.rejects(
  () => getNetEasePlaybackSnapshot(),
  (error) => error instanceof NetEasePlaybackError && error.reason === 'protected_app',
);
assert.equal(snapshotCalls.length, 0);
assert.equal(admissionCalls[0].capabilityKind, 'observation');

for (const outcome of [
  { status: 'permission_not_granted', expectedReason: 'permission_not_granted' },
  { status: 'no_active_session', packageName: targetPackage, expectedReason: 'no_active_session' },
  { status: 'snapshot_failed', reason: 'reader exploded', expectedReason: 'snapshot_failed' },
]) {
  reset();
  const { expectedReason, ...result } = outcome;
  snapshotOutcome = result;
  await assert.rejects(
    () => getNetEasePlaybackSnapshot(),
    (error) => (
      error instanceof NetEasePlaybackError
      && error.reason === expectedReason
      && (expectedReason !== 'snapshot_failed' || error.message.includes('reader exploded'))
    ),
  );
  assert.equal(snapshotCalls.length, 1);
}

reset();
snapshotOutcome = { status: 'invalid_package_name', reason: 'invalid package' };
await assert.rejects(
  () => getNetEasePlaybackSnapshot(),
  (error) => (
    error instanceof NetEasePlaybackContractError
    && error.reason === 'invalid_package_name'
    && !(error instanceof NetEasePlaybackError)
  ),
);

// control：四个 command 均以 action 准入并不变地派发给固定 package。
for (const command of ['pause', 'resume', 'next', 'previous']) {
  reset();
  assert.deepEqual(await controlNetEasePlayback(command), {
    status: 'playback_command_dispatched',
    targetPackage,
    command,
  });
  assert.deepEqual(admissionCalls, [{
    packageName: targetPackage,
    packages: [],
    capabilityKind: 'action',
  }]);
  assert.deepEqual(commandCalls, [{ packageName: targetPackage, command }]);
  assert.equal(snapshotCalls.length, 0, 'command success 不得自动读取 snapshot 验证');
}

// control protected：policy 在 dispatch 前拒绝。
reset();
protectedPackages = [targetPackage];
await assert.rejects(
  () => controlNetEasePlayback('pause'),
  (error) => error instanceof NetEasePlaybackError && error.reason === 'protected_app',
);
assert.equal(commandCalls.length, 0);
assert.equal(admissionCalls[0].capabilityKind, 'action');

for (const outcome of [
  { status: 'permission_not_granted', expectedReason: 'permission_not_granted' },
  { status: 'no_active_session', packageName: targetPackage, expectedReason: 'no_active_session' },
  {
    status: 'action_not_supported',
    packageName: targetPackage,
    command: 'next',
    expectedReason: 'action_not_supported',
  },
  {
    status: 'dispatch_failed',
    packageName: targetPackage,
    command: 'next',
    reason: 'transport exploded',
    expectedReason: 'dispatch_failed',
  },
]) {
  reset();
  const { expectedReason, ...result } = outcome;
  commandOutcome = result;
  await assert.rejects(
    () => controlNetEasePlayback('next'),
    (error) => (
      error instanceof NetEasePlaybackError
      && error.reason === expectedReason
      && (expectedReason !== 'dispatch_failed' || error.message.includes('transport exploded'))
    ),
  );
  assert.equal(commandCalls.length, 1);
  assert.equal(snapshotCalls.length, 0);
}

for (const invariantReason of ['invalid_package_name', 'invalid_command']) {
  reset();
  commandOutcome = { status: invariantReason, reason: `injected ${invariantReason}` };
  await assert.rejects(
    () => controlNetEasePlayback('pause'),
    (error) => (
      error instanceof NetEasePlaybackContractError
      && error.reason === invariantReason
      && !(error instanceof NetEasePlaybackError)
    ),
  );
}

// 静态边界只锁长期架构契约；核心映射与调用顺序已由上面的行为测试覆盖。
const runtimeSource = stripComments(read(
  'src/features/phoneTools/application/NetEasePlaybackRuntimeDependencies.ts',
));
const capabilitySource = stripComments(read(
  'src/features/phoneTools/application/NetEasePlayback.ts',
));
const phoneToolsSource = fs.readdirSync(
  path.join(repoRoot, 'src/features/phoneTools'),
  { recursive: true, withFileTypes: true },
).filter((entry) => entry.isFile() && /\.tsx?$/u.test(entry.name))
  .map((entry) => stripComments(fs.readFileSync(path.join(entry.parentPath, entry.name), 'utf8')))
  .join('\n');

assert.match(
  runtimeSource,
  /NetEasePlaybackCommand = 'pause' \| 'resume' \| 'next' \| 'previous'/u,
  '产品 command union 必须恰好是四个 command',
);
assert.doesNotMatch(
  phoneToolsSource,
  /@features\/deviceControl|modules\/device-control|MediaSessionManager|MediaController|NotificationListenerService/u,
  'Phone Tools production source 不得静态依赖 Device Control 或 Android MediaSession 实现',
);
assert.doesNotMatch(
  capabilitySource,
  /setTimeout|setInterval|sleep|delay\(|while \(|AudioManager|KEYCODE_MEDIA_|dispatchBrowsableUri|playFrom|prepareFrom|seekTo/u,
  '产品 capability 不得 polling、fallback、后台点歌或 seek',
);

const hostSource = stripComments(read('src/host/composition/configurePhoneToolsRuntime.ts'));
assert.match(hostSource, /configureNetEasePlaybackRuntimeDependencies/u);
assert.match(hostSource, /getMediaSessionSnapshot/u);
assert.match(hostSource, /dispatchMediaSessionCommand/u);
assert.doesNotMatch(hostSource, /NETEASE_MUSIC_PACKAGE|protected_app|action_not_supported/u);

const catalogSource = stripComments(read(
  'src/features/phoneTools/toolPackages/ToolPackageCatalog.ts',
));
assert.deepEqual(
  [...catalogSource.matchAll(/toolName: '(netease_[a-z_]+)'/gu)].map((match) => match[1]),
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
  'NetEase package 必须暴露八个 child Tool',
);
const registrySource = stripComments(read(
  'src/host/composition/agent/createAgentToolRegistry.ts',
));
assert.doesNotMatch(
  `${catalogSource}\n${registrySource}`,
  /netease_(pause|resume|next|previous)|media_control/u,
  '播放控制不得拆成 transport Tool 或 generic media Tool',
);

assert.equal(
  routeModule.buildNetEaseExactSongUri(2657785221),
  'orpheus://song/2657785221?thirdfrom=push',
  'exact-song route 不得改变',
);
assert.equal(
  (phoneToolsSource.match(/com\.netease\.cloudmusic/gu) ?? []).length,
  1,
  '网易云 package 字面量必须只有 NetEaseExactSongRoute 一份真值',
);

console.log('PHONE-8D3A 网易云播放产品能力验证通过。');
