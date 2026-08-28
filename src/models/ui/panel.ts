import vscode from 'vscode';
import { getModelManagerPanelHtml } from './html';
import {
	DEFAULT_MODEL_MANAGER_STRINGS,
	mergeModelManagerStrings,
	type ModelManagerCompatibilityCheck,
	type ModelManagerCompatibilityReport,
	type ModelManagerHealthResult,
	type ModelManagerPanelOptions,
	type ModelManagerPanelState,
	type ModelManagerTestResult,
	type ModelManagerWebviewMessage,
} from './types';

let currentPanel: vscode.WebviewPanel | undefined;
let currentPanelOptions: ModelManagerPanelOptions | undefined;
/** Monotonically ordered state requests prevent an old network response from
 * overwriting a newer catalog snapshot in the retained webview. */
const stateRequestVersions = new WeakMap<vscode.WebviewPanel, number>();

function beginStateRequest(panel: vscode.WebviewPanel): number {
	const version = (stateRequestVersions.get(panel) ?? 0) + 1;
	stateRequestVersions.set(panel, version);
	return version;
}

function isLatestStateRequest(panel: vscode.WebviewPanel, version: number): boolean {
	return stateRequestVersions.get(panel) === version;
}

/**
 * Open the model management center. The panel owns no catalog state; all
 * mutations are delegated to the extension host through `options`, keeping
 * credentials and provider objects out of the webview.
 */
export function openModelManagerPanel(
	context: vscode.ExtensionContext,
	options: ModelManagerPanelOptions,
): void {
	if (currentPanel) {
		currentPanel.reveal(vscode.ViewColumn.Active);
		// Re-opening the singleton is an explicit refresh intent. The previous
		// implementation only revealed the old webview, so a model added upstream
		// could remain invisible until the user clicked Refresh inside the panel.
		if (currentPanelOptions) void postState(currentPanel, currentPanelOptions);
		return;
	}

	const strings = mergeModelManagerStrings(options.strings);
	const panel = vscode.window.createWebviewPanel(
		'openCopilotModelManager',
		strings.title,
		vscode.ViewColumn.Active,
		{
			enableScripts: true,
			retainContextWhenHidden: true,
			localResourceRoots: [],
		},
	);
	currentPanel = panel;
	currentPanelOptions = options;
	const operation = new PanelOperation();
	let listener: { dispose(): void } | undefined;
	let visibilityListener: { dispose(): void } | undefined;
	// Render a lightweight shell immediately. The real catalog request can
	// involve a network round trip; keeping the panel visible gives the user a
	// loading state and lets them close it without waiting for the gateway.
	panel.webview.html = getModelManagerPanelHtml(
		panel.webview,
		{ models: [], loading: true },
		options.strings,
	);

	panel.onDidDispose(() => {
		operation.dispose();
		listener?.dispose();
		listener = undefined;
		visibilityListener?.dispose();
		visibilityListener = undefined;
		if (currentPanel === panel) {
			currentPanel = undefined;
			currentPanelOptions = undefined;
			stateRequestVersions.delete(panel);
		}
	});

	panel.webview.onDidReceiveMessage((message: unknown) => {
		void handleMessage(panel, options, operation, message, strings);
	});

	if (options.onDidChange) {
		try {
			listener = options.onDidChange(() => {
				void postState(panel, options);
			});
		} catch {
			// A catalog listener is an enhancement; a broken listener must not
			// prevent the initial panel from opening.
			listener = undefined;
		}
	}
	// A retained webview can miss a host message while hidden or while VS Code
	// recreates its document. Re-query as soon as the panel becomes visible so
	// the user never has to close/reopen the manager just to see a new model.
	visibilityListener = panel.onDidChangeViewState(() => {
		if (panel.visible && currentPanel === panel) void postState(panel, options);
	});

	void renderPanel(panel, options);
}

/** Close the singleton panel, if one is open. Useful when the extension deactivates. */
export function closeModelManagerPanel(): void {
	currentPanel?.dispose();
	currentPanel = undefined;
	currentPanelOptions = undefined;
}

