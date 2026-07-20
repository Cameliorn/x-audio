# MiniMax 文字转语音

在 VS Code 中通过 MiniMax API 将文本合成为语音。支持普通朗读、分角色朗读、背景音效，并可作为 Copilot Agent 工具使用。

## 功能

- **朗读选中文本** — 选中编辑器内容，一键合成语音
- **朗读输入文本** — 手动输入文本后合成
- **分角色朗读** — 自动分析小说角色与对白，为每个角色分配不同音色
- **背景音效** — 自动分析文本场景氛围，匹配对应音效素材
- **播放控制** — 支持暂停/恢复、停止播放
- **Copilot 集成** — 作为 Language Model Tool（`minimax_tts_speak`）供 Copilot Agent 调用
- **音频缓存** — 相同文本自动复用已合成的音频

## 使用方式

### 普通朗读

1. 运行 **MiniMax 文字转语音：设置密钥**，粘贴 MiniMax API 密钥
2. 在编辑器中选中文本，右键选择 **朗读选中文本**
3. 或通过命令面板运行 **朗读输入文本**，手动输入内容

### 分角色朗读

1. 运行 **MiniMax 文字转语音：配置角色分析**，设置 DeepSeek API 密钥
2. 打开小说文本，运行 **分角色朗读文档**
3. 确认角色与音色分配后开始合成

### 背景音效

1. 运行 **选择音效素材库文件夹**，选择一个按场景分类的音频目录
2. 分角色朗读时，DeepSeek 自动分析场景并匹配音效

> 音效素材库结构示例：`sfx/forest/`, `sfx/rain/`, `sfx/battle/` 等，子目录名即为场景分类。

## 配置文件 `.ttsvoices.json`

在项目目录下创建 `.ttsvoices.json`，可为角色指定音色和语音参数（优先级高于 LLM 分析结果）：

```json
{
  "张三": { "voiceId": "male-qingse", "speed": 1.2, "pitch": 2 },
  "李四": { "speed": 0.9 },
  "王五": "male-qingse",
  "@roleVoices": {
    "narrator": { "voiceId": "audiobook_female_1", "speed": 0.9 },
    "elderly": { "pitch": -3 }
  }
}
```

- **字符串值** — 指定角色音色 ID
- **对象值** — 可同时指定 `voiceId`、`speed`（0.5~2.0）、`pitch`（-12~12）、`vol`（0.1~10）
- **`@roleVoices`** — 按角色类型（narrator/male/female/girl/boy/child/elderly）指定音色和参数
- 参数优先级：角色名 > 角色类型 > LLM 分析值
- 配置文件向上查找，最近的生效

## 命令

| 命令 | 说明 |
|---|---|
| `minimaxTts.speakSelection` | 朗读选中文本 |
| `minimaxTts.speakInput` | 朗读输入文本 |
| `minimaxTts.speakDocumentWithRoles` | 分角色朗读文档 |
| `minimaxTts.setApiKey` | 设置 MiniMax API 密钥 |
| `minimaxTts.configureRoleAnalysis` | 配置角色分析（DeepSeek） |
| `minimaxTts.setSoundEffectsDir` | 选择音效素材库 |
| `minimaxTts.pause` | 暂停/恢复播放 |
| `minimaxTts.stop` | 停止播放 |

## 设置

通过 VS Code 设置面板调整（`minimaxTts.*`），主要配置项：

| 设置 | 说明 | 默认值 |
|---|---|---|
| `apiHost` | MiniMax API 地址 | `https://api.minimax.io` |
| `model` | 语音模型 | `speech-2.8-turbo` |
| `voiceId` | 默认音色 ID | `English_expressive_narrator` |
| `speed` | 语速（0.5~2.0） | `1` |
| `pitch` | 语调偏移（-12~12） | `0` |
| `vol` | 音量倍率（0.1~10） | `1` |
| `roleVoices` | 角色类型默认音色 | — |
| `soundEffectsDir` | 音效素材库目录 | — |
| `roleAnalysisOpenaiEndpoint` | 角色分析 API 地址 | `https://api.deepseek.com` |
| `roleAnalysisOpenaiModel` | 角色分析模型 | `deepseek-chat` |
| `cacheEnabled` | 启用音频缓存 | `true` |

## 要求

- VS Code `^1.100.0`
- MiniMax API 密钥（语音订阅或 Token Plan）
- 分角色朗读需 DeepSeek API 密钥
