import * as vscode from 'vscode';
import { RoleAnalysisConfig } from './config';
import { UserVisibleError } from './errors';
import { t } from './i18n';
import { createAbortController } from './utils';

export interface RoleAnalysisClient {
    sendRequest(prompt: string, token: vscode.CancellationToken): Promise<string>;
}

export function createRoleAnalysisClient(
    config: RoleAnalysisConfig,
    secrets: vscode.SecretStorage
): RoleAnalysisClient {
    return new OpenAIRoleAnalysisClient(config, secrets);
}

class OpenAIRoleAnalysisClient implements RoleAnalysisClient {
    public constructor(
        private readonly config: RoleAnalysisConfig,
        private readonly secrets: vscode.SecretStorage
    ) { }

    public async sendRequest(
        prompt: string,
        token: vscode.CancellationToken
    ): Promise<string> {
        const apiKey = await this.resolveApiKey();
        const endpoint = ensureChatCompletionsUrl(this.config.openaiEndpoint);
        const model = this.config.openaiModel;

        const { controller, clear } = createAbortController(token);

        try {
            const response = await fetch(endpoint, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${apiKey}`
                },
                body: JSON.stringify({
                    model,
                    messages: [
                        { role: 'user', content: prompt }
                    ],
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
            if (error instanceof Error && error.name === 'AbortError') {
                throw new vscode.CancellationError();
            }

            throw error;
        } finally {
            clear();
        }
    }

    private async resolveApiKey(): Promise<string> {
        const key = await this.secrets.get('minimaxTts.roleAnalysisApiKey');
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
