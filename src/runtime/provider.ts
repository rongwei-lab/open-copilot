import vscode from 'vscode';
import { logger } from '../logger';
import { DeepSeekChatProvider } from '../provider';

export async function registerProvider(
	context: vscode.ExtensionContext,
): Promise<DeepSeekChatProvider> {
	const provider = new DeepSeekChatProvider(context);
	const refreshModels = () => {
		const candidate = provider as DeepSeekChatProvider & {
			refreshModels?: () => void | Promise<void> | Thenable<void>;
		};
		return candidate.refreshModels?.() ?? provider.refreshModelPicker();
	};

	context.subscriptions.push(
		vscode.commands.registerCommand('open-copilot.setApiKey', () => provider.configureApiKey()),
		vscode.commands.registerCommand('open-copilot.clearApiKey', () => provider.clearApiKey()),
		vscode.commands.registerCommand('open-copilot.setVisionModel', () => provider.setVisionModel()),
		vscode.commands.registerCommand('open-copilot.refreshModels', refreshModels),
		vscode.commands.registerCommand('open-copilot.selectModel', () => provider.selectNewApiModel()),
		vscode.commands.registerCommand('open-copilot.addModel', (...args: unknown[]) =>
			provider.addModelProfile(typeof args[0] === 'string' ? args[0] : undefined),
		),
		vscode.commands.registerCommand('open-copilot.openModelManager', () =>
			provider.openModelManager(),
		),
		vscode.lm.registerLanguageModelChatProvider('open-copilot', provider),
	);

	// Copilot Chat can serve cached model info without configurationSchema.
	// Activate it first so this refresh reaches a live listener and re-queries the provider.
	await activateCopilotChat();
	provider.refreshModelPicker();
	// Populate the catalog immediately when a token is already configured. The
	// catalog also schedules TTL-based background refreshes, so users do not need
	// to reopen the model manager or run the command manually after this startup.
	void provider.refreshModels().catch((error) => {
		logger.warn('Initial New API model refresh failed', error);
	});

	return provider;
}

async function activateCopilotChat(): Promise<void> {
	try {
		await vscode.extensions.getExtension('github.copilot-chat')?.activate();
	} catch (error) {
		logger.warn('Copilot Chat activation unavailable; model picker refresh may be delayed', error);
	}
}
