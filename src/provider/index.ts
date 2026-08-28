import vscode from 'vscode';
import { AuthManager } from '../auth';
import {
	getNewApiSettings,
	getStabilizeToolListEnabled,
	updateModelProfile,
	type ModelProfileSettings,
	type NewApiSettings,
} from '../config';
import { MODELS } from '../consts';
import { isOfficialDeepSeekBaseUrl } from '../endpoint';
import { isRecord, NewApiClient, stringAt } from '../newapi';
import {
	createModelCacheKey,
	createBuiltInModelRules,
	GlobalStateModelCache,
	ModelCatalog,
	ProfileResolver,
	toModelDefinition,
	runCompatibilityDiagnostics,
	runVisionCompatibilityProbe,
	type ModelProfile,
	type ModelRule,
	type ResolvedModel,
} from '../models';
import {
	createModelManagerProfilePatch,
	getResponseModel,
	parseModelManagerProfile,
	sanitizeModelManagerMessage,
	toModelManagerCatalogError,
	toModelManagerModel,
} from '../models/manager';
import { closeModelManagerPanel, openModelManagerPanel } from '../models/ui/panel';
import type { CompatibilityDiagnosticReport } from '../models/diagnostics';
import type {
	ModelManagerHealthResult,
	ModelManagerCompatibilityOptions,
	ModelManagerCompatibilityReport,
	ModelManagerPanelState,
	ModelManagerPanelStrings,
	ModelManagerTestResult,
	ModelManagerVisionProbe,
} from '../models/ui/types';
import { t } from '../i18n';
import { logger } from '../logger';
import { createCacheDiagnosticsRecorder, dumpProviderInput } from './debug';
import { toChatInfo } from './models';
import { BalanceCurrencyResolver } from './pricing/currency';
import { prepareChatRequest } from './request';
import { classifyProviderRequest } from './routing';
import { resolveConversationSegment } from './segment';
import { streamChatCompletion } from './stream';
import { estimateTokenCount } from './tokens';
import { processToolFlow } from './tools/flow';
import { createVisionService } from './vision';

const ACTIVE_MODEL_STATE_KEY = 'open-copilot.activeModelId';
const NATIVE_VISION_CHECKS_STATE_KEY = 'open-copilot.nativeVisionChecks';
// Bump this whenever the image/prompt or verification policy changes. The
// version is part of the persisted scope so an installed update rechecks old
// `warn` results instead of treating them as permanently authoritative.
const NATIVE_VISION_PROBE_VERSION = 2;
const NATIVE_VISION_RETRY_MS = 10 * 60_000;

type NativeVisionCheckStatus = 'pass' | 'warn' | 'fail' | 'skip';

interface NativeVisionCheckState {
	readonly status: NativeVisionCheckStatus;
	readonly checkedAt: number;
	readonly applied: boolean;
}

interface NativeVisionRefreshRequest {
	readonly catalog: ModelCatalog;
	readonly token: string;
	readonly settings: NewApiSettings;
	readonly forceModelIds: ReadonlySet<string>;
}

/**
 * DeepSeek Chat Provider — implements vscode.LanguageModelChatProvider so
 * DeepSeek V4 models appear directly in the Copilot Chat model picker.
 */
export class DeepSeekChatProvider implements vscode.LanguageModelChatProvider {
	private readonly authManager: AuthManager;
	private readonly globalStorageUri: vscode.Uri;
	private readonly onDidChangeLanguageModelChatInformationEmitter = new vscode.EventEmitter<void>();
	private isActive = true;

	readonly onDidChangeLanguageModelChatInformation =
		this.onDidChangeLanguageModelChatInformationEmitter.event;

	private readonly cacheDiagnostics = createCacheDiagnosticsRecorder();

	/** Vision proxy: internal bridge + VS Code LM fallback. */
	private readonly vision: ReturnType<typeof createVisionService>;
	private readonly balanceCurrencyResolver: BalanceCurrencyResolver;
	private catalog?: ModelCatalog;
	private catalogSignature?: string;
	private catalogChangeDisposable?: { dispose(): void };
	private nativeVisionRefreshQueue?: NativeVisionRefreshRequest;
	private nativeVisionRefreshFlight?: Promise<void>;
	private modelPickerRefreshTimer?: ReturnType<typeof setTimeout>;
	/**
	 * A catalog is normally created lazily when Copilot first asks for models.
	 * If the token or settings are changed while an existing chat keeps a
	 * host-side model snapshot, that request may never happen again. Keep a
	 * short, debounced refresh scheduled from configuration/focus events so the
	 * catalog (and its polling timer) is created immediately in that case.
	 */
	private catalogRefreshTimer?: ReturnType<typeof setTimeout>;
	private readonly context: vscode.ExtensionContext;
	/**
	 * The language-model manager invokes a management provider by resolving it
	 * with `silent: false`.  Keep a guard because saving a profile emits the
	 * provider-change event and can cause a second resolution while the
	 * interactive quick-pick is still open.
	 */
	private addModelFlowActive = false;

	/**
	 * Adaptive chars-per-token ratio, calibrated from actual usage data.
	 * Updated via exponential moving average each time the API reports real token counts.
	 */
	private charsPerToken = 4.0;

	constructor(context: vscode.ExtensionContext) {
		this.context = context;
		this.authManager = new AuthManager(context);
		this.globalStorageUri = context.globalStorageUri;
		this.vision = createVisionService(context);
		this.balanceCurrencyResolver = new BalanceCurrencyResolver(context, this.authManager, () =>
			this.refreshModelPicker(),
		);

		context.subscriptions.push(
			this.onDidChangeLanguageModelChatInformationEmitter,
			// Settings-based fallback API key + base URL changes.
			vscode.workspace.onDidChangeConfiguration((e) => {
				if (e.affectsConfiguration('open-copilot')) {
					this.invalidateCatalog('config');
					this.scheduleCatalogRefresh();
					void this.balanceCurrencyResolver
						.invalidate()
						.catch((error) => logger.warn('Failed to invalidate balance currency', error));
				}
			}),
			// Multi-window: SecretStorage changes don't fire onDidChangeConfiguration.
			// When another window sets/clears the API key, refresh this window's
			// model picker so the warning state stays in sync.
			context.secrets.onDidChange((e) => {
				if (e.key === 'open-copilot.apiKey') {
					this.invalidateCatalog('token');
					this.scheduleCatalogRefresh();
					void this.balanceCurrencyResolver
						.invalidate()
						.catch((error) => logger.warn('Failed to invalidate balance currency', error));
				}
			}),
			// Returning to a window is the common moment when a user has just
			// enabled/added a channel in New API. There is no server push event, so
			// use focus as a cheap immediate revalidation trigger in addition to the
			// bounded background poll owned by ModelCatalog.
			vscode.window.onDidChangeWindowState((event) => {
				if (event.focused) this.scheduleCatalogRefresh(0);
			}),
		);
	}

	// ---- Public commands ----

	async configureApiKey(): Promise<void> {
		const saved = await this.authManager.promptForApiKey();
		if (saved) {
			this.invalidateCatalog('token');
			this.scheduleCatalogRefresh(0);
			void this.balanceCurrencyResolver
				.invalidate()
				.catch((error) => logger.warn('Failed to invalidate balance currency', error));
		}
	}

	async clearApiKey(): Promise<void> {
		await this.authManager.deleteApiKey();
		this.invalidateCatalog('token');
		this.scheduleCatalogRefresh(0);
		void this.balanceCurrencyResolver
			.invalidate()
			.catch((error) => logger.warn('Failed to invalidate balance currency', error));
		vscode.window.showInformationMessage(t('auth.removed'));
	}

	async hasApiKey(): Promise<boolean> {
		return this.authManager.hasApiKey();
	}

	/** Open the extension-host model management center. */
	async openModelManager(): Promise<void> {
		openModelManagerPanel(this.context, {
			// Opening the manager is an explicit user request. Do not serve a
			// fifteen-minute-old `/models` cache on the first screen.
			getState: (signal) => this.getModelManagerState(true, signal),
			refresh: (signal) => this.refreshModelManager(signal),
			testConnection: (signal) => this.testNewApiConnection(signal),
			healthCheck: (modelId, signal) => this.healthCheckModel(modelId, signal),
			compatibilityCheck: (modelId, options, signal) =>
				this.runModelCompatibilityDiagnostics(modelId, options, signal),
			saveProfile: (modelId, profile, signal) =>
				this.saveModelManagerProfile(modelId, profile, signal),
			selectModel: (modelId) => this.selectNewApiModelById(modelId),
			onDidChange: (listener) =>
				this.onDidChangeLanguageModelChatInformationEmitter.event(listener),
			openSettings: async () => {
				await vscode.commands.executeCommand('workbench.action.openSettings', 'open-copilot');
			},
			strings: getModelManagerStrings(),
		});
	}

