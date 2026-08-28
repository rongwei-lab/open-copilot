import vscode from 'vscode';
import { EXTERNAL_URLS } from '../consts';
import { t } from '../i18n';
import { logger } from '../logger';
import { ensureRequestDumpRoot } from '../provider/debug';

export interface RuntimeCommandOptions {
	/** Force the provider/catalog to refresh. Falls back to a host re-query. */
	refreshModels?: () => void | Promise<void> | Thenable<void>;
}

/** Register user-facing New API commands. */
export function registerCommands(
	context: vscode.ExtensionContext,
	options: RuntimeCommandOptions = {},
): void {
	const showLogs = () => logger.show();
	const openDumps = () => openRequestDumpsFolder(context);
	const openApiDocs = () => vscode.env.openExternal(vscode.Uri.parse(EXTERNAL_URLS.newapi.apiKeys));
	const openSettings = () =>
		vscode.commands.executeCommand('workbench.action.openSettings', 'open-copilot');
	const refreshModels = options.refreshModels
		? async () => {
				await options.refreshModels?.();
			}
		: undefined;

	context.subscriptions.push(
		vscode.commands.registerCommand('open-copilot.showLogs', showLogs),
		vscode.commands.registerCommand('open-copilot.openRequestDumpsFolder', openDumps),
		vscode.commands.registerCommand('open-copilot.getApiKey', openApiDocs),
		vscode.commands.registerCommand('open-copilot.openSettings', openSettings),
		...(refreshModels
			? [vscode.commands.registerCommand('open-copilot.refreshModels', refreshModels)]
			: []),
	);
}

async function openRequestDumpsFolder(context: vscode.ExtensionContext): Promise<void> {
	try {
		const root = await ensureRequestDumpRoot(context.globalStorageUri);
		logger.info(`Opening request dumps folder: ${root.toString(true)}`);
		await vscode.commands.executeCommand('revealFileInOS', root);
	} catch (error) {
		logger.warn('Failed to open request dumps folder', error);
		void vscode.window.showErrorMessage(t('extension.openRequestDumpsFolderFailed'));
	}
}
