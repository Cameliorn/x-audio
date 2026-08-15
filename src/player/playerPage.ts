import * as crypto from 'crypto';
import type { TtsAudioFile } from '../services/ttsService';

export interface PlayerPage {
  readonly html: string;
  readonly contentSecurityPolicy: string;
}

export function getPlayerPage(pageGen: number): PlayerPage {
  const nonce = crypto.randomBytes(16).toString('base64');

  return {
    contentSecurityPolicy: `default-src 'none'; media-src 'self'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none';`,
    html: `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>x-audio 播放器</title>
  <style nonce="${nonce}">
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
  <script nonce="${nonce}">
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

      function playVersion(version, count, command) {
        if (command === 'pause') {
          audio.pause();
          return;
        }
        if (command === 'resume') {
          audio.play().catch(function () {});
          return;
        }
        if (command === 'stop') {
          audio.pause();
          audio.src = '';
          try { window.close(); } catch (_) {}
          return;
        }

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
              playVersion(data.version, data.count, data.command);
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

export function getAudioMime(format: TtsAudioFile['format']): string {
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