	/** Refresh the manager's catalog and return the resulting snapshot. */
	async refreshModelManager(signal?: AbortSignal): Promise<ModelManagerPanelState> {
		return this.getModelManagerState(true, signal);
	}

	/** Return a JSON-safe model manager snapshot; tokens never leave this method. */
	async getModelManagerState(force = false, signal?: AbortSignal): Promise<ModelManagerPanelState> {
		const settings = getNewApiSettings();
		const baseState = {
			baseUrl: sanitizeManagerBaseUrl(settings.baseUrl),
			hasApiKey: false,
			models: [],
			activeModelId: this.context.globalState.get<string>(ACTIVE_MODEL_STATE_KEY),
		};
		const token = await this.authManager.getApiKey();
		if (!token) {
			return {
				...baseState,
				error: {
					code: 'token_not_configured',
					message: t('modelManager.tokenNotConfigured'),
				},
			};
		}
		if (!settings.modelDiscovery.enabled) {
			return {
				...baseState,
				hasApiKey: true,
				error: {
					code: 'discovery_disabled',
					message: t('modelManager.discoveryDisabled'),
				},
			};
		}

		try {
			const catalog = this.getCatalog(token, settings);
			const models = await catalog.getModels({ force, allowStale: true, signal });
			// Do not hold the model directory behind one or more potentially slow
			// image probes. The catalog is useful as soon as `/models` returns; a
			// completed probe persists the Profile and emits another provider/panel
			// change event, which updates the capability badges asynchronously.
			void this.autoRefreshNewModelVision(catalog, token, settings).catch((error) =>
				logger.warn('Automatic native vision refresh failed', error),
			);
			const snapshot = catalog.getSnapshotInfo();
			const visionProbeState = readNativeVisionCheckState(
				this.context.globalState.get<unknown>(NATIVE_VISION_CHECKS_STATE_KEY),
			);
			return {
				baseUrl: sanitizeManagerBaseUrl(settings.baseUrl),
				hasApiKey: true,
				fetchedAt: snapshot.fetchedAt,
				stale: snapshot.stale || models.some((model) => model.source.fromStaleCache),
				models: models.map((model) =>
					toModelManagerModel(
						model,
						settings.modelProfiles[model.id],
						toManagerVisionProbe(
							visionProbeState,
							createNativeVisionCheckScope(settings, token, model.id),
						),
					),
				),
				activeModelId: this.context.globalState.get<string>(ACTIVE_MODEL_STATE_KEY),
				error: snapshot.lastError
					? {
							code: snapshot.lastError.code,
							message: sanitizeModelManagerMessage(snapshot.lastError.message, token),
							retryable: true,
						}
					: undefined,
			};
		} catch (error) {
			return {
				...baseState,
				hasApiKey: true,
				error: toModelManagerCatalogError(error, t('modelManager.connection.failed'), token),
			};
		}
	}

	/** Force a direct `/models` request and return connection diagnostics. */
	async testNewApiConnection(signal?: AbortSignal): Promise<ModelManagerTestResult> {
		const startedAt = Date.now();
		const settings = getNewApiSettings();
		const token = await this.authManager.getApiKey();
		if (!token) {
			return {
				ok: false,
				latencyMs: Date.now() - startedAt,
				message: t('modelManager.tokenNotConfigured'),
			};
		}
		try {
			const client = this.createNewApiClient(settings, token);
			const remoteModels = await client.listModels(signal);
			const endpointTypes = [
				...new Set(remoteModels.flatMap((model) => model.supportedEndpointTypes)),
			];
			return {
				ok: true,
				latencyMs: Date.now() - startedAt,
				modelCount: remoteModels.length,
				endpointTypes,
				message: t('modelManager.connection.connected'),
			};
		} catch (error) {
			const detail = toModelManagerCatalogError(error, t('modelManager.connection.failed'), token);
			return {
				ok: false,
				latencyMs: Date.now() - startedAt,
				status: detail.status,
				requestId: detail.requestId,
				message: detail.message,
			};
		}
	}

	/** Run one bounded, fixed-prompt request against the selected model. */
	async healthCheckModel(modelId: string, signal?: AbortSignal): Promise<ModelManagerHealthResult> {
		const startedAt = Date.now();
		const settings = getNewApiSettings();
		const token = await this.authManager.getApiKey();
		const checkedAt = Date.now();
		if (!token) {
			return {
				modelId,
				ok: false,
				latencyMs: Date.now() - startedAt,
				message: t('modelManager.tokenNotConfigured'),
				checkedAt,
			};
		}

		try {
			const catalog = this.getCatalog(token, settings);
			const models = await catalog.getModels({ allowStale: true, signal });
			const model = models.find(
				(candidate) => candidate.id === modelId || candidate.apiModelId === modelId,
			);
			if (!model) {
				return {
					modelId,
					ok: false,
					latencyMs: Date.now() - startedAt,
					message: t('modelManager.modelNotFound'),
					checkedAt,
				};
			}

			const client = this.createNewApiClient(settings, token);
			const isResponses = model.selectedProtocol === 'responses';
			const path = isResponses ? '/responses' : '/chat/completions';
			const body = isResponses
				? {
						model: model.apiModelId,
						input: 'Reply with exactly OK.',
						max_output_tokens: 4,
						stream: false,
						store: false,
					}
				: {
						model: model.apiModelId,
						messages: [{ role: 'user', content: 'Reply with exactly OK.' }],
						[model.profile.maxTokensField ?? 'max_tokens']: 4,
						stream: false,
					};
			const response = await client.request(path, {
				method: 'POST',
				headers: {
					Accept: 'application/json',
					'Content-Type': 'application/json',
				},
				body: JSON.stringify(body),
				signal,
			});
			const responseBody = await readLimitedJson(response, 64 * 1024);
			const businessError = getHealthBusinessError(responseBody);
			if (businessError) {
				return {
					modelId: model.id,
					ok: false,
					latencyMs: Date.now() - startedAt,
					status: response.status,
					protocol: model.selectedProtocol,
					message: businessError,
					checkedAt: Date.now(),
				};
			}
			return {
				modelId: model.id,
				ok: true,
				latencyMs: Date.now() - startedAt,
				status: response.status,
				protocol: model.selectedProtocol,
				responseModel: getResponseModel(responseBody),
				checkedAt: Date.now(),
			};
		} catch (error) {
			const detail = toModelManagerCatalogError(error, t('modelManager.health.failed'), token);
			return {
				modelId,
				ok: false,
				latencyMs: Date.now() - startedAt,
				status: detail.status,
				requestId: detail.requestId,
				message: detail.message,
				checkedAt: Date.now(),
			};
		}
	}

	/** Run bounded compatibility probes without replaying the current chat. */
	async runModelCompatibilityDiagnostics(
		modelId: string,
		options: ModelManagerCompatibilityOptions = {},
		signal?: AbortSignal,
	): Promise<ModelManagerCompatibilityReport> {
		const settings = getNewApiSettings();
		const token = await this.authManager.getApiKey();
		if (!token) throw new Error(t('modelManager.tokenNotConfigured'));
		const models = await this.getCatalog(token, settings).getModels({ allowStale: true, signal });
		const model = models.find(
			(candidate) => candidate.id === modelId || candidate.apiModelId === modelId,
		);
		if (!model) throw new Error(t('modelManager.modelNotFound'));
		const report = await runCompatibilityDiagnostics({
			client: this.createNewApiClient(settings, token),
			model,
			signal,
			// A diagnostic consists of several bounded probes. Cap each probe so a
			// single unavailable channel cannot keep the manager busy for minutes.
			timeoutMs: Math.min(settings.requestTimeoutMs, 30_000),
			includeOptional: options.includeOptional === true,
			includeVision: options.includeVision === true,
		});

		// The visual probe is an explicit user action. When it verifies image
		// content (rather than merely receiving an image-shaped request), persist
		// native image input so VS Code can pass future attachments to this model.
		// A previously saved `proxy`/`nativeImageInput: false` value is commonly
		// left over from the pre-verification fallback. The verified probe is the
		// stronger, model-specific signal, so it is allowed to correct that value.
		// `none` never reaches this branch because the probe is skipped for a
		// deliberately disabled model.
		const visionCheck = report.checks.find((check) => check.id === 'vision');
		const canAutoPromoteVision =
			options.includeVision === true &&
			visionCheck?.status === 'pass' &&
			model.selectedProtocol === 'chat-completions' &&
			model.capabilities.imageMode !== 'native';
		let visionProfileApplied = false;
		let visionProfileError: string | undefined;
		if (canAutoPromoteVision) {
			try {
				await updateModelProfile(model.id, {
					imageMode: 'native',
					nativeImageInput: true,
				});
				visionProfileApplied = true;
				this.invalidateCatalog('config');
				this.refreshModelPicker();
				logger.info(`Native vision enabled for ${model.id} after a verified probe`);
				const updatedReport = {
					...report,
					checks: report.checks.map((check) =>
						check.id === 'vision'
							? {
									...check,
									message:
										(check.message ?? 'Native image input verified.') +
										` ${t('modelManager.compatibility.nativeApplied')}`,
								}
							: check,
					),
				};
				const managerReport = toModelManagerCompatibilityReport(updatedReport, token);
				return {
					...managerReport,
					visionProfileApplied: true,
				};
			} catch (error) {
				// A passing probe is still useful if configuration persistence fails,
				// but expose the failure in the report. Previously this was only logged,
				// which looked like a successful test while the picker stayed text-only.
				logger.warn(`Unable to persist native vision profile for ${model.id}`, error);
				visionProfileError = sanitizeModelManagerMessage(
					error instanceof Error
						? error.message
						: t('modelManager.compatibility.nativeApplyFailed'),
					token,
				);
			}
		}

		const managerReport = toModelManagerCompatibilityReport(report, token);
		return {
			...managerReport,
			visionProfileApplied,
			visionProfileError,
		};
	}

