import * as vscode from 'vscode';
import { RoleAnalysisProvider } from './config';
import { t } from './i18n';

/** 角色分析配置向导：选择提供商（Copilot / OpenAI 兼容）并写入设置 */
export async function configureRoleAnalysis(secrets: vscode.SecretStorage): Promise<void> {
  const settings = vscode.workspace.getConfiguration('audioplugin');
  const currentProvider = settings.get<string>('roleAnalysis.provider', 'openai');

  const providerPick = await vscode.window.showQuickPick(
    [
      {
        label: t('extension.roleAnalysisProviderCopilot'),
        description: t('extension.roleAnalysisProviderCopilotDesc'),
        provider: 'copilot' as RoleAnalysisProvider
      },
      {
        label: t('extension.roleAnalysisProviderOpenai'),
        description: t('extension.roleAnalysisProviderOpenaiDesc'),
        provider: 'openai' as RoleAnalysisProvider
      }
    ],
    {
      title: t('extension.roleAnalysisProviderTitle'),
      placeHolder: currentProvider === 'copilot'
        ? t('extension.roleAnalysisProviderCopilot')
        : t('extension.roleAnalysisProviderOpenai'),
      ignoreFocusOut: true
    }
  );
  if (!providerPick) {
    return;
  }

  if (providerPick.provider === 'copilot') {
    await configureCopilotProvider(settings);
  } else {
    await configureOpenaiProvider(settings, secrets);
  }
}

async function configureCopilotProvider(settings: vscode.WorkspaceConfiguration): Promise<void> {
  const allModels = await vscode.lm.selectChatModels({});
  if (allModels.length === 0) {
    vscode.window.showWarningMessage(t('extension.roleAnalysisNoCopilotModels'));
    return;
  }

  const currentId = settings.get<string>('roleAnalysis.copilotModelId', '');

  // 将模型按 vendor 分组，让列表中显示 vendor/family/name
  const items = allModels.map(m => ({
    label: m.name,
    description: `${m.vendor}/${m.family}`,
    detail: `id: ${m.id} · maxInput: ${m.maxInputTokens}`,
    modelId: m.id
  }));

  const selected = await vscode.window.showQuickPick(items, {
    title: t('extension.roleAnalysisCopilotModelTitle'),
    placeHolder: currentId
      ? items.find(i => i.modelId === currentId)?.label ?? currentId
      : t('extension.roleAnalysisCopilotModelPlaceholder'),
    ignoreFocusOut: true,
    matchOnDescription: true,
    matchOnDetail: true
  });
  if (!selected) {
    return;
  }

  await settings.update('roleAnalysis.provider', 'copilot', vscode.ConfigurationTarget.Global);
  await settings.update('roleAnalysis.copilotModelId', selected.modelId, vscode.ConfigurationTarget.Global);

  vscode.window.showInformationMessage(
    t('extension.roleAnalysisCopilotConfigured', selected.label, selected.description)
  );
}

async function configureOpenaiProvider(
  settings: vscode.WorkspaceConfiguration,
  secrets: vscode.SecretStorage
): Promise<void> {
  const currentEndpoint = settings.get<string>('roleAnalysis.openaiEndpoint', 'https://api.deepseek.com');
  const endpoint = await vscode.window.showInputBox({
    title: t('extension.apiEndpointTitle'),
    value: currentEndpoint,
    ignoreFocusOut: true,
    validateInput: value => value.trim().length === 0 ? t('extension.cannotBeEmpty') : undefined
  });
  if (!endpoint) {
    return;
  }

  const currentModel = settings.get<string>('roleAnalysis.openaiModel', 'deepseek-chat');
  const model = await vscode.window.showInputBox({
    title: t('extension.modelNameTitle'),
    value: currentModel,
    ignoreFocusOut: true,
    validateInput: value => value.trim().length === 0 ? t('extension.cannotBeEmpty') : undefined
  });
  if (!model) {
    return;
  }

  const apiKey = await vscode.window.showInputBox({
    title: 'API Key',
    prompt: t('extension.keepExistingKey'),
    password: true,
    ignoreFocusOut: true
  });
  if (apiKey === undefined) {
    return;
  }

  await settings.update('roleAnalysis.provider', 'openai', vscode.ConfigurationTarget.Global);
  await settings.update('roleAnalysis.openaiEndpoint', endpoint.trim(), vscode.ConfigurationTarget.Global);
  await settings.update('roleAnalysis.openaiModel', model.trim(), vscode.ConfigurationTarget.Global);

  if (apiKey.trim().length > 0) {
    await secrets.store('audioplugin.roleAnalysisApiKey', apiKey.trim());
  }

  vscode.window.showInformationMessage(t('extension.roleAnalysisConfigured', model, endpoint.trim()));
}