class PanelOperation {
	private controller?: AbortController;

	begin(): AbortSignal | undefined {
		if (this.controller) return undefined;
		this.controller = new AbortController();
		return this.controller.signal;
	}

	end(): void {
		this.controller = undefined;
	}

	dispose(): void {
		this.controller?.abort();
		this.controller = undefined;
	}
}

async function renderPanel(
	panel: vscode.WebviewPanel,
	options: ModelManagerPanelOptions,
): Promise<void> {
	const requestVersion = beginStateRequest(panel);
	try {
		const state = await options.getState();
		if (currentPanel !== panel || !isLatestStateRequest(panel, requestVersion)) return;
		const delivered = await panel.webview.postMessage({
			type: 'state',
			value: normalizeState(state),
		});
		if (!delivered && currentPanel === panel) {
			panel.webview.html = getModelManagerPanelHtml(
				panel.webview,
				normalizeState(state),
				options.strings,
			);
		}
	} catch (error) {
		if (currentPanel !== panel || !isLatestStateRequest(panel, requestVersion)) return;
		const state: ModelManagerPanelState = {
			models: [],
			error: { message: getErrorMessage(error) },
		};
		const delivered = await panel.webview.postMessage({ type: 'state', value: state });
		if (!delivered && currentPanel === panel) {
			panel.webview.html = getModelManagerPanelHtml(panel.webview, state, options.strings);
		}
	}
}

async function postState(
	panel: vscode.WebviewPanel,
	options: ModelManagerPanelOptions,
	signal?: AbortSignal,
	operation?: ModelManagerWebviewMessage['type'],
): Promise<ModelManagerPanelState | undefined> {
	const requestVersion = beginStateRequest(panel);
	try {
		const state = normalizeState(await options.getState(signal));
		if (currentPanel !== panel || !isLatestStateRequest(panel, requestVersion)) return undefined;
		const delivered = await panel.webview.postMessage({
			type: 'state',
			value: state,
			...(operation ? { operation } : {}),
		});
		// `postMessage` can return false while a retained webview is hidden or
		// while its document is being recreated. Dropping the message leaves the
		// model manager visibly stale even though the extension host refreshed the
		// catalog successfully. Re-render the latest state as a safe fallback;
		// the HTML bootstrap carries the same state and will be applied when the
		// webview becomes ready/visible.
		if (!delivered && currentPanel === panel && isLatestStateRequest(panel, requestVersion)) {
			panel.webview.html = getModelManagerPanelHtml(panel.webview, state, options.strings);
		}
		return state;
	} catch (error) {
		if (currentPanel !== panel || !isLatestStateRequest(panel, requestVersion)) return undefined;
		if (isAbortError(error) || signal?.aborted) return undefined;
		await postStatus(panel, getErrorMessage(error), 'error');
		return undefined;
	}
}

async function postStatus(
	panel: vscode.WebviewPanel,
	message: string,
	tone: 'info' | 'success' | 'warning' | 'error' = 'info',
): Promise<void> {
	try {
		await panel.webview.postMessage({
			type: 'status',
			value: { message, tone },
		});
	} catch {
		// The user may close the panel while an operation is completing.
	}
}