	/** Save only validated, editable Profile fields for a discovered model. */
	async saveModelManagerProfile(
		modelId: string,
		value: Readonly<Record<string, unknown>>,
		signal?: AbortSignal,
	): Promise<ModelManagerPanelState> {
		const settings = getNewApiSettings();
		const token = await this.authManager.getApiKey();
		if (!token) throw new Error(t('modelManager.tokenNotConfigured'));
		const models = await this.getCatalog(token, settings).getModels({ allowStale: true, signal });
		const model = models.find(
			(candidate) => candidate.id === modelId || candidate.apiModelId === modelId,
		);
		if (!model) throw new Error(t('modelManager.modelNotFound'));
		const parsed = parseModelManagerProfile(value);
		await updateModelProfile(model.id, createModelManagerProfilePatch(parsed));
		this.invalidateCatalog('config');
		this.refreshModelPicker();
		return this.getModelManagerState(false, signal);
	}

	/** Select an exact New API model by ID from the model manager. */
	async selectNewApiModelById(modelId: string): Promise<void> {
		const token = await this.authManager.getApiKey();
		if (!token) throw new Error(t('modelManager.tokenNotConfigured'));
		const settings = getNewApiSettings();
		let family: string | undefined;
		let label = modelId;
		if (settings.modelDiscovery.enabled) {
			const models = await this.getCatalog(token, settings).getModels({ allowStale: true });
			const model = models.find(
				(candidate) => candidate.id === modelId || candidate.apiModelId === modelId,
			);
			if (!model) throw new Error(t('modelManager.modelNotFound'));
			family = model.family;
			label = model.displayName;
		} else {
			const legacy = MODELS.find((model) => model.id === modelId);
			family = legacy?.family;
			label = legacy?.name ?? modelId;
		}
		await this.selectPublishedNewApiModel(modelId, family, label);
	}

	/** Force Copilot Chat to re-query model information (including configurationSchema). */
	refreshModelPicker(): void {
		this.onDidChangeLanguageModelChatInformationEmitter.fire();
		// The change event is the supported invalidation signal, but some Copilot
		// builds keep a second in-memory model snapshot. A debounced selector query
		// warms that snapshot as well, so a newly verified visual capability appears
		// without requiring a window reload. The debounce prevents profile updates
		// from causing a query storm when configuration listeners fire twice.
		if (this.modelPickerRefreshTimer !== undefined) return;
		this.modelPickerRefreshTimer = setTimeout(() => {
			this.modelPickerRefreshTimer = undefined;
			if (!this.isActive) return;
			void Promise.resolve(vscode.lm.selectChatModels({ vendor: 'open-copilot' })).catch(
				(error: unknown) => {
					logger.debug('Copilot model snapshot refresh was unavailable', error);
				},
			);
		}, 50);
	}

	private invalidateCatalog(_reason: 'token' | 'baseUrl' | 'config' | 'manual'): void {
		// Dispose the old catalog rather than only invalidating its in-memory view.
		// Catalogs now have a background timer; retaining one after a token/base URL
		// change would let that timer continue using the old client closure.
		this.catalog?.dispose();
		this.catalog = undefined;
		this.catalogChangeDisposable?.dispose();
		this.catalogChangeDisposable = undefined;
		this.catalogSignature = undefined;
		this.refreshModelPicker();
	}

	/**
	 * Start (or coalesce) an immediate catalog refresh after local state changes.
	 * This is deliberately separate from ModelCatalog's steady-state poll: the
	 * poll cannot exist until a catalog has been constructed, while a newly
	 * entered token/configuration may arrive before Copilot asks for models.
	 */
	private scheduleCatalogRefresh(delayMs = 250): void {
		if (!this.isActive || this.catalogRefreshTimer !== undefined) return;
		this.catalogRefreshTimer = setTimeout(
			() => {
				this.catalogRefreshTimer = undefined;
				if (!this.isActive) return;
				void this.refreshModels().catch((error) => {
					logger.warn('Scheduled New API model refresh failed', error);
				});
			},
			Math.max(0, delayMs),
		);
	}

	/** Force a remote `/v1/models` refresh and notify Copilot Chat. */
	async refreshModels(): Promise<void> {
		const token = await this.authManager.getApiKey();
		if (!token) {
			this.refreshModelPicker();
			return;
		}
		const settings = getNewApiSettings();
		if (!settings.modelDiscovery.enabled) {
			this.refreshModelPicker();
			return;
		}
		try {
			const catalog = this.getCatalog(token, settings);
			const models = await catalog.refresh();
			await this.autoRefreshNewModelVision(catalog, token, settings);
			const snapshot = catalog.getSnapshotInfo();
			logger.info(
				`New API model catalog refreshed: ${models.length} model(s) at ${snapshot.fetchedAt ? new Date(snapshot.fetchedAt).toISOString() : 'unknown'}`,
			);
		} catch (error) {
			logger.warn('Failed to refresh New API model catalog', error);
		}
		this.refreshModelPicker();
	}

	/**
	 * Probe newly discovered image-capable Chat models once in the background.
	 *
	 * The model manager previously only refreshed `/v1/models`; that endpoint
	 * usually does not declare native image support. Persisting the result by
	 * catalog/profile scope lets a new model be tested automatically without
	 * charging for the same image probe on every picker refresh.
	 */
	private autoRefreshNewModelVision(
		catalog: ModelCatalog,
		token: string,
		settings: NewApiSettings,
		forceModelIds: readonly string[] = [],
	): Promise<void> {
		// `proxy`/`native`/`none` are explicit user choices. Automatic probing is
		// intentionally limited to `auto`; a global proxy setting must never be
		// silently promoted to native by a background request.
		if (settings.visionMode !== 'auto' || this.catalog !== catalog) return Promise.resolve();

		const previous = this.nativeVisionRefreshQueue;
		if (previous?.catalog === catalog && previous.token === token) {
			const mergedForceIds = new Set(previous.forceModelIds);
			for (const modelId of forceModelIds) {
				if (modelId.trim()) mergedForceIds.add(modelId);
			}
			this.nativeVisionRefreshQueue = {
				catalog,
				token,
				settings,
				forceModelIds: mergedForceIds,
			};
		} else {
			this.nativeVisionRefreshQueue = {
				catalog,
				token,
				settings,
				forceModelIds: new Set(forceModelIds.filter((modelId) => modelId.trim())),
			};
		}

		if (!this.nativeVisionRefreshFlight) {
			const flight = this.drainNativeVisionRefreshQueue();
			this.nativeVisionRefreshFlight = flight;
			void flight.then(
				() => this.finishNativeVisionRefreshFlight(flight),
				() => this.finishNativeVisionRefreshFlight(flight),
			);
		}
		return this.nativeVisionRefreshFlight;
	}

	/** Drain queued catalog generations so a stale probe cannot swallow a new model. */
	private async drainNativeVisionRefreshQueue(): Promise<void> {
		for (;;) {
			const request = this.nativeVisionRefreshQueue;
			if (!request) return;
			this.nativeVisionRefreshQueue = undefined;
			if (this.catalog === request.catalog) {
				await this.autoRefreshNewModelVisionInternal(
					request.catalog,
					request.token,
					request.settings,
					request.forceModelIds,
				);
			}
			// Let a catalog listener enqueue a request after a stale-while-revalidate
			// refresh before deciding that the queue is empty.
			await Promise.resolve();
		}
	}

