import { downloadAndUnzipVSCode, resolveCliPathFromVSCodeExecutablePath } from '@vscode/test-electron';
import { spawn, type ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const DEFAULT_TEST_VSCODE_VERSION = '1.100.0';
const TEST_TIMEOUT_MS = 120000;

async function main(): Promise<void> {
  const extensionDevelopmentPath = path.resolve(__dirname, '../../');
  const extensionTestsPath = path.resolve(__dirname, './suite/index');
  const testMarkerPath = path.join(os.tmpdir(), `audioplugin-extension-tests-${Date.now()}.txt`);
  const vscodeCliPath = await resolveVsCodeCliPath();
  // 每次运行使用独立的临时 user-data-dir，避免与残留实例争用固定目录导致测试不执行
  const testDataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'audioplugin-vscode-test-'));

  try {
    await runVsCodeCliTests(vscodeCliPath, {
      extensionDevelopmentPath,
      extensionTestsPath,
      testDataRoot,
      extensionTestsEnv: {
        AUDIOPLUGIN_TEST_MARKER: testMarkerPath
      }
    });

    if (!fs.existsSync(testMarkerPath)) {
      throw new Error('VS Code extension tests did not run to completion.');
    }

    const marker = fs.readFileSync(testMarkerPath, 'utf8');
    if (marker !== 'completed') {
      throw new Error(`VS Code extension tests failed: ${marker}`);
    }
  } finally {
    // 调试时设置 AUDIOPLUGIN_TEST_KEEP_TMP=1 可保留临时目录与标记文件
    if (process.env.AUDIOPLUGIN_TEST_KEEP_TMP !== '1') {
      try {
        fs.rmSync(testDataRoot, { recursive: true, force: true });
      } catch {
        // 临时目录清理失败不影响测试结果
      }
      try {
        fs.rmSync(testMarkerPath, { force: true });
      } catch {
        // 标记文件清理失败不影响测试结果
      }
    }
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});

interface CliTestOptions {
  readonly extensionDevelopmentPath: string;
  readonly extensionTestsPath: string;
  readonly testDataRoot: string;
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
  const args = [
    '--new-window',
    '--disable-updates',
    '--skip-welcome',
    '--skip-release-notes',
    '--disable-workspace-trust',
    `--extensionDevelopmentPath=${options.extensionDevelopmentPath}`,
    `--extensionTestsPath=${options.extensionTestsPath}`,
    `--extensions-dir=${path.join(options.extensionDevelopmentPath, '.vscode-test', 'extensions')}`,
    `--user-data-dir=${path.join(options.testDataRoot, 'user-data')}`,
    '--wait'
  ];

  await new Promise<void>((resolve, reject) => {
    const child = spawn(cliPath, args, {
      env: {
        ...process.env,
        ...options.extensionTestsEnv
      },
      shell: process.platform === 'win32',
      // 让子进程拥有独立进程组，便于测试结束后强制终止整个 VS Code 进程树
      detached: process.platform !== 'win32',
      stdio: 'ignore'
    });
    const timeout = setTimeout(() => {
      terminateChildProcessTree(child);
      reject(new Error(`VS Code extension tests timed out after ${TEST_TIMEOUT_MS / 1000} seconds.`));
    }, TEST_TIMEOUT_MS);

    // 测试标记一写入即说明测试已结束，立即终止进程树，
    // 避免 VS Code 窗口在失败后不关闭导致测试进程一直挂起
    const markerPoll = setInterval(() => {
      if (fs.existsSync(options.extensionTestsEnv.AUDIOPLUGIN_TEST_MARKER)) {
        clearInterval(markerPoll);
        clearTimeout(timeout);
        terminateChildProcessTree(child);
        resolve();
      }
    }, 250);

    child.on('error', error => {
      clearInterval(markerPoll);
      clearTimeout(timeout);
      reject(error);
    });
    child.on('close', code => {
      clearInterval(markerPoll);
      clearTimeout(timeout);
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`VS Code extension tests failed with exit code ${code ?? 'unknown'}.`));
      }
    });
  });
}

function terminateChildProcessTree(child: ChildProcess): void {
  if (!child.pid) {
    return;
  }

  try {
    if (process.platform === 'win32') {
      child.kill();
    } else {
      process.kill(-child.pid, 'SIGTERM');
    }
  } catch {
    // 进程可能已自行退出
  }
}