async function handleMessage(
	panel: vscode.WebviewPanel,
	options: ModelManagerPanelOptions,
	operation: PanelOperation,
	message: unknown,
	strings: typeof DEFAULT_MODEL_MANAGER_STRINGS,
): Promise<void> {
	const parsed = parseMessage(message);
	if (!parsed) return;
	if (parsed.type === 'openSettings') {
		try {
			await options.openSettings?.();
		} catch (error) {
			await postStatus(panel, getErrorMessage(error), 'error');
		}
		return;
	}

	const signal = operation.begin();
	if (!signal) {
		await postStatus(panel, strings.operationInProgress, 'warning');
		return;
	}
	try {
		if (parsed.type === 'refresh') {
			await postStatus(panel, strings.statusRefreshing, 'info');
			const refreshed = options.refresh
				? await options.refresh(signal)
				: await options.getState(signal);
			let refreshedState: ModelManagerPanelState | undefined;
			if (refreshed) {
				refreshedState = normalizeState(refreshed);
				await panel.webview.postMessage({
					type: 'state',
					value: refreshedState,
					operation: 'refresh',
				});
			} else {
				refreshedState = await postState(panel, options, signal, 'refresh');
				if (!refreshedState) return;
			}
			await postStatus(
				panel,
				refreshedState.error?.message ?? strings.statusReady,
				refreshedState.error ? 'error' : 'success',
			);
			return;
		}

		if (parsed.type === 'testConnection') {
			await postStatus(panel, strings.statusTesting, 'info');
			const result = options.testConnection
				? await options.testConnection(signal)
				: await defaultConnectionTest(options, signal);
			await panel.webview.postMessage({
				type: 'testResult',
				value: normalizeTestResult(result),
			});
			return;
		}

		if (!parsed.modelId) {
			await postStatus(panel, strings.modelNotFound, 'error');
			return;
		}

		if (parsed.type === 'healthCheck') {
			const result = options.healthCheck
				? await options.healthCheck(parsed.modelId, signal)
				: { ok: false, modelId: parsed.modelId, message: strings.healthNotConfigured };
			await panel.webview.postMessage({
				type: 'healthResult',
				value: normalizeHealthResult(parsed.modelId, result),
			});
			return;
		}

		if (parsed.type === 'compatibilityCheck') {
			const report = options.compatibilityCheck
				? await options.compatibilityCheck(
						parsed.modelId,
						{
							includeOptional: parsed.includeOptional === true,
							includeVision: parsed.includeVision === true,
						},
						signal,
					)
				: undefined;
			await panel.webview.postMessage({
				type: 'compatibilityResult',
				value: normalizeCompatibilityReport(parsed.modelId, report, strings),
			});
			return;
		}

		if (parsed.type === 'selectModel') {
			if (!options.selectModel) {
				await postStatus(panel, strings.selectionNotConfigured, 'error');
				return;
			}
			await options.selectModel(parsed.modelId);
			const selectedState = await postState(panel, options, signal, 'selectModel');
			if (!selectedState) return;
			await postStatus(panel, strings.statusSelected, 'success');
			return;
		}

		if (parsed.type === 'saveProfile') {
			if (!options.saveProfile) {
				await postStatus(panel, strings.profileEditingNotConfigured, 'error');
				return;
			}
			const profile = sanitizeProfile(parsed.profile);
			if (!profile) {
				await postStatus(panel, strings.invalidProfile, 'error');
				return;
			}
			const saved = await options.saveProfile(parsed.modelId, profile, signal);
			if (saved) {
				await panel.webview.postMessage({
					type: 'state',
					value: normalizeState(saved),
					operation: 'saveProfile',
				});
			} else {
				const savedState = await postState(panel, options, signal, 'saveProfile');
				if (!savedState) return;
			}
			await postStatus(panel, strings.statusSaved, 'success');
		}
	} catch (error) {
		if (!isAbortError(error) && !signal.aborted) {
			await postStatus(panel, getErrorMessage(error), 'error');
		}
	} finally {
		operation.end();
	}
}

function parseMessage(value: unknown): ModelManagerWebviewMessage | undefined {
	if (!isRecord(value) || typeof value.type !== 'string') return undefined;
	const allowed = new Set([
		'refresh',
		'testConnection',
		'healthCheck',
		'compatibilityCheck',
		'saveProfile',
		'selectModel',
		'openSettings',
	]);
	if (!allowed.has(value.type)) return undefined;
	if (
		value.type === 'refresh' ||
		value.type === 'testConnection' ||
		value.type === 'openSettings'
	) {
		return { type: value.type } as ModelManagerWebviewMessage;
	}
	if (typeof value.modelId !== 'string' || !isSafeModelId(value.modelId)) return undefined;
	if (value.type === 'saveProfile' && !isRecord(value.profile)) return undefined;
	return {
		type: value.type as ModelManagerWebviewMessage['type'],
		modelId: value.modelId,
		...(value.type === 'compatibilityCheck'
			? {
					includeOptional: value.includeOptional === true,
					includeVision: value.includeVision === true,
				}
			: {}),
		...(value.type === 'saveProfile'
			? { profile: value.profile as Readonly<Record<string, unknown>> }
			: {}),
	};
}

