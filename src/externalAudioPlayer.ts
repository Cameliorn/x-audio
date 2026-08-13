import { execFile, spawn, type ChildProcess } from 'child_process';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as http from 'http';
import type { AddressInfo } from 'net';
import * as path from 'path';
import { promisify } from 'util';
import * as vscode from 'vscode';
import { getTtsConfig } from './config';
import { fileExists } from './fileUtils';
import { t } from './i18n';
import { getAudioMime, getPlayerPage } from './playerPage';
import { TtsAudioFile } from './ttsService';

const execFileAsync = promisify(execFile);

const BROWSER_REUSE_WINDOW_MS = 15000;
/** 播放结束/停止/窗口消失后，空闲超过该时长即回收浏览器与本地服务器 */
const IDLE_CLEANUP_MS = 5 * 60 * 1000;
const IDLE_CHECK_INTERVAL_MS = 60 * 1000;
/** 非 file 协议音频的最大读入体积（file 协议走流式读取，无此限制） */
const MAX_NON_FILE_AUDIO_BYTES = 64 * 1024 * 1024;

function forceKillProcess(child: ChildProcess): void {
  if (child.pid && child.exitCode === null) {
    try {
      // SIGKILL is not supported on Windows; SIGTERM + eventual fallback are fine
      if (process.platform === 'win32') {
        process.kill(child.pid, 'SIGTERM');
      } else {
        process.kill(child.pid, 'SIGKILL');
      }
    } catch {
      // process may have already exited
    }
  }
}

interface ChromiumApp {
  readonly name: string;
  readonly executablePaths: readonly string[];
}

function getChromiumApps(): ChromiumApp[] {
  const platform = process.platform;

  if (platform === 'darwin') {
    return [
      {
        name: 'Google Chrome',
        executablePaths: [
          '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
          `${process.env.HOME ?? ''}/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`
        ]
      },
      {
        name: 'Microsoft Edge',
        executablePaths: [
          '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
          `${process.env.HOME ?? ''}/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge`
        ]
      },
      {
        name: 'Brave Browser',
        executablePaths: [
          '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
          `${process.env.HOME ?? ''}/Applications/Brave Browser.app/Contents/MacOS/Brave Browser`
        ]
      },
      {
        name: 'Chromium',
        executablePaths: [
          '/Applications/Chromium.app/Contents/MacOS/Chromium',
          `${process.env.HOME ?? ''}/Applications/Chromium.app/Contents/MacOS/Chromium`
        ]
      },
      {
        name: 'Vivaldi',
        executablePaths: [
          '/Applications/Vivaldi.app/Contents/MacOS/Vivaldi',
          `${process.env.HOME ?? ''}/Applications/Vivaldi.app/Contents/MacOS/Vivaldi`
        ]
      }
    ];
  }

  if (platform === 'win32') {
    const programFiles = process.env['ProgramFiles'] ?? 'C:\\Program Files';
    const programFilesX86 = process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)';
    const localAppData = process.env['LOCALAPPDATA'] ?? '';

    return [
      {
        name: 'Google Chrome',
        executablePaths: [
          path.join(programFiles, 'Google\\Chrome\\Application\\chrome.exe'),
          path.join(programFilesX86, 'Google\\Chrome\\Application\\chrome.exe'),
          path.join(localAppData, 'Google\\Chrome\\Application\\chrome.exe')
        ]
      },
      {
        name: 'Microsoft Edge',
        executablePaths: [
          path.join(programFiles, 'Microsoft\\Edge\\Application\\msedge.exe'),
          path.join(programFilesX86, 'Microsoft\\Edge\\Application\\msedge.exe')
        ]
      },
      {
        name: 'Brave Browser',
        executablePaths: [
          path.join(programFiles, 'BraveSoftware\\Brave-Browser\\Application\\brave.exe'),
          path.join(programFilesX86, 'BraveSoftware\\Brave-Browser\\Application\\brave.exe')
        ]
      }
    ];
  }

  // linux
  return [
    {
      name: 'Google Chrome',
      executablePaths: ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/opt/google/chrome/chrome', '/snap/bin/chromium']
    },
    {
      name: 'Microsoft Edge',
      executablePaths: ['/usr/bin/microsoft-edge', '/opt/microsoft/msedge/msedge']
    },
    {
      name: 'Chromium',
      executablePaths: ['/usr/bin/chromium', '/usr/bin/chromium-browser', '/snap/bin/chromium']
    },
    {
      name: 'Brave Browser',
      executablePaths: ['/usr/bin/brave-browser', '/opt/brave.com/brave/brave']
    }
  ];
}

