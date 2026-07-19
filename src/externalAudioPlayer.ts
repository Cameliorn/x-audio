import { execFile, spawn, type ChildProcess } from 'child_process';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as http from 'http';
import type { AddressInfo } from 'net';
import * as path from 'path';
import { promisify } from 'util';
import * as vscode from 'vscode';
import { t } from './i18n';
import { TtsAudioFile, fileExists } from './ttsService';

const execFileAsync = promisify(execFile);

interface ChromiumApp {
  readonly name: string;
  readonly executablePaths: readonly string[];
}

const CHROMIUM_APPS: readonly ChromiumApp[] = [
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
  private browserProfilePath = '';

  public constructor(
    context: vscode.ExtensionContext,
    _playerRoot: vscode.Uri
  ) {
    this.browserProfileRoot = vscode.Uri.joinPath(context.globalStorageUri, 'browser-profile');
    // 每次创建实例使用不同的 profile 目录，避免与上次未退出的浏览器进程冲突
    this.browserProfilePath = path.join(this.browserProfileRoot.fsPath, `session-${Date.now()}`);
    const page = getPlayerPage(this.pageGen);
    this.html = page.html;
    this.contentSecurityPolicy = page.contentSecurityPolicy;
  }

  public async play(audioFile: TtsAudioFile, _text?: string): Promise<void> {
    await this.playQueue([audioFile]);
  }

  public async playQueue(files: readonly TtsAudioFile[]): Promise<void> {
    if (files.length === 0) {
      return;
    }

    this.queue = files;
    this.version++;
    await vscode.workspace.fs.createDirectory(this.browserProfileRoot);
    const url = await this.ensureServerUrl();

    // 先杀掉上一次的浏览器进程，确保每次都是全新窗口
    if (this.browserChild && this.browserChild.exitCode === null) {
      try { this.browserChild.kill('SIGKILL'); } catch { /* 进程可能已退出 */ }
    }
    this.browserChild = undefined;

    await launchBrowserWindow(url, this.browserProfileRoot.fsPath, this.browserProfilePath,
      (child, profilePath) => {
        this.browserChild = child;
        this.browserProfilePath = profilePath || this.browserProfilePath;
      });
  }

  public pause(): void {
    vscode.window.showInformationMessage(t('player.pauseInfo'));
  }

  public stop(): void {
    vscode.window.showInformationMessage(t('player.stopInfo'));
  }

  public dispose(): void {
    this.server?.close();
    this.server = undefined;
    this.serverUrl = undefined;
    if (this.browserChild && this.browserChild.exitCode === null) {
      this.browserChild.kill();
    }
    this.browserChild = undefined;
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
      response.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store'
      });
      response.end(JSON.stringify({ version: this.version, count: this.queue.length, pageGen: this.pageGen }));
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

async function launchBrowserWindow(
  url: string,
  browserProfileRoot: string,
  existingProfilePath: string,
  onLaunch: (child: ChildProcess, profilePath: string) => void
): Promise<void> {
  if (process.platform === 'darwin') {
    await launchOnMac(url, browserProfileRoot, existingProfilePath, onLaunch);
    return;
  }

  if (await vscode.env.openExternal(vscode.Uri.parse(url))) {
    return;
  }

  throw new Error(t('player.openFailed'));
}

async function launchOnMac(
  url: string,
  browserProfileRoot: string,
  existingProfilePath: string,
  onLaunch: (child: ChildProcess, profilePath: string) => void
): Promise<void> {
  for (const app of CHROMIUM_APPS) {
    const result = await tryLaunchChromiumApp(app, url, browserProfileRoot, existingProfilePath);
    if (result) {
      onLaunch(result.child, result.profilePath);
      return;
    }
  }

  for (const app of CHROMIUM_APPS) {
    if (await tryOpen(['-na', app.name, '--args', `--app=${url}`, '--window-size=420,190', '--autoplay-policy=no-user-gesture-required'])) {
      return;
    }
  }

  if (await tryOpen(['-a', 'Safari', url])) {
    return;
  }

  if (await tryOpen([url])) {
    return;
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
    } catch {
      // 继续尝试下一个浏览器
    }
  }

  return undefined;
}

function getAudioMime(format: TtsAudioFile['format']): string {
  switch (format) {
    case 'wav':
      return 'audio/wav';
    case 'flac':
      return 'audio/flac';
    case 'mp3':
    default:
      return 'audio/mpeg';
  }
}

interface PlayerPage {
  readonly html: string;
  readonly contentSecurityPolicy: string;
}

function getPlayerPage(pageGen: number): PlayerPage {
  const nonce = crypto.randomBytes(16).toString('base64');
  const escapedNonce = escapeAttribute(nonce);

  return {
    contentSecurityPolicy: `default-src 'none'; media-src 'self'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none';`,
    html: `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>MiniMax 播放器</title>
  <style nonce="${escapedNonce}">
    * {
      box-sizing: border-box;
    }

    html,
    body {
      margin: 0;
      min-width: 360px;
      min-height: 150px;
      background: #ffffff;
      color: #1f2328;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }

    body {
      padding: 14px;
    }

    main {
      width: 100%;
      min-height: calc(100vh - 28px);
      padding: 12px 0;
      display: grid;
      align-content: center;
    }

    audio {
      width: 100%;
    }
  </style>
</head>
<body>
  <main>
    <audio id="audio" controls autoplay></audio>
  </main>
  <script nonce="${escapedNonce}">
    (function () {
      try {
        window.resizeTo(420, 190);
      } catch (_) {}

      const audio = document.getElementById('audio');
      var currentVersion = 0;
      var currentIndex = 0;
      var currentCount = 1;
      var pageGen = ${pageGen};
      var versionUrl = window.location.pathname + '/version';

      function startPlayback() {
        audio.play().catch(function () {});
      }

      function loadCurrent() {
        audio.src = window.location.pathname + '/audio?version=' + encodeURIComponent(String(currentVersion))
          + '&index=' + encodeURIComponent(String(currentIndex));
        audio.load();
        startPlayback();
      }

      function playVersion(version, count) {
        if (typeof count === 'number' && count > 0) {
          currentCount = count;
        }

        if (!version || version === currentVersion) {
          return;
        }

        currentVersion = version;
        currentIndex = 0;
        loadCurrent();
      }

      audio.addEventListener('ended', function () {
        if (currentIndex + 1 < currentCount) {
          currentIndex++;
          loadCurrent();
        }
      });

      startPlayback();
      window.addEventListener('load', startPlayback);
      setTimeout(startPlayback, 150);

      (function pollVersion() {
        fetch(versionUrl)
          .then(function (r) { return r.json(); })
          .then(function (data) {
            if (typeof data.pageGen === 'number' && data.pageGen !== pageGen) {
              window.location.reload();
              return;
            }
            if (typeof data.version === 'number') {
              playVersion(data.version, data.count);
            }
          })
          .catch(function () {})
          .finally(function () {
            setTimeout(pollVersion, 1000);
          });
      })();
    })();
  </script>
</body>
</html>`
  };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeAttribute(value: string): string {
  return escapeHtml(value).replace(/`/g, '&#96;');
}