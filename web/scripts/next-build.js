const { spawnSync } = require('node:child_process');
const { rmSync, existsSync } = require('node:fs');
const { join } = require('node:path');

const projectRoot = process.cwd();
const nextDir = join(projectRoot, '.next');

if (existsSync(nextDir)) {
  // Force clean build artifacts to avoid partial/chunk-missing manifests on Windows.
  rmSync(nextDir, { recursive: true, force: true });
}

const env = { ...process.env };
const nodeMajor = Number.parseInt(process.versions.node.split('.')[0], 10);

// Next 14 build workers can be unstable on Windows + newer Node runtimes.
if (process.platform === 'win32' && nodeMajor >= 24 && !env.NEXT_DISABLE_BUILD_WORKER) {
  env.NEXT_DISABLE_BUILD_WORKER = '1';
}

const nextCliEntrypoint = require.resolve('next/dist/bin/next');
const result = spawnSync(process.execPath, [nextCliEntrypoint, 'build'], {
  stdio: 'inherit',
  env,
  shell: false,
});

if (result.error) {
  console.error('[next-build wrapper] Failed to start next build:', result.error.message);
  process.exit(1);
}

if (typeof result.status === 'number') {
  process.exit(result.status);
}

if (result.signal) {
  console.error(`[next-build wrapper] next build terminated by signal: ${result.signal}`);
}

process.exit(1);