/** 播放状态：active 表示有播放任务，paused 表示已暂停 */
export interface PlaybackState {
  readonly active: boolean;
  readonly paused: boolean;
}

export class AudioPlayerPanel {
  private readonly browserProfileRoot: vscode.Uri;
  private server: http.Server | undefined;
  private serverUrl: string | undefined;
  private readonly routeToken = crypto.randomBytes(16).toString('hex');
  private readonly html: string;
  private readonly contentSecurityPolicy: string;
  private version = 0;
  private readonly pageGen = Date.now();
  private queue: readonly TtsAudioFile[] = [];
  private browserChild: ChildProcess | undefined;
  private pendingCommand: 'pause' | 'resume' | 'stop' | undefined;
  private isPaused = false;
  private browserActive = false;
  private browserUntracked = false;
  private browserProfilePath = '';
  private profileCounter = 0;
  private profileRootReady = false;
  private lastBrowserHeartbeat = 0;
  private lastActivity = 0;
  private idleCheckTimer: ReturnType<typeof setInterval> | undefined;
  private readonly onDidChangePlaybackStateEmitter = new vscode.EventEmitter<PlaybackState>();

  /** 播放状态变化（开始/暂停/恢复/停止），供状态栏等 UI 订阅 */
  public readonly onDidChangePlaybackState = this.onDidChangePlaybackStateEmitter.event;

  public constructor(
    context: vscode.ExtensionContext
  ) {
    this.browserProfileRoot = vscode.Uri.joinPath(context.globalStorageUri, 'browser-profile');
    const page = getPlayerPage(this.pageGen);
    this.html = page.html;
    this.contentSecurityPolicy = page.contentSecurityPolicy;
  }

  public async play(audioFile: TtsAudioFile): Promise<void> {
    await this.playQueue([audioFile]);
  }

  public async playQueue(files: readonly TtsAudioFile[]): Promise<void> {
    if (files.length === 0) {
      return;
    }

    this.queue = files;
    this.version++;
    this.isPaused = false;
    this.pendingCommand = undefined;
    this.browserActive = true;
    this.lastActivity = Date.now();
    this.onDidChangePlaybackStateEmitter.fire({ active: true, paused: false });
    if (!this.profileRootReady) {
      await vscode.workspace.fs.createDirectory(this.browserProfileRoot);
      this.profileRootReady = true;
    }
    const url = await this.ensureServerUrl();
    this.ensureIdleCheckTimer();

    // 浏览器窗口仍在线时直接复用，页面轮询 version 端点会自动加载新队列
    if (this.canReuseBrowser()) {
      return;
    }

    if (this.browserChild && this.browserChild.exitCode === null) {
      forceKillProcess(this.browserChild);
    }
    this.browserChild = undefined;

    // 每次启动轮换 profile 目录，避免上一个被强杀的进程留下锁文件导致启动失败
    this.browserProfilePath = path.join(this.browserProfileRoot.fsPath, `session-${Date.now()}-${this.profileCounter++}`);
    await cleanupBrowserProfileDirs(this.browserProfileRoot, this.browserProfilePath);
    this.browserUntracked = !await launchBrowserWindow(url, this.browserProfileRoot.fsPath, this.browserProfilePath,
      (child, profilePath) => {
        this.browserChild = child;
        this.browserProfilePath = profilePath || this.browserProfilePath;
      });
  }

  public pause(): void {
    if (!this.browserActive) {
      vscode.window.showInformationMessage(t('player.noActivePlayback'));
      return;
    }

    if (this.isPaused) {
      this.isPaused = false;
      this.pendingCommand = 'resume';
      vscode.window.showInformationMessage(t('player.resumeInfo'));
    } else {
      this.isPaused = true;
      this.pendingCommand = 'pause';
      vscode.window.showInformationMessage(t('player.pauseInfo'));
    }
    this.onDidChangePlaybackStateEmitter.fire({ active: true, paused: this.isPaused });
  }