	private finishNativeVisionRefreshFlight(flight: Promise<void>): void {
		if (this.nativeVisionRefreshFlight !== flight) return;
		this.nativeVisionRefreshFlight = undefined;
		// A listener can enqueue a request in the final microtask of the drain.
		// Start it immediately rather than leaving it stranded until the next TTL.
		if (this.nativeVisionRefreshQueue) {
			const next = this.drainNativeVisionRefreshQueue();
			this.nativeVisionRefreshFlight = next;
			void next.then(
				() => this.finishNativeVisionRefreshFlight(next),
				() => this.finishNativeVisionRefreshFlight(next),
			);
		}
	}

	private async autoRefreshNewModelVisionInternal(
		catalog: ModelCatalog,
		token: string,
		settings: NewApiSettings,
		forceModelIds: ReadonlySet<string> = new Set(),
	): Promise<void> {
		if (settings.visionMode !== 'auto' || this.catalog !== catalog) return;
		const models = await catalog.getModels({ allowStale: true });
		if (this.catalog !== catalog) return;

		const state = readNativeVisionCheckState(
			this.context.globalState.get<unknown>(NATIVE_VISION_CHECKS_STATE_KEY),
		);
		const candidates = models.filter(
			(model) =>
				model.selectedProtocol === 'chat-completions' &&
				model.capabilities.imageMode !== 'none' &&
				model.capabilities.imageMode !== 'native' &&
				// A concrete Profile/rule is an explicit user decision. Only models
				// still inheriting the resolver's `auto` mode are eligible for silent
				// promotion after a successful probe.
				(model.profile.imageMode === undefined || model.profile.imageMode === 'auto') &&
				model.profile.nativeImageInput === undefined,
		);
		const pending = candidates.filter((model) => {
			const stateKey = createNativeVisionCheckScope(settings, token, model.id);
			const previous = state[stateKey];
			if (forceModelIds.has(model.id)) return true;
			if (!previous) return true;
			if (previous.status === 'pass' && !previous.applied) return true;
			return (
				(previous.status === 'warn' || previous.status === 'fail') &&
				Date.now() - previous.checkedAt >= NATIVE_VISION_RETRY_MS
			);
		});
		if (pending.length === 0) return;

		logger.info(`Automatic native vision probe queued for ${pending.length} model(s)`);
		let profileChanged = false;
		for (const model of pending) {
			const stateKey = createNativeVisionCheckScope(settings, token, model.id);
			let status: NativeVisionCheckStatus = 'fail';
			let applied = false;
			try {
				const check = await runVisionCompatibilityProbe({
					client: this.createNewApiClient(settings, token),
					model,
					timeoutMs: Math.min(settings.requestTimeoutMs, 30_000),
					includeVision: true,
				});
				status = check.status;
				if (check.status === 'pass') {
					try {
						await updateModelProfile(model.id, {
							imageMode: 'native',
							nativeImageInput: true,
						});
						applied = true;
						profileChanged = true;
						logger.info(`Native vision enabled for newly discovered model ${model.id}`);
					} catch (error) {
						logger.warn(`Unable to save native vision profile for ${model.id}`, error);
					}
				}
			} catch (error) {
				logger.warn(`Automatic native vision probe failed for ${model.id}`, error);
			}
			state[stateKey] = { status, checkedAt: Date.now(), applied };
			if (applied) {
				// Applying native vision changes the exact Profile and therefore the
				// scope hash. Mirror the result under the post-write scope so the model
				// manager can show “verified” immediately after the catalog is rebuilt.
				const updatedSettings = getNewApiSettings();
				state[createNativeVisionCheckScope(updatedSettings, token, model.id)] = {
					status,
					checkedAt: state[stateKey].checkedAt,
					applied,
				};
			}
			logger.info(`Automatic native vision result for ${model.id}: ${status}`);
		}

		try {
			// Re-read before writing so a second VS Code window cannot overwrite a
			// check completed by the other window while this request was in flight.
			const latestState = readNativeVisionCheckState(
				this.context.globalState.get<unknown>(NATIVE_VISION_CHECKS_STATE_KEY),
			);
			await this.context.globalState.update(NATIVE_VISION_CHECKS_STATE_KEY, {
				...latestState,
				...state,
			});
		} catch (error) {
			logger.warn('Unable to persist automatic native vision probe state', error);
		}
		// Warn/fail is still a meaningful state transition. Notify both the picker
		// and the model manager so the UI can say “checked, not verified” instead
		// of looking as if no refresh happened.
		this.refreshModelPicker();
		if (profileChanged) {
			// A configuration listener may already have invalidated the catalog while
			// updateModelProfile was writing. Only invalidate the old instance here.
			if (this.catalog === catalog) this.invalidateCatalog('config');
			this.refreshModelPicker();
		}
	}

	/**
	 * Select a model from this extension and make it the active Copilot Chat
	 * model.  This command is intentionally explicit: Copilot remembers the
	 * last `customendpoint/...` model independently of this provider, and that
	 * route can fail with a GitHub subscription error before New API is reached.
	 */
	async selectNewApiModel(): Promise<void> {
		let token = await this.authManager.getApiKey();
		if (!token) {
			await this.configureApiKey();
			token = await this.authManager.getApiKey();
		}
		if (!token) return;

		const settings = getNewApiSettings();
		let models: ResolvedModel[] = [];
		let discoveryFailed = false;
		if (settings.modelDiscovery.enabled) {
			try {
				models = await this.getCatalog(token, settings).getModels({ allowStale: true });
			} catch (error) {
				discoveryFailed = true;
				logger.warn('Unable to load New API models for the model picker', error);
			}
		}

		// When dynamic discovery is enabled, never present the legacy DeepSeek
		// compatibility list as if it came from New API. That list can point at
		// models the gateway does not expose and is a common cause of wrong
		// context limits or Copilot subscription errors. The compatibility list
		// remains available only when discovery is explicitly disabled.
		const items: NewApiModelPickerItem[] = settings.modelDiscovery.enabled
			? models.map(toNewApiModelPickerItem)
			: MODELS.map((model) => ({
					label: model.name,
					description: `${model.family} · ${model.id}`,
					detail: model.detail,
					modelId: model.id,
					family: model.family,
				}));
		if (items.length === 0) {
			void vscode.window.showWarningMessage(
				discoveryFailed
					? t('extension.selectModel.discoveryFailed')
					: t('extension.selectModel.failed'),
			);
			return;
		}

		if (discoveryFailed) {
			void vscode.window.showWarningMessage(t('extension.selectModel.discoveryFailed'));
		}
		const selected = await vscode.window.showQuickPick(items, {
			placeHolder: t('extension.selectModel.placeholder'),
			matchOnDescription: true,
			matchOnDetail: true,
		});
		if (!selected) return;

		try {
			await this.selectPublishedNewApiModel(selected.modelId, selected.family, selected.label);
		} catch (error) {
			logger.warn('Unable to switch the active Copilot Chat model', error);
			void vscode.window.showWarningMessage(t('extension.selectModel.failed'));
		}
	}

	/**
	 * Add an exact model profile from the discovered catalog.
	 *
	 * VS Code's built-in model manager can only select a language model; it has
	 * no API for editing the provider's `capabilities.toolCalling` metadata.
	 * This command is the small, explicit bridge: the user picks a New API
	 * model, confirms whether its upstream channel accepts tools, and the
	 * answer is persisted as `modelProfiles.<id>.toolCalling`.  The normal
	 * provider refresh then republishes the model with the Agent capability.
	 */
	async addModelProfile(vendor?: string): Promise<void> {
		await this.addModelProfileInternal(vendor, true);
	}

