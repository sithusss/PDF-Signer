const { spawn } = require('child_process');

const npmCmd = 'npm';

const frontend = spawn(npmCmd, ['--prefix', 'frontend', 'run', 'dev'], {
  stdio: 'inherit',
  shell: true,
});

const backend = spawn(npmCmd, ['--prefix', 'backend', 'run', 'dev'], {
  stdio: 'inherit',
  shell: true,
});

const shutdown = (code = 0) => {
  if (!frontend.killed) frontend.kill();
  if (!backend.killed) backend.kill();
  process.exit(code);
};

frontend.on('exit', (code) => shutdown(code ?? 0));
backend.on('exit', (code) => shutdown(code ?? 0));

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));