  public stop(): void {
    this.isPaused = false;
    this.browserActive = false;
    this.pendingCommand = 'stop';
    this.queue = [];
    this.lastActivity = Date.now();
    if (this.browserChild && this.browserChild.exitCode === null) {
      forceKillProcess(this.browserChild);
    } else if (this.browserUntracked) {
      // 通过 open/openExternal 回退打开的窗口无法被终止，提示用户手动关闭
      vscode.window.showInformationMessage(t('player.closeWindowManually'));
    }
    this.browserChild = undefined;
    this.browserUntracked = false;
    this.onDidChangePlaybackStateEmitter.fire({ active: false, paused: false });
    vscode.window.showInformationMessage(t('player.stopInfo'));
  }

  public dispose(): void {
    if (this.idleCheckTimer !== undefined) {
      clearInterval(this.idleCheckTimer);
      this.idleCheckTimer = undefined;
    }
    this.onDidChangePlaybackStateEmitter.fire({ active: false, paused: false });
    this.onDidChangePlaybackStateEmitter.dispose();
    this.server?.close();
    this.server = undefined;
    this.serverUrl = undefined;
    if (this.browserChild && this.browserChild.exitCode === null) {
      this.browserChild.kill();
    }
    this.browserChild = undefined;
    void deleteBrowserProfile(this.browserProfilePath);
  }

  private canReuseBrowser(): boolean {
    return Boolean(
      !this.browserUntracked &&
      this.browserChild &&
      this.browserChild.exitCode === null &&
      this.lastBrowserHeartbeat > 0 &&
      Date.now() - this.lastBrowserHeartbeat < BROWSER_REUSE_WINDOW_MS
    );
  }

  /** 播放空闲超过 IDLE_CLEANUP_MS 后回收浏览器与本地服务器，避免常驻占用资源 */
  private ensureIdleCheckTimer(): void {
    if (this.idleCheckTimer !== undefined) {
      return;
    }

    this.idleCheckTimer = setInterval(() => {
      const now = Date.now();
      // 心跳长期消失说明窗口已关闭；停止播放后长时间无新播放也应回收
      const windowGone = this.lastBrowserHeartbeat > 0 && now - this.lastBrowserHeartbeat > IDLE_CLEANUP_MS;
      const stoppedAndIdle = !this.browserActive && now - this.lastActivity > IDLE_CLEANUP_MS;
      if (!windowGone && !stoppedAndIdle) {
        return;
      }

      if (this.browserChild && this.browserChild.exitCode === null) {
        forceKillProcess(this.browserChild);
      }
      this.browserChild = undefined;
      this.browserUntracked = false;
      if (this.browserActive) {
        this.browserActive = false;
        this.onDidChangePlaybackStateEmitter.fire({ active: false, paused: false });
      }
      this.server?.close();
      this.server = undefined;
      this.serverUrl = undefined;
      void deleteBrowserProfile(this.browserProfilePath);
      if (this.idleCheckTimer !== undefined) {
        clearInterval(this.idleCheckTimer);
        this.idleCheckTimer = undefined;
      }
    }, IDLE_CHECK_INTERVAL_MS);
  }

  private async ensureServerUrl(): Promise<string> {
    if (this.serverUrl) {
      return this.serverUrl;
    }

    this.server = http.createServer((request, response) => {
      void this.handleRequest(request, response).catch(() => {
        if (!response.headersSent) {
          response.writeHead(500);
        }
        response.end();
      });
    });

    const port = await new Promise<number>((resolve, reject) => {
      const onError = (error: Error): void => reject(error);
      this.server?.once('error', onError);
      this.server?.listen(0, '127.0.0.1', () => {
        this.server?.off('error', onError);
        const address = this.server?.address();
        if (address && typeof address !== 'string') {
          resolve((address as AddressInfo).port);
          return;
        }

        reject(new Error(t('player.serverStartFailed')));
      });
    });

    this.serverUrl = `http://127.0.0.1:${port}/${this.routeToken}`;
    return this.serverUrl;
  }

