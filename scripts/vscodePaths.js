const fs = require('fs');
const path = require('path');

function findVsCodeCli() {
  if (process.env.VSCODE_TEST_CLI_PATH && fs.existsSync(process.env.VSCODE_TEST_CLI_PATH)) {
    return process.env.VSCODE_TEST_CLI_PATH;
  }

  if (process.env.VSCODE_CLI_PATH && fs.existsSync(process.env.VSCODE_CLI_PATH)) {
    return process.env.VSCODE_CLI_PATH;
  }

  const candidates = process.platform === 'darwin'
    ? ['/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code']
    : process.platform === 'win32'
      ? [
          process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs', 'Microsoft VS Code', 'bin', 'code.cmd'),
          process.env.ProgramFiles && path.join(process.env.ProgramFiles, 'Microsoft VS Code', 'bin', 'code.cmd')
        ].filter(Boolean)
      : ['/usr/local/bin/code', '/usr/bin/code', '/snap/bin/code'];

  return candidates.find(candidate => fs.existsSync(candidate));
}

module.exports = {
  findVsCodeCli
};