	/**
	 * Run the profile flow without issuing a second provider notification. This
	 * is used by the native VS Code "Add Model" action, whose resolution pass
	 * receives the refreshed catalog after the management command returns.
	 */
	private async addModelProfileInternal(
		vendor: string | undefined,
		refreshAfterSave: boolean,
	): Promise<void> {
		if (vendor && vendor !== 'open-copilot') return;
		let token = await this.authManager.getApiKey();
		if (!token) {
			await this.configureApiKey();
			token = await this.authManager.getApiKey();
		}
		if (!token) return;

		const settings = getNewApiSettings();
		if (!settings.modelDiscovery.enabled) {
			void vscode.window.showWarningMessage(t('extension.addModel.discoveryDisabled'));
			return;
		}

		let models: ResolvedModel[];
		try {
			// An explicit Add Model action should see models just enabled in New API;
			// the catalog still falls back to its last good cache if this refresh fails.
			models = await this.getCatalog(token, settings).getModels({ force: true });
		} catch (error) {
			logger.warn('Unable to load New API models for profile configuration', error);
			void vscode.window.showWarningMessage(t('extension.addModel.discoveryFailed'));
			return;
		}
		if (models.length === 0) {
			void vscode.window.showWarningMessage(t('extension.addModel.noModels'));
			return;
		}

		const selected = await vscode.window.showQuickPick(models.map(toNewApiModelPickerItem), {
			placeHolder: t('extension.addModel.placeholder'),
			matchOnDescription: true,
			matchOnDetail: true,
		});
		if (!selected) return;

		const model = models.find((candidate) => candidate.id === selected.modelId);
		if (!model) {
			void vscode.window.showWarningMessage(t('extension.addModel.noModels'));
			return;
		}

		const existing = settings.modelProfiles[model.id];
		const current = existing?.toolCalling ?? model.capabilities.toolCalling;
		const choices: ModelToolCallingChoice[] = [
			{
				label: t('extension.addModel.enableTools'),
				description: t('extension.addModel.enableToolsDescription'),
				enabled: true,
			},
			{
				label: t('extension.addModel.disableTools'),
				description: t('extension.addModel.disableToolsDescription'),
				enabled: false,
			},
		];
		const choice = await vscode.window.showQuickPick(choices, {
			placeHolder: t('extension.addModel.toolCallingPlaceholder', current ? 'true' : 'false'),
		});
		if (!choice) return;

		try {
			await updateModelProfile(model.id, {
				// Selecting a model through an explicit Add Model action is an
				// affirmative enable operation, even if an older profile disabled it.
				enabled: true,
				toolCalling: choice.enabled,
				// Parallel calls are opt-in. Explicitly disable them when the model is
				// marked text-only so a previous profile cannot leak the flag back in.
				parallelToolCalls: choice.enabled
					? settings.modelProfiles[model.id]?.parallelToolCalls
					: false,
			});
		} catch (error) {
			logger.warn(`Unable to save model profile for ${model.id}`, error);
			void vscode.window.showErrorMessage(t('extension.addModel.saveFailed'));
			return;
		}

		// Configuration change listeners also invalidate the catalog, but doing it
		// here makes the command deterministic even in hosts that batch events.
		// Then force one `/v1/models` request so the just-added model's protocol,
		// tool, reasoning, vision, and context metadata is resolved immediately.
		// A separate, explicit visual probe below verifies native image input.
		this.invalidateCatalog('config');
		let capabilitiesRefreshed = false;
		let nativeVisionApplied = false;
		let nativeVisionCheckAttempted = false;
		let refreshedModel: ResolvedModel | undefined;
		try {
			refreshedModel = await this.refreshAddedModelCapabilities(model.id);
			capabilitiesRefreshed = refreshedModel !== undefined;
		} catch (error) {
			// The Profile write succeeded even if the gateway is temporarily
			// unavailable. Keep the saved configuration and let the normal catalog
			// refresh retry later instead of turning a successful add into a failure.
			logger.warn(`Unable to refresh capabilities for added model ${model.id}`, error);
		}

		// A model that is allowed to receive images gets one explicit visual probe
		// as part of the Add Model flow. The probe sends a tiny test image and only
		// promotes the Profile to native vision after the code is actually read.
		// Models explicitly configured as text-only, or Responses-only models that
		// the current probe cannot test, are left unchanged.
		if (
			refreshedModel &&
			refreshedModel.selectedProtocol === 'chat-completions' &&
			refreshedModel.capabilities.imageMode !== 'none'
		) {
			nativeVisionCheckAttempted = true;
			try {
				const report = await this.runModelCompatibilityDiagnostics(model.id, {
					includeVision: true,
				});
				nativeVisionApplied = report.visionProfileApplied === true;
			} catch (error) {
				// Keep the model and its saved tool Profile usable if a diagnostic
				// request times out or the upstream channel rejects image input.
				logger.warn(`Unable to run native vision probe for added model ${model.id}`, error);
			}
		}

		// The native management flow receives a follow-up model resolution from
		// VS Code; the command flow needs an explicit provider notification.
		if (refreshAfterSave) this.refreshModelPicker();
		if (nativeVisionApplied) {
			void vscode.window.showInformationMessage(
				t(
					'extension.addModel.nativeVisionVerified',
					model.displayName,
					choice.enabled ? 'true' : 'false',
				),
			);
		} else if (nativeVisionCheckAttempted) {
			void vscode.window.showWarningMessage(
				t('extension.addModel.nativeVisionNotVerified', model.displayName),
			);
		} else if (capabilitiesRefreshed) {
			void vscode.window.showInformationMessage(
				t(
					'extension.addModel.capabilitiesRefreshed',
					model.displayName,
					choice.enabled ? 'true' : 'false',
				),
			);
		} else {
			void vscode.window.showWarningMessage(
				t('extension.addModel.capabilitiesRefreshFailed', model.displayName),
			);
		}
	}

	/**
	 * Re-fetch and resolve the catalog after a model Profile is added.
	 *
	 * A configuration change invalidates the old resolver/cache signature, but
	 * that alone only schedules a future refresh when Copilot asks for models.
	 * Waiting for one forced refresh here makes the Add Model operation's result
	 * deterministic and keeps the model manager in sync with the saved Profile.
	 */
	private async refreshAddedModelCapabilities(modelId: string): Promise<ResolvedModel | undefined> {
		const token = await this.authManager.getApiKey();
		if (!token) return undefined;
		const settings = getNewApiSettings();
		if (!settings.modelDiscovery.enabled) return undefined;

		const catalog = this.getCatalog(token, settings);
		const models = await catalog.refresh();
		const refreshed = models.find((model) => model.id === modelId || model.apiModelId === modelId);
		if (!refreshed) {
			throw new Error(`Added model ${modelId} is not present in the refreshed catalog`);
		}
		return refreshed;
	}

	async prepareForDeactivate(): Promise<void> {
		this.isActive = false;
		if (this.modelPickerRefreshTimer !== undefined) {
			clearTimeout(this.modelPickerRefreshTimer);
			this.modelPickerRefreshTimer = undefined;
		}
		if (this.catalogRefreshTimer !== undefined) {
			clearTimeout(this.catalogRefreshTimer);
			this.catalogRefreshTimer = undefined;
		}
		closeModelManagerPanel();
		this.catalog?.dispose();
		this.catalogChangeDisposable?.dispose();
		this.onDidChangeLanguageModelChatInformationEmitter.fire();

		// Force the host to re-pull `provideLanguageModelChatInformation` synchronously
		// before the extension unloads. With `isActive = false` we now return [],
		// which makes Copilot Chat drop New API models from the picker immediately
		// instead of leaving stale entries behind after deactivate. The returned
		// model list itself is unused — we only call this for its side effect.
		try {
			await vscode.lm.selectChatModels({ vendor: 'open-copilot' });
		} catch (error) {
			logger.warn('Failed to refresh New API models during deactivate', error);
		}
	}

	async setVisionModel(): Promise<void> {
		await this.vision.openConfiguration();
	}

	// ---- LanguageModelChatProvider ----

	async provideLanguageModelChatInformation(
		_options: vscode.PrepareLanguageModelChatModelOptions,
		token: vscode.CancellationToken,
	): Promise<vscode.LanguageModelChatInformation[]> {
		if (!this.isActive) {
			return [];
		}

		/**
		 * VS Code 1.116's built-in model manager implements the provider
		 * `managementCommand` by calling this method with `silent: false`; it does
		 * not execute the command contribution itself.  Bridge that non-silent
		 * resolution to our dynamic New API picker so clicking
		 * "Add Model → Open Copilot" immediately adds/configures a model. Ordinary
		 * model refreshes use `silent: true` and remain non-interactive.
		 */
		// `configuration`/`group` are currently not in the stable d.ts type, but
		// VS Code passes them for provider-group migrations.  Do not open an
		// add-model picker while resolving one of those persisted groups.
		const providerOptions = _options as vscode.PrepareLanguageModelChatModelOptions & {
			readonly group?: string;
			readonly configuration?: unknown;
		};
		const isManagementResolution =
			_options.silent === false &&
			providerOptions.group === undefined &&
			providerOptions.configuration === undefined;
		if (isManagementResolution && !this.addModelFlowActive) {
			this.addModelFlowActive = true;
			try {
				await this.addModelProfileInternal('open-copilot', false);
			} finally {
				this.addModelFlowActive = false;
			}
		}

		const hasKey = await this.authManager.hasApiKey();
		const pricingCurrency = this.balanceCurrencyResolver.getDisplayCurrency();
		if (hasKey) this.balanceCurrencyResolver.refreshInBackground();
		const settings = getNewApiSettings();
		// Dynamic discovery is authoritative while enabled.  Publishing the legacy
		// DeepSeek compatibility list before a New API token exists makes those
		// entries look like real gateway models (with the wrong context and route),
		// and can send Copilot into its unrelated customendpoint subscription path.
		// Keep the legacy list only as an explicit opt-out for discovery.
		if (!settings.modelDiscovery.enabled) {
			return MODELS.map((model) => toChatInfo(model, hasKey, pricingCurrency));
		}
		if (!hasKey) return [];

		const apiKey = await this.authManager.getApiKey();
		if (!apiKey) return [];
		try {
			const cancellation = cancellationSignal(token);
			const catalog = this.getCatalog(apiKey, settings);
			let models: ResolvedModel[];
			try {
				models = await catalog.getModels({
					allowStale: true,
					signal: cancellation.signal,
				});
			} finally {
				cancellation.dispose();
			}
			// Keep model publication fast; the one-time image probe runs in the
			// background and emits another provider-change event when it promotes a
			// newly discovered model to native vision.
			void this.autoRefreshNewModelVision(catalog, apiKey, settings).catch((error) =>
				logger.warn('Background native vision refresh failed', error),
			);
			if (models.length > 0) {
				return models.map((model) => toChatInfo(toModelDefinition(model), true));
			}
		} catch (error) {
			logger.warn('New API model discovery failed; publishing no dynamic models', error);
		}
		// Dynamic discovery is authoritative while enabled. If the gateway is
		// unavailable or resolves no compatible chat model, return an empty list so
		// Copilot cannot silently retain a stale DeepSeek-only fallback.
		return [];
	}