  private async handleRequest(request: http.IncomingMessage, response: http.ServerResponse): Promise<void> {
    const requestUrl = new URL(request.url ?? '/', 'http://127.0.0.1');

    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.writeHead(405, {
        Allow: 'GET, HEAD'
      });
      response.end();
      return;
    }

    // 版本号端点，供页面轮询检测更新
    if (requestUrl.pathname === `/${this.routeToken}/version`) {
      this.lastBrowserHeartbeat = Date.now();
      const command = this.pendingCommand;
      this.pendingCommand = undefined;
      response.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store'
      });
      response.end(JSON.stringify({ version: this.version, count: this.queue.length, pageGen: this.pageGen, command }));
      return;
    }

    if (requestUrl.pathname === `/${this.routeToken}/audio`) {
      const indexParam = Number.parseInt(requestUrl.searchParams.get('index') ?? '', 10);
      const index = Number.isInteger(indexParam) && indexParam >= 0 ? indexParam : 0;
      await this.serveAudio(request, response, index);
      return;
    }

    if (requestUrl.pathname !== `/${this.routeToken}`) {
      response.writeHead(requestUrl.pathname === '/favicon.ico' ? 204 : 404);
      response.end();
      return;
    }

    response.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'Content-Security-Policy': this.contentSecurityPolicy,
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff'
    });
    response.end(request.method === 'HEAD' ? undefined : this.html);
  }

  private async serveAudio(request: http.IncomingMessage, response: http.ServerResponse, index: number): Promise<void> {
    const audioFile = this.queue[index];
    if (!audioFile) {
      response.writeHead(404);
      response.end();
      return;
    }

    const headers = {
      'Content-Type': getAudioMime(audioFile.format),
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff'
    };

    if (audioFile.uri.scheme !== 'file') {
      const audioBytes = await vscode.workspace.fs.readFile(audioFile.uri);
      if (audioBytes.byteLength > MAX_NON_FILE_AUDIO_BYTES) {
        response.writeHead(413);
        response.end();
        return;
      }
      response.writeHead(200, {
        ...headers,
        'Content-Length': audioBytes.byteLength
      });
      response.end(request.method === 'HEAD' ? undefined : audioBytes);
      return;
    }

    const stat = await fs.promises.stat(audioFile.uri.fsPath);
    response.writeHead(200, {
      ...headers,
      'Content-Length': stat.size
    });

    if (request.method === 'HEAD') {
      response.end();
      return;
    }

    await new Promise<void>((resolve, reject) => {
      const stream = fs.createReadStream(audioFile.uri.fsPath);
      stream.once('error', reject);
      response.once('finish', resolve);
      response.once('close', resolve);
      stream.pipe(response);
    });
  }
}

export async function cleanupBrowserProfileDirs(profileRoot: vscode.Uri, keepPath: string): Promise<void> {
  if (!keepPath) {
    return;
  }

  try {
    const entries = await vscode.workspace.fs.readDirectory(profileRoot);
    const keepUri = vscode.Uri.file(keepPath).toString();
    for (const [name, type] of entries) {
      if (type !== vscode.FileType.Directory) {
        continue;
      }

      const dir = vscode.Uri.joinPath(profileRoot, name);
      if (dir.toString() === keepUri) {
        continue;
      }

      try {
        await vscode.workspace.fs.delete(dir, {
          recursive: true,
          useTrash: false
        });
      } catch {
        // 单个旧 profile 清理失败不阻塞
      }
    }
  } catch {
    // profile 根目录可能不存在
  }
}

async function deleteBrowserProfile(profilePath: string): Promise<void> {
  if (!profilePath) {
    return;
  }

  try {
    await vscode.workspace.fs.delete(vscode.Uri.file(profilePath), {
      recursive: true,
      useTrash: false
    });
  } catch {
    // profile 可能不存在
  }
}