function isSafeModelId(value: string): boolean {
	if (value.length === 0 || value.length > 512) return false;
	for (const character of value) {
		const code = character.charCodeAt(0);
		if (code < 0x20 || code === 0x7f) return false;
	}
	return true;
}

function sanitizeProfile(
	value: Readonly<Record<string, unknown>> | undefined,
): Readonly<Record<string, unknown>> | undefined {
	if (!value || !isRecord(value)) return undefined;
	try {
		if (
			JSON.stringify(value).length > 64 * 1024 ||
			getObjectDepth(value) > 8 ||
			containsSecretKey(value)
		)
			return undefined;
		return JSON.parse(JSON.stringify(value)) as Readonly<Record<string, unknown>>;
	} catch {
		return undefined;
	}
}

function getObjectDepth(value: unknown, depth = 0): number {
	if (!isRecord(value) && !Array.isArray(value)) return depth;
	return Math.max(depth, ...Object.values(value).map((child) => getObjectDepth(child, depth + 1)));
}

function containsSecretKey(value: unknown): boolean {
	if (Array.isArray(value)) return value.some(containsSecretKey);
	if (!isRecord(value)) return false;
	for (const [key, child] of Object.entries(value)) {
		if (
			key === '__proto__' ||
			key === 'constructor' ||
			key === 'prototype' ||
			/^(authorization|proxy-authorization|cookie|set-cookie|api[-_]?key|token|secret|password)$/i.test(
				key,
			)
		) {
			return true;
		}
		if (containsSecretKey(child)) return true;
	}
	return false;
}

function normalizeState(state: ModelManagerPanelState): ModelManagerPanelState {
	return {
		...state,
		baseUrl: sanitizeBaseUrl(state.baseUrl),
		error: state.error
			? {
					...state.error,
					message:
						typeof state.error.message === 'string'
							? sanitizeDisplayMessage(state.error.message)
							: 'Model manager operation failed.',
				}
			: undefined,
		models: Array.isArray(state.models)
			? state.models
					.filter((model) => model && typeof model.id === 'string')
					.map((model) => ({
						...model,
						profile: model.profile ? (sanitizeProfile(model.profile) ?? {}) : undefined,
						health: model.health?.message
							? {
									...model.health,
									message:
										typeof model.health.message === 'string'
											? sanitizeDisplayMessage(model.health.message)
											: 'Health check failed.',
								}
							: model.health,
					}))
			: [],
	};
}

