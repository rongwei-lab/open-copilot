import type vscode from 'vscode';
import type { ModelCache, ModelCacheRecord } from './catalog';

/** VS Code globalState backed cache. The key contains only a token hash. */
export class GlobalStateModelCache implements ModelCache {
	constructor(
		private readonly state: vscode.Memento,
		readonly key: string,
	) {}

	async load(): Promise<ModelCacheRecord | undefined> {
		return this.state.get<ModelCacheRecord>(this.storageKey());
	}

	async save(record: ModelCacheRecord): Promise<void> {
		await this.state.update(this.storageKey(), record);
	}

	private storageKey(): string {
		return 'open-copilot.modelCatalog.' + this.key;
	}
}