	async provideLanguageModelChatResponse(
		modelInfo: vscode.LanguageModelChatInformation,
		messages: readonly vscode.LanguageModelChatRequestMessage[],
		options: vscode.ProvideLanguageModelChatResponseOptions,
		progress: vscode.Progress<vscode.LanguageModelResponsePart>,
		token: vscode.CancellationToken,
	): Promise<void> {
		const segment = resolveConversationSegment(messages);
		const requestKind = classifyProviderRequest({
			messages,
			tools: options.tools,
		});

		dumpProviderInput({
			globalStorageUri: this.globalStorageUri,
			segment,
			modelInfo,
			messages,
			requestOptions: options,
			requestKind,
		});

		const toolFlow = processToolFlow({
			stabilizeToolList: getStabilizeToolListEnabled(),
			messages,
			tools: options.tools,
			progress,
			requestKind,
		});
		if (toolFlow.preflightHandled) {
			return;
		}

		const settings = getNewApiSettings();
		const resolvedModel = await this.resolveModelForRequest(modelInfo.id, settings, token);

		const prepared = await prepareChatRequest({
			authManager: this.authManager,
			globalStorageUri: this.globalStorageUri,
			modelInfo,
			segment,
			messages: toolFlow.messages,
			options,
			token,
			cacheDiagnostics: this.cacheDiagnostics,
			getVisionDescriber: () => this.vision.get(),
			resolvedModel,
			settings,
		});

		return streamChatCompletion({
			prepared,
			progress,
			token,
			initialResponseNotice: joinInitialResponseNotices(
				toolFlow.initialResponseNotice,
				prepared.initialResponseNotice,
			),
			getCharsPerToken: () => this.charsPerToken,
			setCharsPerToken: (charsPerToken) => {
				this.charsPerToken = charsPerToken;
			},
		});
	}

	private createNewApiClient(settings: NewApiSettings, token: string): NewApiClient {
		return new NewApiClient(settings.baseUrl, token, {
			timeoutMs: settings.requestTimeoutMs,
			appendV1ForRoot: !isOfficialDeepSeekBaseUrl(settings.baseUrl),
		});
	}

	private async selectPublishedNewApiModel(
		modelId: string,
		family: string | undefined,
		label: string,
	): Promise<void> {
		await vscode.extensions.getExtension('github.copilot-chat')?.activate();
		const commands = await vscode.commands.getCommands(true);
		if (!commands.includes('workbench.action.chat.changeModel')) {
			throw new Error('Copilot Chat model-switch command is unavailable');
		}
		// Resolve through the public LM selector first. This verifies that the
		// single New API provider has published the selected ID before changing
		// Copilot's remembered chat model.
		const [published] = await vscode.lm.selectChatModels({
			vendor: 'open-copilot',
			id: modelId,
			family,
		});
		if (!published) {
			throw new Error(`New API model ${modelId} is not currently published`);
		}
		await vscode.commands.executeCommand('workbench.action.chat.changeModel', {
			vendor: published.vendor,
			id: published.id,
			family: published.family,
		});
		await this.context.globalState.update(ACTIVE_MODEL_STATE_KEY, published.id);
		this.refreshModelPicker();
		void vscode.window.showInformationMessage(t('extension.selectModel.switched', label));
	}

	private getCatalog(token: string, settings: NewApiSettings): ModelCatalog {
		const resolverSettings = {
			modelDiscovery: settings.modelDiscovery,
			unknownModelPolicy: settings.unknownModelPolicy,
			defaultProtocol: settings.defaultProtocol,
			responses: settings.responses,
			chatIncludeUsage: settings.chatIncludeUsage,
			requestTimeoutMs: settings.requestTimeoutMs,
			visionMode: settings.visionMode,
			modelIdOverrides: settings.modelIdOverrides,
			modelRules: settings.modelRules,
			modelProfiles: settings.modelProfiles,
		};
		// The resolver affects the serialized model capabilities in the cache.
		// Include its stable settings fingerprint so a profile/vision change never
		// reuses a catalog resolved with older capabilities.
		const resolverSettingsJson = JSON.stringify(resolverSettings);
		const cacheKey = createModelCacheKey(settings.baseUrl, token, resolverSettingsJson);
		const resolverSignature = JSON.stringify({ cacheKey, resolverSettings });
		if (this.catalog && this.catalogSignature === resolverSignature) {
			return this.catalog;
		}

		this.catalog?.dispose();
		this.catalogChangeDisposable?.dispose();
		const resolver = new ProfileResolver({
			exactProfiles: toResolverProfileMap(settings.modelProfiles),
			rules: toResolverRules(settings.modelRules),
			builtInProfiles: createBuiltInProfiles(),
			builtInRules: createBuiltInRules(),
			// Gateway metadata and ID hints provide the base limits; user Profiles
			// remain the highest-priority override, while the resolver applies the
			// conservative 128K fallback only when both are missing.
			unknownModelDefaults: { imageMode: settings.visionMode },
			unknownModelPolicy: settings.unknownModelPolicy,
			defaultProtocol: settings.defaultProtocol,
			responsesEnabled: settings.responses.enabled,
			includePatterns: settings.modelDiscovery.includePatterns,
			excludePatterns: settings.modelDiscovery.excludePatterns,
		});
		const catalog = new ModelCatalog({
			cache: new GlobalStateModelCache(this.context.globalState, cacheKey),
			clientFactory: () => this.createNewApiClient(settings, token),
			resolver,
			ttlMs: settings.modelDiscovery.cacheTtlMinutes * 60_000,
			// New API has no push event when a channel/model is added. Poll the
			// directory at a short bounded cadence so the picker eventually notices
			// additions even while Copilot keeps its own model list cached. The TTL
			// remains the stale-cache policy; this timer is only a cheap `/models`
			// metadata request.
			autoRefreshMs: Math.min(settings.modelDiscovery.cacheTtlMinutes * 60_000, 60_000),
			onRefresh: ({ remoteCount, resolvedCount, changed }) => {
				const message = `New API model poll completed: remote=${remoteCount} resolved=${resolvedCount} changed=${changed}`;
				// A mismatch is actionable: the gateway returned models that the
				// active include/exclude/protocol rules filtered out. Keep unchanged
				// healthy polls quiet in the default log level.
				if (remoteCount !== resolvedCount || changed) logger.info(message);
				else logger.debug(message);
			},
			onCacheError: (error) => logger.warn('New API model catalog cache error', error),
			onEmptyResolution: ({ remoteCount, endpointTypes }) =>
				logger.warn(
					`New API returned ${remoteCount} model(s), but the active protocol/profile settings exposed none. ` +
						`Advertised endpoint types: ${endpointTypes.join(', ') || '(none)'}. ` +
						'Check open-copilot.defaultProtocol, modelRules/modelProfiles, and the Open Copilot group.',
				),
		});
		this.catalog = catalog;
		this.catalogSignature = resolverSignature;
		this.catalogChangeDisposable = catalog.onDidChange(() => {
			this.refreshModelPicker();
			// Catalog refreshes can happen in the background while Copilot keeps its
			// own model list cached. Start the one-time native-vision probe here so
			// newly exposed models are checked even when no Add Model UI is opened.
			void this.autoRefreshNewModelVision(catalog, token, settings).catch((error) =>
				logger.warn('Automatic native vision refresh failed', error),
			);
		});
		return catalog;
	}

