const { spawn } = require('child_process');
const path = require('path');
const { findVsCodeCli } = require('./vscodePaths');

const cliPath = findVsCodeCli();
if (!cliPath) {
  console.error('Could not find the VS Code CLI. Set VSCODE_CLI_PATH to your code executable and run npm run dev:open again.');
  process.exit(1);
}

const workspaceRoot = path.resolve(__dirname, '..');
const child = spawn(cliPath, [
  '--new-window',
  `--extensionDevelopmentPath=${workspaceRoot}`,
  workspaceRoot
], {
  stdio: 'inherit'
});

child.on('exit', code => {
  process.exit(code ?? 0);
});
