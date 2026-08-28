import vscode from 'vscode';
import { API_KEY_SECRET, CONFIG_SECTION } from './consts';
import { t } from './i18n';

/**
 * Manages the New API Bearer token.
 *
 * A value explicitly entered in the settings page is intentionally supported
 * for headless/CI setups and takes precedence so changing the setting actually
 * changes the active token. The command-palette flow remains the recommended
 * path because it stores the token in VS Code SecretStorage.
 */
export class AuthManager {
	private readonly secretStorage: vscode.SecretStorage;

	constructor(context: vscode.ExtensionContext) {
		this.secretStorage = context.secrets;
	}

	/**
	 * Get token. An explicitly configured setting wins so the settings-page
	 * value can replace an older SecretStorage token. SecretStorage is used when
	 * no setting value is present.
	 */
	async getApiKey(): Promise<string | undefined> {
		const configuredKey = this.getConfiguredApiKey();
		if (configuredKey) {
			return configuredKey;
		}

		const secretKey = await this.secretStorage.get(API_KEY_SECRET);
		if (secretKey?.trim()) {
			return secretKey.trim();
		}

		return undefined;
	}

	/**
	 * Store API key in SecretStorage.
	 */
	async setApiKey(apiKey: string): Promise<void> {
		await this.secretStorage.store(API_KEY_SECRET, apiKey.trim());
		// A stale plaintext setting would otherwise override the newly entered
		// SecretStorage value. Command-based setup should leave only the secure
		// copy behind.
		await this.clearConfiguredApiKeys();
	}

	/**
	 * Delete stored API key.
	 */
	async deleteApiKey(): Promise<void> {
		await this.secretStorage.delete(API_KEY_SECRET);
		await this.clearConfiguredApiKeys();
	}

	/** New API terminology aliases for callers that prefer token semantics. */
	getToken(): Promise<string | undefined> {
		return this.getApiKey();
	}

	setToken(token: string): Promise<void> {
		return this.setApiKey(token);
	}

	deleteToken(): Promise<void> {
		return this.deleteApiKey();
	}

	/**
	 * Check if an API key is configured.
	 */
	async hasApiKey(): Promise<boolean> {
		const key = await this.getApiKey();
		return key !== undefined && key.length > 0;
	}

	/**
	 * Prompt user to enter API key via input box.
	 */
	async promptForApiKey(): Promise<boolean> {
		const apiKey = await vscode.window.showInputBox({
			prompt: t('auth.prompt'),
			placeHolder: t('auth.placeholder'),
			password: true,
			ignoreFocusOut: true,
			validateInput: (value: string) => {
				if (!value?.trim()) {
					return t('auth.emptyValidation');
				}
				return undefined;
			},
		});

		if (apiKey) {
			await this.setApiKey(apiKey);
			vscode.window.showInformationMessage(t('auth.saved'));
			return true;
		}

		return false;
	}

	/** Read an explicitly configured key from the New API namespace. */
	private getConfiguredApiKey(): string | undefined {
		const candidate = vscode.workspace.getConfiguration(CONFIG_SECTION).get<string>('apiKey');
		return typeof candidate === 'string' && candidate.trim() ? candidate.trim() : undefined;
	}

	/** Remove the plaintext API-key setting after SecretStorage setup. */
	private async clearConfiguredApiKeys(): Promise<void> {
		// open-copilot.apiKey is machine-scoped, so VS Code only permits a
		// user/machine update.
		await vscode.workspace
			.getConfiguration(CONFIG_SECTION)
			.update('apiKey', undefined, vscode.ConfigurationTarget.Global);
	}
}