	private async resolveModelForRequest(
		modelId: string,
		settings: NewApiSettings,
		token: vscode.CancellationToken,
	): Promise<ResolvedModel | undefined> {
		if (!settings.modelDiscovery.enabled) return undefined;
		const apiKey = await this.authManager.getApiKey();
		if (!apiKey) return undefined;
		try {
			const signal = cancellationSignal(token);
			try {
				const catalog = this.getCatalog(apiKey, settings);
				const mappedId = settings.modelIdOverrides[modelId] ?? modelId;
				const models = await catalog.getModels({ signal: signal.signal });
				// Prefer the picker ID when it is present, then honor an explicit
				// alias. The request layer applies the alias to the wire model ID.
				return (
					models.find((model) => model.id === modelId || model.apiModelId === modelId) ??
					models.find((model) => model.id === mappedId || model.apiModelId === mappedId)
				);
			} finally {
				signal.dispose();
			}
		} catch (error) {
			logger.warn(`Unable to resolve New API model ${modelId}; using compatibility profile`, error);
			return undefined;
		}
	}

	async provideTokenCount(
		_modelInfo: vscode.LanguageModelChatInformation,
		text: string | vscode.LanguageModelChatRequestMessage,
		_token: vscode.CancellationToken,
	): Promise<number> {
		return estimateTokenCount(text, this.charsPerToken);
	}
}

function toResolverProfileMap(
	profiles: Readonly<Record<string, ModelProfileSettings>>,
): Readonly<Record<string, ModelProfile>> {
	return Object.fromEntries(
		Object.entries(profiles).map(([id, profile]) => [id, toResolverProfile(profile)]),
	);
}

function toResolverRules(
	rules: readonly { match: string; profile: ModelProfileSettings }[],
): readonly ModelRule[] {
	return rules.map((rule, index) => ({
		id: `userRule:${index}`,
		match: rule.match,
		profile: toResolverProfile(rule.profile),
	}));
}

function toResolverProfile(settings: ModelProfileSettings): ModelProfile {
	const imageMode = settings.imageMode;
	const profile: ModelProfile = {
		enabled: settings.enabled,
		apiModelId: settings.apiModelId,
		displayName: settings.displayName,
		family: settings.family,
		version: settings.version,
		order: settings.order,
		protocol: settings.protocol,
		toolCalling: settings.toolCalling,
		parallelToolCalls: settings.parallelToolCalls,
		imageMode,
		nativeImageInput: settings.nativeImageInput,
		maxInputTokens: settings.maxInputTokens,
		maxOutputTokens: settings.maxOutputTokens,
		contextWindowTokens: settings.contextWindowTokens,
		maxTokensField: settings.maxTokensField,
		strictTools: settings.strictTools,
		allowProtocolFallback: settings.allowProtocolFallback,
		extraRequestFields: settings.extraRequestFields
			? { ...settings.extraRequestFields }
			: undefined,
	};
	if (settings.reasoning) {
		profile.reasoning = {
			enabled: settings.reasoning.enabled,
			efforts: settings.reasoning.efforts ? [...settings.reasoning.efforts] : undefined,
			defaultEffort: settings.reasoning.defaultEffort,
			canDisable: settings.reasoning.canDisable,
			requestStyle: settings.reasoning.requestStyle,
			effortMap: settings.reasoning.effortMap ? { ...settings.reasoning.effortMap } : undefined,
			outputStyle: settings.reasoning.outputStyle,
		};
	}
	return profile;
}

function createBuiltInProfiles(): Readonly<Record<string, ModelProfile>> {
	return Object.fromEntries(
		MODELS.map((model) => {
			const thinking = model.capabilities.thinking;
			return [
				model.id,
				{
					displayName: model.name,
					family: model.family,
					version: model.version,
					apiModelId: model.apiModelId ?? model.id,
					maxInputTokens: model.maxInputTokens,
					maxOutputTokens: model.maxOutputTokens,
					toolCalling: Boolean(model.capabilities.toolCalling),
					parallelToolCalls: true,
					reasoning: thinking
						? {
								enabled: true,
								efforts: [...thinking.supportedEfforts],
								defaultEffort: thinking.defaultEffort,
								canDisable: thinking.canDisable,
								requestStyle: model.requiresThinkingParam
									? 'chat-thinking'
									: 'chat-reasoning-effort',
								outputStyle: 'summary',
							}
						: undefined,
					protocol: 'chat-completions',
				},
			];
		}),
	);
}

/**
 * Capability hints for well-known model families. New API's `/models` endpoint
 * often exposes only `supported_endpoint_types`, which is enough to route text
 * but not enough to tell Copilot about tools or reasoning. Keep these hints
 * deliberately narrow; users can extend or override them with `modelRules`
 * when a gateway has different behavior.
 */

function createBuiltInRules(): readonly ModelRule[] {
	return createBuiltInModelRules();
}

interface NewApiModelPickerItem extends vscode.QuickPickItem {
	readonly modelId: string;
	readonly family: string;
}

interface ModelToolCallingChoice extends vscode.QuickPickItem {
	readonly enabled: boolean;
}

function toNewApiModelPickerItem(model: ResolvedModel): NewApiModelPickerItem {
	const capability = model.capabilities.toolCalling
		? t('extension.selectModel.toolCalling')
		: t('extension.selectModel.textOnly');
	const stale = model.source.fromStaleCache ? ` · ${t('extension.selectModel.stale')}` : '';
	return {
		label: model.displayName,
		description: `${model.family} · ${model.selectedProtocol} · ${capability}`,
		detail: `${model.id}${stale}`,
		modelId: model.id,
		family: model.family,
	};
}

interface DisposableAbortSignal {
	signal: AbortSignal;
	dispose: () => void;
}

function cancellationSignal(token: vscode.CancellationToken): DisposableAbortSignal {
	const controller = new AbortController();
	const disposable = token.onCancellationRequested(() => controller.abort());
	if (token.isCancellationRequested) controller.abort();
	return { signal: controller.signal, dispose: () => disposable.dispose() };
}

function createNativeVisionCheckScope(
	settings: NewApiSettings,
	token: string,
	modelId: string,
): string {
	return createModelCacheKey(
		settings.baseUrl,
		token,
		JSON.stringify({
			probeVersion: NATIVE_VISION_PROBE_VERSION,
			modelId,
			defaultProtocol: settings.defaultProtocol,
			responses: settings.responses,
			visionMode: settings.visionMode,
			modelRules: settings.modelRules,
			modelProfile: settings.modelProfiles[modelId],
		}),
	);
}

function readNativeVisionCheckState(value: unknown): Record<string, NativeVisionCheckState> {
	if (!isRecord(value)) return {};
	const result: Record<string, NativeVisionCheckState> = {};
	for (const [key, entry] of Object.entries(value)) {
		if (!isRecord(entry)) continue;
		const status = entry.status;
		if (status !== 'pass' && status !== 'warn' && status !== 'fail' && status !== 'skip') {
			continue;
		}
		if (typeof entry.checkedAt !== 'number' || !Number.isFinite(entry.checkedAt)) continue;
		result[key] = {
			status,
			checkedAt: entry.checkedAt,
			applied: entry.applied === true,
		};
	}
	return result;
}

function toManagerVisionProbe(
	state: Readonly<Record<string, NativeVisionCheckState>>,
	key: string,
): ModelManagerVisionProbe | undefined {
	const value = state[key];
	if (!value) return undefined;
	return {
		status: value.status,
		checkedAt: value.checkedAt,
		applied: value.applied,
	};
}

function joinInitialResponseNotices(...notices: (string | undefined)[]): string | undefined {
	const joined = notices.filter((notice) => notice && notice.trim().length > 0).join('\n');
	return joined || undefined;
}

async function readLimitedJson(response: Response, maxBytes: number): Promise<unknown> {
	if (!response.body) return undefined;
	const reader = response.body.getReader();
	const decoder = new TextDecoder();
	const chunks: Uint8Array[] = [];
	let total = 0;
	try {
		while (total <= maxBytes) {
			const next = await reader.read();
			if (next.done) break;
			const chunk = next.value;
			if (!chunk) continue;
			total += chunk.byteLength;
			if (total > maxBytes) {
				await reader.cancel();
				break;
			}
			chunks.push(chunk);
		}
	} finally {
		reader.releaseLock();
	}
	if (chunks.length === 0) return undefined;
	const text = decoder.decode(concatBytes(chunks));
	try {
		return JSON.parse(text) as unknown;
	} catch {
		// A successful gateway response with a non-JSON body still proves that
		// the endpoint accepted the request; do not expose the body to the UI.
		return undefined;
	}
}

function getHealthBusinessError(value: unknown): string | undefined {
	if (!isRecord(value) || value.error === undefined) return undefined;
	const error = value.error;
	const message =
		typeof error === 'string'
			? error
			: isRecord(error)
				? (stringAt(error, 'message') ?? stringAt(value, 'message'))
				: stringAt(value, 'message');
	return sanitizeModelManagerMessage(message ?? 'New API returned an error envelope');
}

