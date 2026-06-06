import { spawn } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { downloadAndUnzipVSCode, resolveCliPathFromVSCodeExecutablePath } from '@vscode/test-electron';

const DEFAULT_TEST_VSCODE_VERSION = '1.100.0';
const TEST_TIMEOUT_MS = 60000;

async function main(): Promise<void> {
  const extensionDevelopmentPath = path.resolve(__dirname, '../../');
  const extensionTestsPath = path.resolve(__dirname, './suite/index');
  const testMarkerPath = path.join(os.tmpdir(), `minimax-tts-extension-tests-${Date.now()}.txt`);
  const vscodeCliPath = await resolveVsCodeCliPath();

  await runVsCodeCliTests(vscodeCliPath, {
    extensionDevelopmentPath,
    extensionTestsPath,
    extensionTestsEnv: {
      MINIMAX_TTS_TEST_MARKER: testMarkerPath
    }
  });

  if (!fs.existsSync(testMarkerPath) || fs.readFileSync(testMarkerPath, 'utf8') !== 'completed') {
    throw new Error('VS Code extension tests did not run to completion.');
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});

interface CliTestOptions {
  readonly extensionDevelopmentPath: string;
  readonly extensionTestsPath: string;
  readonly extensionTestsEnv: Record<string, string>;
}

async function resolveVsCodeCliPath(): Promise<string> {
  const installedCliPath = findInstalledVsCodeCli();
  if (installedCliPath) {
    return installedCliPath;
  }

  const downloadedExecutablePath = await downloadAndUnzipVSCode(process.env.VSCODE_TEST_VERSION ?? DEFAULT_TEST_VSCODE_VERSION);
  return resolveCliPathFromVSCodeExecutablePath(downloadedExecutablePath);
}

function findInstalledVsCodeCli(): string | undefined {
  if (process.env.VSCODE_TEST_CLI_PATH && fs.existsSync(process.env.VSCODE_TEST_CLI_PATH)) {
    return process.env.VSCODE_TEST_CLI_PATH;
  }

  if (process.env.VSCODE_EXECUTABLE_PATH && fs.existsSync(process.env.VSCODE_EXECUTABLE_PATH)) {
    return resolveCliPathFromVSCodeExecutablePath(process.env.VSCODE_EXECUTABLE_PATH);
  }

  const candidates = getInstalledVsCodeCliCandidates();

  return candidates.find(candidate => fs.existsSync(candidate));
}

function getInstalledVsCodeCliCandidates(): string[] {
  if (process.platform === 'darwin') {
    return [
      '/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code'
    ];
  }

  if (process.platform === 'win32') {
    return [
      process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Programs', 'Microsoft VS Code', 'bin', 'code.cmd') : undefined,
      process.env.ProgramFiles ? path.join(process.env.ProgramFiles, 'Microsoft VS Code', 'bin', 'code.cmd') : undefined
    ].filter((candidate): candidate is string => Boolean(candidate));
  }

  return [
    '/usr/local/bin/code',
    '/usr/bin/code',
    '/snap/bin/code'
  ];
}

async function runVsCodeCliTests(cliPath: string, options: CliTestOptions): Promise<void> {
  const testDataRoot = path.join(options.extensionDevelopmentPath, '.vscode-test');
  const args = [
    '--new-window',
    '--disable-updates',
    '--skip-welcome',
    '--skip-release-notes',
    '--disable-workspace-trust',
    `--extensionDevelopmentPath=${options.extensionDevelopmentPath}`,
    `--extensionTestsPath=${options.extensionTestsPath}`,
    `--extensions-dir=${path.join(testDataRoot, 'extensions')}`,
    `--user-data-dir=${path.join(testDataRoot, 'user-data')}`,
    '--wait'
  ];

  await new Promise<void>((resolve, reject) => {
    const child = spawn(cliPath, args, {
      env: {
        ...process.env,
        ...options.extensionTestsEnv
      },
      shell: process.platform === 'win32'
    });
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error(`VS Code extension tests timed out after ${TEST_TIMEOUT_MS / 1000} seconds.`));
    }, TEST_TIMEOUT_MS);

    child.stdout.on('data', data => process.stdout.write(data));
    child.stderr.on('data', data => process.stderr.write(data));
    child.on('error', error => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on('close', code => {
      clearTimeout(timeout);
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`VS Code extension tests failed with exit code ${code ?? 'unknown'}.`));
      }
    });
  });
}
