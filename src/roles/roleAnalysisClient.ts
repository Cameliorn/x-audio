import * as vscode from 'vscode';
import { RoleAnalysisConfig } from '../common/config';
import { UserVisibleError } from '../common/errors';
import { t } from '../common/i18n';
import { createAbortController } from '../common/utils';

export interface ChatMessage {
  readonly role: 'system' | 'user';
  readonly content: string;
}

export interface RoleAnalysisClient {
  sendRequest(messages: readonly ChatMessage[], token: vscode.CancellationToken): Promise<string>;
}

export function createRoleAnalysisClient(
  config: RoleAnalysisConfig,
  secrets: vscode.SecretStorage
): RoleAnalysisClient {
  if (config.provider === 'copilot') {
    return new CopilotRoleAnalysisClient(config);
  }
  return new OpenAIRoleAnalysisClient(config, secrets);
}

// ─── Copilot 内置模型 ────────────────────────────────────────

class CopilotRoleAnalysisClient implements RoleAnalysisClient {
  public constructor(
    private readonly config: RoleAnalysisConfig
  ) { }

  public async sendRequest(
    chatMessages: readonly ChatMessage[],
    token: vscode.CancellationToken
  ): Promise<string> {
    if (!this.config.copilotModelId) {
      throw new UserVisibleError(t('roleAnalysis.copilotNotConfigured'));
    }

    const [model] = await vscode.lm.selectChatModels({ id: this.config.copilotModelId });
    if (!model) {
      throw new UserVisibleError(
        t('roleAnalysis.copilotModelNotFound', this.config.copilotModelId)
      );
    }

    // 预检测：部分模型缺少 tokenizer 元数据，sendRequest 内部计算 token 时会抛
    // "Unknown tokenizer: undefined"（Copilot 扩展已知问题）。提前用 countTokens 暴露，
    // 走与 sendRequest 相同的 acquireTokenizer 路径。
    try {
      await model.countTokens('检测', token);
    } catch (error) {
      if (error instanceof vscode.CancellationError) {
        throw error;
      }
      if (error instanceof Error && /unknown tokenizer/i.test(error.message)) {
        throw new UserVisibleError(t('roleAnalysis.copilotTokenizerError', model.name, vscode.version));
      }
    }

    // Copilot API 不支持 system 角色消息，统一按 user 消息发送
    const messages = chatMessages.map(m =>
      vscode.LanguageModelChatMessage.User(m.content)
    );

    let response: vscode.LanguageModelChatResponse;
    try {
      response = await model.sendRequest(messages, {}, token);
    } catch (error) {
      if (error instanceof vscode.CancellationError) {
        throw error;
      }
      if (error instanceof Error && /unknown tokenizer/i.test(error.message)) {
        throw new UserVisibleError(t('roleAnalysis.copilotTokenizerError', model.name, vscode.version));
      }
      throw error;
    }

    const parts: string[] = [];
    for await (const chunk of response.stream) {
      if (chunk instanceof vscode.LanguageModelTextPart) {
        parts.push(chunk.value);
      }
    }

    const content = parts.join('').trim();
    if (content.length === 0) {
      throw new UserVisibleError(t('roleAnalysis.emptyContent'));
    }

    return content;
  }
}

// ─── OpenAI 兼容接口 ────────────────────────────────────────

class OpenAIRoleAnalysisClient implements RoleAnalysisClient {
  public constructor(
    private readonly config: RoleAnalysisConfig,
    private readonly secrets: vscode.SecretStorage
  ) { }

  public async sendRequest(
    chatMessages: readonly ChatMessage[],
    token: vscode.CancellationToken
  ): Promise<string> {
    const apiKey = await this.resolveApiKey();
    const endpoint = ensureChatCompletionsUrl(this.config.openaiEndpoint);
    const model = this.config.openaiModel;
    if (token.isCancellationRequested) {
      throw new vscode.CancellationError();
    }

    let timedOut = false;
    const { controller, clear } = createAbortController(
      token,
      this.config.requestTimeoutMs,
      () => { timedOut = true; }
    );

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model,
          messages: chatMessages.map(m => ({ role: m.role, content: m.content })),
          temperature: 0.3,
          stream: false
        }),
        signal: controller.signal
      });

      if (!response.ok) {
        const body = await response.text().catch(() => '');
        throw new UserVisibleError(
          t('roleAnalysis.apiError', response.status, body.slice(0, 300))
        );
      }

      const data = await response.json() as Record<string, unknown>;
      const choices = data.choices as Array<{ message?: { content?: string } }> | undefined;
      const content = choices?.[0]?.message?.content;

      if (typeof content !== 'string' || content.trim().length === 0) {
        throw new UserVisibleError(t('roleAnalysis.emptyContent'));
      }

      return content;
    } catch (error) {
      if (timedOut) {
        throw new UserVisibleError(t('roleAnalysis.timeout', this.config.requestTimeoutMs / 1000));
      }

      if (token.isCancellationRequested) {
        throw new vscode.CancellationError();
      }

      if (error instanceof Error && error.name === 'AbortError') {
        throw new vscode.CancellationError();
      }

      throw error;
    } finally {
      clear();
    }
  }

  private async resolveApiKey(): Promise<string> {
    const key = await this.secrets.get('xaudio.roleAnalysisApiKey');
    if (!key) {
      throw new UserVisibleError(t('roleAnalysis.missingApiKey'));
    }

    return key;
  }
}

function ensureChatCompletionsUrl(endpoint: string): string {
  let url = endpoint.trim().replace(/\/+$/, '');

  if (!/^https?:\/\//i.test(url)) {
    url = `https://${url}`;
  }

  if (!/\/chat\/completions$/i.test(url)) {
    url = `${url}/chat/completions`;
  }

  return url;
}
