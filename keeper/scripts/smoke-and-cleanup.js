require('dotenv/config');

const { spawnSync } = require('node:child_process');
const path = require('node:path');

function parseBoolean(value, fallback) {
  if (value === undefined || value === null || String(value).trim() === '') {
    return fallback;
  }

  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) {
    return true;
  }
  if (['0', 'false', 'no', 'off'].includes(normalized)) {
    return false;
  }

  throw new Error(`Invalid boolean value: ${value}`);
}

function runNodeScript(scriptName) {
  const scriptPath = path.resolve(__dirname, scriptName);
  const result = spawnSync(process.execPath, [scriptPath], {
    stdio: 'inherit',
    env: process.env,
  });

  if (typeof result.status !== 'number') {
    throw new Error(`Could not execute ${scriptName}.`);
  }

  return result.status;
}

async function main() {
  const runCleanup = parseBoolean(process.env.PIPELINE_RUN_CLEANUP, true);
  const cleanupOnFailure = parseBoolean(process.env.PIPELINE_CLEANUP_ON_FAILURE, true);

  console.log('[pipeline] Running smoke test...');
  const smokeExitCode = runNodeScript('smoke-endpoints.js');

  if (smokeExitCode !== 0) {
    console.error(`[pipeline] Smoke failed with exit code ${smokeExitCode}.`);

    if (runCleanup && cleanupOnFailure) {
      console.log('[pipeline] Running cleanup after smoke failure...');
      const cleanupExitCode = runNodeScript('cleanup-test-data.js');
      if (cleanupExitCode !== 0) {
        console.error(`[pipeline] Cleanup failed with exit code ${cleanupExitCode}.`);
      }
    }

    process.exit(smokeExitCode);
  }

  if (runCleanup) {
    console.log('[pipeline] Running cleanup after successful smoke...');
    const cleanupExitCode = runNodeScript('cleanup-test-data.js');
    if (cleanupExitCode !== 0) {
      console.error(`[pipeline] Cleanup failed with exit code ${cleanupExitCode}.`);
      process.exit(cleanupExitCode);
    }
  } else {
    console.log('[pipeline] Cleanup skipped by configuration.');
  }

  console.log('[pipeline] Smoke + cleanup completed successfully.');
}

main().catch((error) => {
  console.error(`[pipeline] failed: ${error.message}`);
  process.exit(1);
});
