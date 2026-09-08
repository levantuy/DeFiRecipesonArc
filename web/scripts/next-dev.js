const { spawn } = require('node:child_process');

const nextCliEntrypoint = require.resolve('next/dist/bin/next');
const child = spawn(process.execPath, [nextCliEntrypoint, 'dev'], {
  stdio: 'inherit',
  env: { ...process.env, NEXT_DIST_DIR: '.next-dev' },
  shell: false,
});

child.on('exit', (code, signal) => {
  if (typeof code === 'number') {
    process.exit(code);
  }

  process.exit(signal ? 1 : 0);
});