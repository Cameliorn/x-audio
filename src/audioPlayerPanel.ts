import * as crypto from 'crypto';
import * as vscode from 'vscode';
import { TtsAudioFile } from './ttsService';

const VIEW_TYPE = 'minimaxTts.audioPlayer';

interface PlayMessage {
  readonly type: 'play';
  readonly audioSrc: string;
  readonly text: string;
  readonly textPreview: string;
  readonly characters: number;
  readonly format: string;
  readonly cacheHit: boolean;
  readonly traceId?: string;
}

export class AudioPlayerPanel {
  private panel: vscode.WebviewPanel | undefined;
  private currentTextPreview = '';

  public constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly localResourceRoot: vscode.Uri
  ) { }

  public async play(audioFile: TtsAudioFile, text?: string): Promise<void> {
    const panel = this.ensurePanel();
    const audioSrc = panel.webview.asWebviewUri(audioFile.uri).toString();
    this.currentTextPreview = text ? truncateText(text, 80) : `${audioFile.characters} 个字符`;

    const message: PlayMessage = {
      type: 'play',
      audioSrc,
      text: text ?? '',
      textPreview: this.currentTextPreview,
      characters: audioFile.characters,
      format: audioFile.format,
      cacheHit: audioFile.cacheHit,
      traceId: audioFile.traceId
    };

    void panel.webview.postMessage(message);
    panel.reveal(vscode.ViewColumn.Beside, true);
  }

  public pause(): void {
    void this.panel?.webview.postMessage({ type: 'pause' });
  }

  public stop(): void {
    void this.panel?.webview.postMessage({ type: 'stop' });
  }

  public dispose(): void {
    this.panel?.dispose();
    this.panel = undefined;
  }

  private ensurePanel(): vscode.WebviewPanel {
    if (this.panel) {
      return this.panel;
    }

    const panel = vscode.window.createWebviewPanel(
      VIEW_TYPE,
      'MiniMax 文字转语音',
      { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        enableFindWidget: false,
        localResourceRoots: [this.localResourceRoot]
      }
    );

    panel.webview.html = this.getShellHtml(panel.webview);

    panel.webview.onDidReceiveMessage(message => {
      if (message?.type === 'ready') {
        // webview 就绪后重发当前播放内容
      }
    });

    panel.onDidDispose(() => {
      this.panel = undefined;
    }, undefined, this.context.subscriptions);

    this.panel = panel;
    return panel;
  }

  private getShellHtml(webview: vscode.Webview): string {
    const nonce = getNonce();
    const cspSource = webview.cspSource;

    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; media-src ${cspSource}; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}'; img-src 'none'; font-src 'none';">
  <title>MiniMax 文字转语音</title>
  <style nonce="${nonce}">
    * { margin: 0; padding: 0; box-sizing: border-box; }

    :root {
      color-scheme: light dark;
    }

    body {
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      padding: 12px 16px;
      color: var(--vscode-editor-foreground);
      background: var(--vscode-editor-background);
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      -webkit-user-select: none;
      user-select: none;
    }

    .player {
      width: 100%;
      max-width: 400px;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .header {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 11px;
      color: var(--vscode-descriptionForeground);
      text-transform: uppercase;
      letter-spacing: 0.6px;
    }

    .header-icon {
      font-size: 14px;
      line-height: 1;
    }

    .text-preview {
      font-size: 13px;
      line-height: 1.5;
      color: var(--vscode-input-foreground);
      background: var(--vscode-input-background);
      border-radius: 6px;
      padding: 8px 10px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .meta-line {
      display: flex;
      gap: 8px;
      font-size: 11px;
      color: var(--vscode-descriptionForeground);
    }

    .meta-dot {
      opacity: 0.5;
    }

    .progress-area {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .progress-bar {
      flex: 1;
      height: 4px;
      background: var(--vscode-progressBar-background);
      border-radius: 2px;
      cursor: pointer;
      position: relative;
    }

    .progress-fill {
      height: 100%;
      background: var(--vscode-progressBar-foreground);
      border-radius: 2px;
      width: 0%;
      transition: width 0.15s linear;
    }

    .time {
      font-size: 11px;
      color: var(--vscode-descriptionForeground);
      font-variant-numeric: tabular-nums;
      min-width: 36px;
      text-align: right;
    }

    .time-current {
      text-align: left;
    }

    .controls {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
    }

    button {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 32px;
      height: 32px;
      border: none;
      border-radius: 50%;
      background: transparent;
      color: var(--vscode-editor-foreground);
      cursor: pointer;
      font-size: 16px;
      transition: background 0.15s, color 0.15s;
      line-height: 1;
      padding: 0;
    }

    button:hover {
      background: var(--vscode-toolbar-hoverBackground);
    }

    button:active {
      background: var(--vscode-toolbar-activeBackground);
    }

    .btn-play {
      width: 40px;
      height: 40px;
      font-size: 18px;
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      border-radius: 50%;
    }

    .btn-play:hover {
      background: var(--vscode-button-hoverBackground);
    }

    .btn-play:active {
      background: var(--vscode-button-background);
      opacity: 0.9;
    }

    .btn-play.playing {
      background: var(--vscode-inputOption-activeBackground, var(--vscode-button-background));
    }

    .empty-state {
      text-align: center;
      color: var(--vscode-descriptionForeground);
      font-size: 13px;
      padding: 24px 0;
    }

    .hidden {
      display: none !important;
    }
  </style>
</head>
<body>
  <div class="player" id="player-root">
    <div class="empty-state" id="empty-state">等待 MiniMax 语音合成…</div>
    <div class="hidden" id="player-ui">
      <div class="header">
        <span class="header-icon">🔊</span>
        <span>MiniMax 文字转语音</span>
      </div>
      <div class="text-preview" id="text-preview" title=""></div>
      <div class="meta-line">
        <span id="meta-chars"></span>
        <span class="meta-dot">·</span>
        <span id="meta-format"></span>
        <span class="meta-dot">·</span>
        <span id="meta-cache"></span>
      </div>
      <div class="progress-area">
        <span class="time time-current" id="time-current">00:00</span>
        <div class="progress-bar" id="progress-bar">
          <div class="progress-fill" id="progress-fill"></div>
        </div>
        <span class="time" id="time-total">00:00</span>
      </div>
      <div class="controls">
        <button id="btn-stop" title="停止" aria-label="停止">⏹</button>
        <button class="btn-play" id="btn-play-pause" title="播放" aria-label="播放">▶</button>
      </div>
    </div>
    <audio id="audio" preload="auto"></audio>
  </div>
  <script nonce="${nonce}">
    (function () {
      const audio = document.getElementById('audio');
      const emptyState = document.getElementById('empty-state');
      const playerUi = document.getElementById('player-ui');
      const textPreview = document.getElementById('text-preview');
      const metaChars = document.getElementById('meta-chars');
      const metaFormat = document.getElementById('meta-format');
      const metaCache = document.getElementById('meta-cache');
      const timeCurrent = document.getElementById('time-current');
      const timeTotal = document.getElementById('time-total');
      const progressBar = document.getElementById('progress-bar');
      const progressFill = document.getElementById('progress-fill');
      const btnPlayPause = document.getElementById('btn-play-pause');
      const btnStop = document.getElementById('btn-stop');

      let isPlaying = false;
      let duration = 0;

      function fmtTime(seconds) {
        if (!Number.isFinite(seconds) || seconds < 0) { return '00:00'; }
        const m = Math.floor(seconds / 60);
        const s = Math.floor(seconds % 60);
        return String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
      }

      function setPlaying(state) {
        isPlaying = state;
        if (state) {
          btnPlayPause.textContent = '⏸';
          btnPlayPause.classList.add('playing');
          btnPlayPause.title = '暂停';
          btnPlayPause.setAttribute('aria-label', '暂停');
        } else {
          btnPlayPause.textContent = '▶';
          btnPlayPause.classList.remove('playing');
          btnPlayPause.title = '播放';
          btnPlayPause.setAttribute('aria-label', '播放');
        }
      }

      function updateProgress() {
        if (!duration) { return; }
        const pct = (audio.currentTime / duration) * 100;
        progressFill.style.width = pct + '%';
        timeCurrent.textContent = fmtTime(audio.currentTime);
      }

      function loadAndPlay(audioSrc) {
        audio.src = audioSrc;
        audio.load();
        audio.play().then(() => {
          setPlaying(true);
        }).catch(function () {
          // 自动播放可能被浏览器阻止，用户需手动点击
        });
      }

      // --- events ---

      btnPlayPause.addEventListener('click', function () {
        if (!audio.src) { return; }
        if (isPlaying) {
          audio.pause();
          setPlaying(false);
        } else {
          audio.play().then(function () {
            setPlaying(true);
          }).catch(function () {});
        }
      });

      btnStop.addEventListener('click', function () {
        audio.pause();
        audio.currentTime = 0;
        setPlaying(false);
        progressFill.style.width = '0%';
        timeCurrent.textContent = '00:00';
      });

      progressBar.addEventListener('click', function (e) {
        if (!duration || !audio.src) { return; }
        const rect = progressBar.getBoundingClientRect();
        const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
        audio.currentTime = ratio * duration;
        updateProgress();
      });

      audio.addEventListener('loadedmetadata', function () {
        duration = audio.duration;
        timeTotal.textContent = fmtTime(duration);
      });

      audio.addEventListener('timeupdate', updateProgress);

      audio.addEventListener('play', function () {
        setPlaying(true);
      });

      audio.addEventListener('pause', function () {
        setPlaying(false);
      });

      audio.addEventListener('ended', function () {
        setPlaying(false);
        progressFill.style.width = '100%';
        timeCurrent.textContent = fmtTime(duration);
      });

      audio.addEventListener('error', function () {
        setPlaying(false);
      });

      // --- messages from extension ---

      window.addEventListener('message', function (event) {
        var msg = event.data;
        if (!msg) { return; }

        if (msg.type === 'play') {
          emptyState.classList.add('hidden');
          playerUi.classList.remove('hidden');
          textPreview.textContent = msg.textPreview || (msg.characters + ' 个字符');
          textPreview.title = msg.text || '';
          metaChars.textContent = msg.characters + ' 个字符';
          metaFormat.textContent = msg.format || 'mp3';
          metaCache.textContent = msg.cacheHit ? '缓存' : '新生成';
          duration = 0;
          progressFill.style.width = '0%';
          timeCurrent.textContent = '00:00';
          timeTotal.textContent = '00:00';
          loadAndPlay(msg.audioSrc);
        } else if (msg.type === 'pause') {
          if (isPlaying) {
            audio.pause();
            setPlaying(false);
          } else if (audio.src) {
            audio.play().then(function () {
              setPlaying(true);
            }).catch(function () {});
          }
        } else if (msg.type === 'stop') {
          audio.pause();
          audio.currentTime = 0;
          setPlaying(false);
          progressFill.style.width = '0%';
          timeCurrent.textContent = '00:00';
        }
      });
    })();
  </script>
</body>
</html>`;
  }
}

function truncateText(text: string, maxLen: number): string {
  if (text.length <= maxLen) {
    return text;
  }

  return text.slice(0, maxLen - 1) + '…';
}

function getNonce(): string {
  return crypto.randomBytes(16).toString('base64');
}