/** 返回 true 表示成功 spawn 了可跟踪的浏览器进程；false 表示回退到系统 open，进程不可跟踪 */
async function launchBrowserWindow(
  url: string,
  browserProfileRoot: string,
  existingProfilePath: string,
  onLaunch: (child: ChildProcess, profilePath: string) => void
): Promise<boolean> {
  // 用户手动指定的浏览器路径
  const config = getTtsConfig();
  if (config.browserPath.trim().length > 0) {
    const result = await tryLaunchChromiumExecutable(config.browserPath.trim(), url, browserProfileRoot, existingProfilePath);
    if (result) {
      onLaunch(result.child, result.profilePath);
      return true;
    }
  }

  if (process.platform === 'darwin') {
    return launchOnMac(url, browserProfileRoot, existingProfilePath, onLaunch);
  }

  // Windows / Linux: 尝试直接启动 Chromium 浏览器
  const apps = getChromiumApps();
  for (const app of apps) {
    const result = await tryLaunchChromiumApp(app, url, browserProfileRoot, existingProfilePath);
    if (result) {
      onLaunch(result.child, result.profilePath);
      return true;
    }
  }

  if (await vscode.env.openExternal(vscode.Uri.parse(url))) {
    return false;
  }

  throw new Error(t('player.openFailed'));
}

async function launchOnMac(
  url: string,
  browserProfileRoot: string,
  existingProfilePath: string,
  onLaunch: (child: ChildProcess, profilePath: string) => void
): Promise<boolean> {
  const apps = getChromiumApps();
  for (const app of apps) {
    const result = await tryLaunchChromiumApp(app, url, browserProfileRoot, existingProfilePath);
    if (result) {
      onLaunch(result.child, result.profilePath);
      return true;
    }
  }

  for (const app of apps) {
    if (await tryOpen(['-na', app.name, '--args', `--app=${url}`, '--window-size=420,190', '--autoplay-policy=no-user-gesture-required'])) {
      return false;
    }
  }

  if (await tryOpen(['-a', 'Safari', url])) {
    return false;
  }

  if (await tryOpen([url])) {
    return false;
  }

  throw new Error(t('player.noBrowser'));
}

async function tryOpen(args: readonly string[]): Promise<boolean> {
  try {
    await execFileAsync('open', [...args]);
    return true;
  } catch {
    return false;
  }
}

interface LaunchResult {
  readonly child: ChildProcess;
  readonly profilePath: string;
}

function spawnChromiumWindow(executablePath: string, url: string, profilePath: string): LaunchResult {
  const child = spawn(executablePath, [
    `--user-data-dir=${profilePath}`,
    `--app=${url}`,
    '--window-size=420,190',
    '--autoplay-policy=no-user-gesture-required',
    '--no-first-run',
    '--no-default-browser-check'
  ], {
    detached: true,
    stdio: 'ignore'
  });
  child.unref();
  return { child, profilePath };
}

async function tryLaunchChromiumApp(
  app: ChromiumApp,
  url: string,
  browserProfileRoot: string,
  existingProfilePath: string
): Promise<LaunchResult | undefined> {
  for (const executablePath of app.executablePaths) {
    if (!executablePath || !await fileExists(vscode.Uri.file(executablePath))) {
      continue;
    }

    const profilePath = existingProfilePath || path.join(browserProfileRoot, app.name.replace(/\W+/g, '-').toLowerCase());
    await vscode.workspace.fs.createDirectory(vscode.Uri.file(profilePath));

    try {
      return spawnChromiumWindow(executablePath, url, profilePath);
    } catch {
      // 继续尝试下一个浏览器
    }
  }

  return undefined;
}

async function tryLaunchChromiumExecutable(
  executablePath: string,
  url: string,
  browserProfileRoot: string,
  existingProfilePath: string
): Promise<LaunchResult | undefined> {
  if (!await fileExists(vscode.Uri.file(executablePath))) {
    return undefined;
  }

  const profilePath = existingProfilePath || path.join(browserProfileRoot, `custom-${Date.now()}`);
  await vscode.workspace.fs.createDirectory(vscode.Uri.file(profilePath));

  try {
    return spawnChromiumWindow(executablePath, url, profilePath);
  } catch {
    return undefined;
  }
}