function sanitizeBaseUrl(value: string | undefined): string | undefined {
	if (!value?.trim()) return undefined;
	try {
		const url = new URL(value);
		url.username = '';
		url.password = '';
		url.search = '';
		url.hash = '';
		return url.toString().replace(/\/$/u, '');
	} catch {
		return value.replace(/[?#].*$/u, '').replace(/\/[^/]*@/u, '/<redacted>@');
	}
}

function normalizeHealthResult(
	modelId: string,
	result: ModelManagerHealthResult | void,
): ModelManagerHealthResult {
	if (!result || typeof result !== 'object') {
		return { modelId, ok: false, message: 'Health check returned no result.' };
	}
	return {
		...result,
		modelId,
		ok: result.ok === true,
		message: result.message ? sanitizeDisplayMessage(result.message) : undefined,
	};
}

function normalizeCompatibilityReport(
	modelId: string,
	report: ModelManagerCompatibilityReport | void,
	strings: typeof DEFAULT_MODEL_MANAGER_STRINGS,
): ModelManagerCompatibilityReport {
	if (!report || typeof report !== 'object') {
		return {
			modelId,
			checks: [{ id: 'chat', status: 'fail', message: strings.statusError }],
			passed: false,
		};
	}
	const checks = Array.isArray(report.checks) ? report.checks : [];
	return {
		...report,
		modelId,
		passed: report.passed === true,
		visionProfileApplied: report.visionProfileApplied === true,
		visionProfileError: report.visionProfileError
			? sanitizeDisplayMessage(report.visionProfileError)
			: undefined,
		checks: checks.map((check) => normalizeCompatibilityCheck(check)),
	};
}

function normalizeCompatibilityCheck(
	check: ModelManagerCompatibilityCheck,
): ModelManagerCompatibilityCheck {
	const details: Record<string, string | number | boolean | undefined> = {};
	if (check.details && typeof check.details === 'object') {
		for (const [key, value] of Object.entries(check.details)) {
			if (
				(typeof value === 'string' && value.length <= 256) ||
				typeof value === 'number' ||
				typeof value === 'boolean'
			) {
				details[key] = value;
			}
		}
	}
	const usage = check.usage
		? {
				inputTokens: finiteNonNegative(check.usage.inputTokens) ?? 0,
				outputTokens: finiteNonNegative(check.usage.outputTokens) ?? 0,
				totalTokens: finiteNonNegative(check.usage.totalTokens) ?? 0,
				cachedInputTokens: finiteNonNegative(check.usage.cachedInputTokens),
				reasoningTokens: finiteNonNegative(check.usage.reasoningTokens),
			}
		: undefined;
	return {
		id: check.id,
		status: check.status,
		latencyMs: finiteNonNegative(check.latencyMs),
		firstTokenMs: finiteNonNegative(check.firstTokenMs),
		httpStatus: finiteNonNegative(check.httpStatus),
		requestId: typeof check.requestId === 'string' ? check.requestId.slice(0, 128) : undefined,
		protocol: typeof check.protocol === 'string' ? check.protocol.slice(0, 64) : undefined,
		responseModel:
			typeof check.responseModel === 'string' ? check.responseModel.slice(0, 256) : undefined,
		message: check.message ? sanitizeDisplayMessage(check.message) : undefined,
		details: Object.keys(details).length > 0 ? details : undefined,
		usage,
	};
}

function finiteNonNegative(value: unknown): number | undefined {
	return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function normalizeTestResult(result: ModelManagerTestResult | void): ModelManagerTestResult {
	if (!result || typeof result !== 'object') {
		return { ok: false, message: 'Connection test returned no result.' };
	}
	return {
		...result,
		ok: result.ok === true,
		message: result.message ? sanitizeDisplayMessage(result.message) : undefined,
	};
}

function getErrorMessage(error: unknown): string {
	const raw = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
	return sanitizeDisplayMessage(raw || 'Model manager operation failed.');
}

function sanitizeDisplayMessage(value: string): string {
	return value
		.replace(/bearer\s+[^\s,;]+/giu, 'Bearer <redacted>')
		.replace(/\bsk-[a-z0-9._~-]+/giu, 'sk-<redacted>')
		.replace(/authorization\s*[:=]\s*[^\s,;]+/giu, 'Authorization: <redacted>')
		.replace(/\s+/gu, ' ')
		.trim()
		.slice(0, 512);
}

function isAbortError(error: unknown): boolean {
	return Boolean(
		error &&
		typeof error === 'object' &&
		'name' in error &&
		(error as { name?: unknown }).name === 'AbortError',
	);
}

async function defaultConnectionTest(
	options: ModelManagerPanelOptions,
	signal?: AbortSignal,
): Promise<ModelManagerTestResult> {
	const startedAt = Date.now();
	const state = await options.getState(signal);
	return {
		ok: !state.error && state.hasApiKey === true && state.models.length >= 0,
		latencyMs: Date.now() - startedAt,
		modelCount: state.models.length,
		message: state.error?.message,
	};
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}