function concatBytes(chunks: readonly Uint8Array[]): Uint8Array {
	const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
	const result = new Uint8Array(total);
	let offset = 0;
	for (const chunk of chunks) {
		result.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return result;
}

function sanitizeManagerBaseUrl(value: string): string {
	try {
		const url = new URL(value);
		url.username = '';
		url.password = '';
		url.search = '';
		url.hash = '';
		return url.toString().replace(/\/$/u, '');
	} catch {
		// `getBaseUrl` already validates normal configuration values. Keep a
		// conservative fallback for a malformed value without echoing a
		// query string or userinfo into the webview.
		return value.replace(/[?#].*$/u, '').replace(/\/[^/]*@/u, '/<redacted>@');
	}
}

function toModelManagerCompatibilityReport(
	report: CompatibilityDiagnosticReport,
	secret: string,
): ModelManagerCompatibilityReport {
	return {
		modelId: report.modelId,
		apiModelId: report.apiModelId,
		protocol: report.protocol,
		startedAt: report.startedAt,
		completedAt: report.completedAt,
		passed: report.passed,
		optionalIncluded: report.optionalIncluded,
		visionIncluded: report.visionIncluded,
		checks: report.checks.map((check) => ({
			id: check.id,
			status: check.status,
			latencyMs: check.latencyMs,
			firstTokenMs: check.firstTokenMs,
			httpStatus: check.httpStatus,
			requestId: check.requestId,
			protocol: check.protocol,
			responseModel: check.responseModel,
			message: check.message ? sanitizeModelManagerMessage(check.message, secret) : undefined,
			details: check.details,
			usage: check.usage
				? {
						inputTokens: check.usage.inputTokens,
						outputTokens: check.usage.outputTokens,
						totalTokens: check.usage.totalTokens,
						cachedInputTokens: check.usage.cachedInputTokens,
						reasoningTokens: check.usage.reasoningTokens,
					}
				: undefined,
		})),
	};
}

function getModelManagerStrings(): ModelManagerPanelStrings {
	return {
		title: t('modelManager.title'),
		description: t('modelManager.description'),
		refresh: t('modelManager.action.refresh'),
		testConnection: t('modelManager.action.testConnection'),
		openSettings: t('modelManager.action.openSettings'),
		searchPlaceholder: t('modelManager.searchPlaceholder'),
		allModels: t('modelManager.allModels'),
		modelCount: t('modelManager.modelCount'),
		noModels: t('modelManager.noModels'),
		noSelection: t('modelManager.noSelection'),
		loading: t('modelManager.loading'),
		baseUrl: t('modelManager.field.baseUrl'),
		apiKeyConfigured: t('modelManager.connection.tokenConfigured'),
		apiKeyMissing: t('modelManager.connection.tokenMissing'),
		lastUpdated: t('modelManager.lastUpdated'),
		stale: t('modelManager.status.stale'),
		metadataIncomplete: t('modelManager.status.metadataIncomplete'),
		selected: t('modelManager.status.selected'),
		selectModel: t('modelManager.action.selectModel'),
		healthCheck: t('modelManager.action.healthCheck'),
		healthChecking: t('modelManager.health.checking'),
		healthUnknown: t('modelManager.health.unknown'),
		healthHealthy: t('modelManager.health.healthy'),
		healthUnhealthy: t('modelManager.health.unhealthy'),
		protocol: t('modelManager.field.protocol'),
		protocols: t('modelManager.field.protocols'),
		capabilities: t('modelManager.field.capabilities'),
		tools: t('modelManager.capability.tools'),
		parallelTools: t('modelManager.capability.parallelTools'),
		visionNative: t('modelManager.capability.visionNative'),
		visionProxy: t('modelManager.capability.visionProxy'),
		visionNone: t('modelManager.capability.visionNone'),
		visionAuto: t('modelManager.capability.visionAuto'),
		reasoning: t('modelManager.capability.reasoning'),
		contextWindow: t('modelManager.field.contextWindow'),
		inputTokens: t('modelManager.field.inputTokens'),
		outputTokens: t('modelManager.field.outputTokens'),
		modelId: t('modelManager.field.modelId'),
		apiModelId: t('modelManager.field.apiModelId'),
		family: t('modelManager.field.family'),
		version: t('modelManager.field.version'),
		endpointTypes: t('modelManager.field.endpointTypes'),
		profileSources: t('modelManager.field.profileSources'),
		profile: t('modelManager.field.profile'),
		profileHint: t('modelManager.profile.hint'),
		profilePlaceholder: t('modelManager.profile.placeholder'),
		formatJson: t('modelManager.action.formatJson'),
		saveProfile: t('modelManager.action.saveProfile'),
		cancel: t('modelManager.action.cancel'),
		statusReady: t('modelManager.status.ready'),
		statusRefreshing: t('modelManager.status.refreshing'),
		statusTesting: t('modelManager.status.testing'),
		statusSaving: t('modelManager.status.saving'),
		statusSaved: t('modelManager.status.saved'),
		statusSelected: t('modelManager.status.selectedMessage'),
		statusHealthPassed: t('modelManager.health.passed'),
		statusHealthFailed: t('modelManager.health.failed'),
		statusError: t('modelManager.status.error'),
		invalidProfile: t('modelManager.profile.invalid'),
		modelNotFound: t('modelManager.modelNotFound'),
		unknown: t('modelManager.unknown'),
		unknownCapability: t('modelManager.unknownCapability'),
		fromGateway: t('modelManager.source.gateway'),
		fromProfile: t('modelManager.source.profile'),
		fromHeuristic: t('modelManager.source.heuristic'),
		fromBuiltin: t('modelManager.source.builtin'),
		fromProbe: t('modelManager.source.probe'),
		fromUnknown: t('modelManager.source.unknown'),
		confirmDiscard: t('modelManager.profile.confirmDiscard'),
		filterAll: t('modelManager.filter.all'),
		filterTools: t('modelManager.filter.tools'),
		filterVision: t('modelManager.filter.vision'),
		filterReasoning: t('modelManager.filter.reasoning'),
		operationInProgress: t('modelManager.operationInProgress'),
		selectionNotConfigured: t('modelManager.selectionNotConfigured'),
		profileEditingNotConfigured: t('modelManager.profileEditingNotConfigured'),
		healthNotConfigured: t('modelManager.health.notConfigured'),
		compatibilityCheck: t('modelManager.compatibility.check'),
		compatibilityChecking: t('modelManager.compatibility.checking'),
		compatibilityTitle: t('modelManager.compatibility.title'),
		compatibilityDescription: t('modelManager.compatibility.description'),
		compatibilityOptional: t('modelManager.compatibility.optional'),
		compatibilityVision: t('modelManager.compatibility.vision'),
		compatibilityConfirmVision: t('modelManager.compatibility.confirmVision'),
		compatibilityPass: t('modelManager.compatibility.pass'),
		compatibilityFail: t('modelManager.compatibility.fail'),
		compatibilityWarn: t('modelManager.compatibility.warn'),
		compatibilitySkip: t('modelManager.compatibility.skip'),
		compatibilityNoChecks: t('modelManager.compatibility.noChecks'),
		compatibilityReportPassed: t('modelManager.compatibility.reportPassed'),
		compatibilityReportFailed: t('modelManager.compatibility.reportFailed'),
		compatibilityLatency: t('modelManager.compatibility.latency'),
		compatibilityFirstToken: t('modelManager.compatibility.firstToken'),
		compatibilityHttp: t('modelManager.compatibility.http'),
		compatibilityRequestId: t('modelManager.compatibility.requestId'),
		compatibilityUsage: t('modelManager.compatibility.usage'),
		compatibilityDetails: t('modelManager.compatibility.details'),
		compatibilityTokensPerSecond: t('modelManager.compatibility.tokensPerSecond'),
		compatibilityResponseChars: t('modelManager.compatibility.responseChars'),
		compatibilityFrames: t('modelManager.compatibility.frames'),
		compatibilityCheckChat: t('modelManager.compatibility.chat'),
		compatibilityCheckStream: t('modelManager.compatibility.stream'),
		compatibilityCheckUsage: t('modelManager.compatibility.usageCheck'),
		compatibilityCheckTools: t('modelManager.compatibility.tools'),
		compatibilityCheckParallelTools: t('modelManager.compatibility.parallelTools'),
		compatibilityCheckReasoning: t('modelManager.compatibility.reasoning'),
		compatibilityCheckResponses: t('modelManager.compatibility.responses'),
		compatibilityCheckVision: t('modelManager.compatibility.visionCheck'),
		compatibilityNativeApplied: t('modelManager.compatibility.nativeApplied'),
		compatibilityNativeApplyFailed: t('modelManager.compatibility.nativeApplyFailed'),
	};
}
