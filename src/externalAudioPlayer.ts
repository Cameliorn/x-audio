import { execFile, spawn } from 'child_process';
import * as crypto from 'crypto';
import * as http from 'http';
import type { AddressInfo } from 'net';
import * as path from 'path';
import { promisify } from 'util';
import * as vscode from 'vscode';
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
  private html = '';
  private contentSecurityPolicy = '';

  public constructor(
    context: vscode.ExtensionContext,
    _playerRoot: vscode.Uri
  ) {
    this.browserProfileRoot = vscode.Uri.joinPath(context.globalStorageUri, 'browser-profile');
  }

  public async play(audioFile: TtsAudioFile, _text?: string): Promise<void> {
    const audioBytes = await vscode.workspace.fs.readFile(audioFile.uri);
    const audioSrc = createAudioDataUri(audioFile.format, audioBytes);
    const page = getPlayerPage(audioSrc);
    this.html = page.html;
    this.contentSecurityPolicy = page.contentSecurityPolicy;
    await vscode.workspace.fs.createDirectory(this.browserProfileRoot);
    const url = await this.ensureServerUrl();
    await openExternalUrl(`${url}?v=${Date.now()}`, this.browserProfileRoot.fsPath);
  }

  public pause(): void {
    vscode.window.showInformationMessage('外部播放器已打开，请在播放器窗口中暂停或恢复播放。');
  }

  public stop(): void {
    vscode.window.showInformationMessage('外部播放器已打开，请在播放器窗口中停止播放。');
  }

  public dispose(): void {
    this.server?.close();
    this.server = undefined;
    this.serverUrl = undefined;
  }

  private async ensureServerUrl(): Promise<string> {
    if (this.serverUrl) {
      return this.serverUrl;
    }

    this.server = http.createServer((request, response) => this.handleRequest(request, response));

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

        reject(new Error('无法启动本地播放器服务。'));
      });
    });

    this.serverUrl = `http://127.0.0.1:${port}/${this.routeToken}`;
    return this.serverUrl;
  }

  private handleRequest(request: http.IncomingMessage, response: http.ServerResponse): void {
    const requestUrl = new URL(request.url ?? '/', 'http://127.0.0.1');

    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.writeHead(405, {
        Allow: 'GET, HEAD'
      });
      response.end();
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
}

async function openExternalUrl(url: string, browserProfileRoot: string): Promise<void> {
  if (process.platform === 'darwin') {
    await openExternalUrlOnMac(url, browserProfileRoot);
    return;
  }

  if (await vscode.env.openExternal(vscode.Uri.parse(url))) {
    return;
  }

  throw new Error('无法打开外部播放器页面。');
}

async function openExternalUrlOnMac(url: string, browserProfileRoot: string): Promise<void> {
  for (const app of CHROMIUM_APPS) {
    if (await tryLaunchChromiumApp(app, url, browserProfileRoot)) {
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

  throw new Error('无法打开外部播放器页面。请确认系统已安装 Safari、Chrome、Edge 或其他浏览器。');
}

async function tryOpen(args: readonly string[]): Promise<boolean> {
  try {
    await execFileAsync('open', [...args]);
    return true;
  } catch {
    return false;
  }
}

async function tryLaunchChromiumApp(app: ChromiumApp, url: string, browserProfileRoot: string): Promise<boolean> {
  for (const executablePath of app.executablePaths) {
    if (!executablePath || !await fileExists(vscode.Uri.file(executablePath))) {
      continue;
    }

    const profilePath = path.join(browserProfileRoot, app.name.replace(/\W+/g, '-').toLowerCase());
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
      return true;
    } catch {
      // 继续尝试下一个浏览器
    }
  }

  return false;
}

function createAudioDataUri(format: TtsAudioFile['format'], audioBytes: Uint8Array): string {
  return `data:${getAudioMime(format)};base64,${Buffer.from(audioBytes).toString('base64')}`;
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

function getPlayerPage(audioSrc: string): PlayerPage {
  const nonce = crypto.randomBytes(16).toString('base64');
  const escapedNonce = escapeAttribute(nonce);

  return {
    contentSecurityPolicy: `default-src 'none'; media-src data:; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}'; base-uri 'none'; form-action 'none'; frame-ancestors 'none';`,
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
      display: grid;
      align-content: center;
      gap: 10px;
    }

    h1 {
      margin: 0;
      font-size: 14px;
      font-weight: 600;
      color: #24292f;
    }

    #status {
      color: #6e7781;
      font-size: 12px;
      line-height: 1.4;
    }

    audio {
      width: 100%;
    }

    .actions {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    button {
      border: 0;
      border-radius: 999px;
      padding: 8px 14px;
      color: #ffffff;
      background: #0969da;
      cursor: pointer;
      font: inherit;
      font-size: 13px;
    }

    button:hover {
      background: #0550ae;
    }

    .secondary {
      color: #24292f;
      background: #f6f8fa;
      border: 1px solid #d0d7de;
    }

    .secondary:hover {
      background: #eef1f4;
    }
  </style>
</head>
<body>
  <main>
    <h1>MiniMax 播放器</h1>
    <audio id="audio" src="${escapeAttribute(audioSrc)}" controls autoplay></audio>
    <div class="actions">
      <button id="playPause" type="button">播放 / 暂停</button>
      <button id="stop" class="secondary" type="button">停止</button>
    </div>
    <div id="status">正在尝试自动播放…</div>
  </main>
  <script nonce="${escapedNonce}">
    (function () {
      try {
        window.resizeTo(420, 190);
      } catch (_) {}

      const audio = document.getElementById('audio');
      const playPause = document.getElementById('playPause');
      const stop = document.getElementById('stop');
      const status = document.getElementById('status');

      function setStatus(text) {
        status.textContent = text;
      }

      playPause.addEventListener('click', function () {
        if (audio.paused) {
          audio.play().then(function () {
            setStatus('播放中');
          }).catch(function () {
            setStatus('浏览器阻止了播放，请使用音频控件播放。');
          });
        } else {
          audio.pause();
          setStatus('已暂停');
        }
      });

      stop.addEventListener('click', function () {
        audio.pause();
        audio.currentTime = 0;
        setStatus('已停止');
      });

      audio.addEventListener('play', function () { setStatus('播放中'); });
      audio.addEventListener('pause', function () { setStatus('已暂停'); });
      audio.addEventListener('ended', function () { setStatus('播放完成'); });
      audio.addEventListener('error', function () { setStatus('播放失败，请重新生成语音。'); });

      function startPlayback() {
        audio.play().then(function () {
          setStatus('播放中');
        }).catch(function () {
          setStatus('浏览器阻止了自动播放，请点击播放。');
        });
      }

      startPlayback();
      window.addEventListener('load', startPlayback);
      setTimeout(startPlayback, 150);
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