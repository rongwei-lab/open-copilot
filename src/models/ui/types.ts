/**
 * Data contracts used by the model management webview.
 *
 * The webview intentionally accepts a provider-neutral, JSON-safe projection
 * of a resolved model.  Keeping this projection separate from `ResolvedModel`
 * means the extension host can evolve its catalog without exposing internal
 * objects (or secrets) to the browser context.
 */

export type ModelManagerImageMode = 'none' | 'proxy' | 'native' | 'auto' | string;

export interface ModelManagerCapabilities {
	readonly toolCalling?: boolean;
	readonly parallelToolCalls?: boolean;
	readonly imageMode?: ModelManagerImageMode;
	readonly reasoning?:
		| boolean
		| {
				readonly enabled?: boolean;
				readonly efforts?: readonly string[];
				readonly defaultEffort?: string;
				readonly canDisable?: boolean;
				readonly requestStyle?: string;
				readonly effortMap?: Readonly<Record<string, string>>;
		  };
	/** Optional provenance for each capability (gateway/profile/heuristic/etc.). */
	readonly sources?: Readonly<Record<string, string>>;
}

export interface ModelManagerModel {
	readonly id: string;
	readonly apiModelId?: string;
	readonly displayName?: string;
	readonly family?: string;
	readonly version?: string;
	readonly maxInputTokens?: number;
	readonly maxOutputTokens?: number;
	readonly protocols?: readonly string[];
	readonly selectedProtocol?: string;
	readonly capabilities?: ModelManagerCapabilities;
	readonly profile?: Readonly<Record<string, unknown>>;
	readonly visionProbe?: ModelManagerVisionProbe;
	readonly source?: {
		readonly endpointTypes?: readonly string[];
		readonly profileIds?: readonly string[];
		readonly metadataIncomplete?: boolean;
		readonly fromStaleCache?: boolean;
	};
	readonly health?: ModelManagerHealthResult;
}

export interface ModelManagerHealthResult {
	readonly modelId?: string;
	readonly ok: boolean;
	readonly latencyMs?: number;
	readonly status?: number;
	readonly protocol?: string;
	readonly responseModel?: string;
	readonly requestId?: string;
	readonly message?: string;
	readonly checkedAt?: number;
}

/** Persisted result of the silent native-vision compatibility probe. */
export interface ModelManagerVisionProbe {
	readonly status: 'pass' | 'warn' | 'fail' | 'skip';
	readonly checkedAt: number;
	readonly applied: boolean;
}

export interface ModelManagerCatalogError {
	readonly code?: string;
	readonly status?: number;
	readonly requestId?: string;
	readonly message: string;
	readonly retryable?: boolean;
}

export interface ModelManagerPanelState {
	readonly baseUrl?: string;
	readonly hasApiKey?: boolean;
	readonly fetchedAt?: number;
	readonly stale?: boolean;
	readonly loading?: boolean;
	readonly models: readonly ModelManagerModel[];
	readonly activeModelId?: string;
	readonly error?: ModelManagerCatalogError;
}

export interface ModelManagerTestResult {
	readonly ok: boolean;
	readonly latencyMs?: number;
	readonly status?: number;
	readonly modelCount?: number;
	readonly endpointTypes?: readonly string[];
	readonly requestId?: string;
	readonly message?: string;
}

export type ModelManagerCompatibilityCheckId =
	| 'chat'
	| 'stream'
	| 'usage'
	| 'tools'
	| 'parallel-tools'
	| 'reasoning'
	| 'responses'
	| 'vision';

export type ModelManagerCompatibilityCheckStatus = 'pass' | 'fail' | 'warn' | 'skip';

export interface ModelManagerCompatibilityUsage {
	readonly inputTokens: number;
	readonly outputTokens: number;
	readonly totalTokens: number;
	readonly cachedInputTokens?: number;
	readonly reasoningTokens?: number;
}

export interface ModelManagerCompatibilityCheck {
	readonly id: ModelManagerCompatibilityCheckId;
	readonly status: ModelManagerCompatibilityCheckStatus;
	readonly latencyMs?: number;
	readonly firstTokenMs?: number;
	readonly httpStatus?: number;
	readonly requestId?: string;
	readonly protocol?: string;
	readonly responseModel?: string;
	readonly message?: string;
	readonly details?: Readonly<Record<string, string | number | boolean | undefined>>;
	readonly usage?: ModelManagerCompatibilityUsage;
}

export interface ModelManagerCompatibilityReport {
	readonly modelId: string;
	readonly apiModelId?: string;
	readonly protocol?: string;
	readonly startedAt?: number;
	readonly completedAt?: number;
	readonly checks: readonly ModelManagerCompatibilityCheck[];
	readonly passed: boolean;
	readonly optionalIncluded?: boolean;
	readonly visionIncluded?: boolean;
	/** True when a verified vision probe was persisted as native image input. */
	readonly visionProfileApplied?: boolean;
	/** Bounded, user-safe persistence error when native promotion could not be saved. */
	readonly visionProfileError?: string;
}

export interface ModelManagerCompatibilityOptions {
	readonly includeOptional?: boolean;
	readonly includeVision?: boolean;
}

export interface ModelManagerWebviewMessage {
	readonly type:
		| 'refresh'
		| 'testConnection'
		| 'healthCheck'
		| 'compatibilityCheck'
		| 'saveProfile'
		| 'selectModel'
		| 'openSettings';
	readonly modelId?: string;
	readonly profile?: Readonly<Record<string, unknown>>;
	readonly visionProbe?: ModelManagerVisionProbe;
	readonly includeOptional?: boolean;
	readonly includeVision?: boolean;
}

export interface ModelManagerPanelOptions {
	readonly getState: (signal?: AbortSignal) => Promise<ModelManagerPanelState>;
	/** Optional catalog listener used to push background refreshes into the panel. */
	readonly onDidChange?: (listener: () => void) => { dispose(): void };
	readonly refresh?: (signal?: AbortSignal) => Promise<ModelManagerPanelState | void>;
	readonly testConnection?: (signal?: AbortSignal) => Promise<ModelManagerTestResult | void>;
	readonly healthCheck?: (
		modelId: string,
		signal?: AbortSignal,
	) => Promise<ModelManagerHealthResult | void>;
	readonly compatibilityCheck?: (
		modelId: string,
		options?: ModelManagerCompatibilityOptions,
		signal?: AbortSignal,
	) => Promise<ModelManagerCompatibilityReport | void>;
	readonly saveProfile?: (
		modelId: string,
		profile: Readonly<Record<string, unknown>>,
		signal?: AbortSignal,
	) => Promise<ModelManagerPanelState | void>;
	readonly selectModel?: (modelId: string) => Promise<void>;
	readonly openSettings?: () => Promise<void> | void;
	readonly strings?: Partial<ModelManagerPanelStrings>;
}

/**
 * UI copy is supplied by the extension host so the panel does not need to
 * import the i18n module.  Defaults are English and can be replaced by the
 * caller's current display language.
 */
export interface ModelManagerPanelStrings {
	title: string;
	description: string;
	refresh: string;
	testConnection: string;
	openSettings: string;
	searchPlaceholder: string;
	allModels: string;
	modelCount: string;
	noModels: string;
	noSelection: string;
	loading: string;
	baseUrl: string;
	apiKeyConfigured: string;
	apiKeyMissing: string;
	lastUpdated: string;
	stale: string;
	metadataIncomplete: string;
	selected: string;
	selectModel: string;
	healthCheck: string;
	healthChecking: string;
	healthUnknown: string;
	healthHealthy: string;
	healthUnhealthy: string;
	protocol: string;
	protocols: string;
	capabilities: string;
	tools: string;
	parallelTools: string;
	visionNative: string;
	visionProxy: string;
	visionNone: string;
	visionAuto: string;
	reasoning: string;
	contextWindow: string;
	inputTokens: string;
	outputTokens: string;
	modelId: string;
	apiModelId: string;
	family: string;
	version: string;
	endpointTypes: string;
	profileSources: string;
	profile: string;
	profileHint: string;
	profilePlaceholder: string;
	formatJson: string;
	saveProfile: string;
	cancel: string;
	statusReady: string;
	statusRefreshing: string;
	statusTesting: string;
	statusSaving: string;
	statusSaved: string;
	statusSelected: string;
	statusHealthPassed: string;
	statusHealthFailed: string;
	statusError: string;
	operationInProgress: string;
	selectionNotConfigured: string;
	profileEditingNotConfigured: string;
	healthNotConfigured: string;
	compatibilityCheck: string;
	compatibilityChecking: string;
	compatibilityTitle: string;
	compatibilityDescription: string;
	compatibilityOptional: string;
	compatibilityVision: string;
	compatibilityConfirmVision: string;
	compatibilityPass: string;
	compatibilityFail: string;
	compatibilityWarn: string;
	compatibilitySkip: string;
	compatibilityNoChecks: string;
	compatibilityReportPassed: string;
	compatibilityReportFailed: string;
	compatibilityLatency: string;
	compatibilityFirstToken: string;
	compatibilityHttp: string;
	compatibilityRequestId: string;
	compatibilityUsage: string;
	compatibilityDetails: string;
	compatibilityTokensPerSecond: string;
	compatibilityResponseChars: string;
	compatibilityFrames: string;
	compatibilityCheckChat: string;
	compatibilityCheckStream: string;
	compatibilityCheckUsage: string;
	compatibilityCheckTools: string;
	compatibilityCheckParallelTools: string;
	compatibilityCheckReasoning: string;
	compatibilityCheckResponses: string;
	compatibilityCheckVision: string;
	compatibilityNativeApplied: string;
	compatibilityNativeApplyFailed: string;
	invalidProfile: string;
	modelNotFound: string;
	unknown: string;
	unknownCapability: string;
	fromGateway: string;
	fromProfile: string;
	fromHeuristic: string;
	fromBuiltin: string;
	fromProbe: string;
	fromUnknown: string;
	confirmDiscard: string;
	filterAll: string;
	filterTools: string;
	filterVision: string;
	filterReasoning: string;
}

export const DEFAULT_MODEL_MANAGER_STRINGS: ModelManagerPanelStrings = {
	title: 'Open Copilot Model Manager',
	description: 'Inspect discovered models, test the gateway, and adjust model profiles.',
	refresh: 'Refresh models',
	testConnection: 'Test connection',
	openSettings: 'Open settings',
	searchPlaceholder: 'Filter models…',
	allModels: 'All models',
	modelCount: '{0} models',
	noModels: 'No models available.',
	noSelection: 'Select a model to view details.',
	loading: 'Loading…',
	baseUrl: 'Base URL',
	apiKeyConfigured: 'Token configured',
	apiKeyMissing: 'Token not configured',
	lastUpdated: 'Last updated',
	stale: 'Stale cache',
	metadataIncomplete: 'Incomplete metadata',
	selected: 'Active',
	selectModel: 'Use this model',
	healthCheck: 'Health check',
	healthChecking: 'Checking…',
	healthUnknown: 'Not checked',
	healthHealthy: 'Healthy',
	healthUnhealthy: 'Unavailable',
	protocol: 'Protocol',
	protocols: 'Protocols',
	capabilities: 'Capabilities',
	tools: 'Tool calling',
	parallelTools: 'Parallel tools',
	visionNative: 'Native vision',
	visionProxy: 'Vision proxy',
	visionNone: 'Text only',
	visionAuto: 'Vision auto',
	reasoning: 'Reasoning',
	contextWindow: 'Context window',
	inputTokens: 'Input tokens',
	outputTokens: 'Output tokens',
	modelId: 'Picker ID',
	apiModelId: 'API model ID',
	family: 'Family',
	version: 'Version',
	endpointTypes: 'Gateway endpoints',
	profileSources: 'Profile sources',
	profile: 'Model profile (JSON)',
	profileHint: 'Only profile fields are saved. Secrets and request headers are not accepted here.',
	profilePlaceholder: '{\n  "protocol": "chat-completions",\n  "imageMode": "auto"\n}',
	formatJson: 'Format JSON',
	saveProfile: 'Save profile',
	cancel: 'Cancel',
	statusReady: 'Ready',
	statusRefreshing: 'Refreshing model directory…',
	statusTesting: 'Testing connection…',
	statusSaving: 'Saving profile…',
	statusSaved: 'Profile saved.',
	statusSelected: 'Model selected.',
	statusHealthPassed: 'Health check passed.',
	statusHealthFailed: 'Health check failed.',
	statusError: 'Operation failed.',
	operationInProgress: 'Another model operation is still running.',
	selectionNotConfigured: 'Model selection is not configured.',
	profileEditingNotConfigured: 'Profile editing is not configured.',
	healthNotConfigured: 'Health check is not configured.',
	compatibilityCheck: 'Compatibility check',
	compatibilityChecking: 'Running compatibility checks…',
	compatibilityTitle: 'Compatibility diagnostics',
	compatibilityDescription:
		'Run bounded probes without sending this conversation or executing tools.',
	compatibilityOptional: 'Include parallel tools, reasoning, and protocol checks',
	compatibilityVision: 'Test native vision (sends a test image; may use tokens)',
	compatibilityConfirmVision:
		'The visual probe sends a tiny test image and may consume tokens. Continue?',
	compatibilityPass: 'Pass',
	compatibilityFail: 'Fail',
	compatibilityWarn: 'Warning',
	compatibilitySkip: 'Not tested',
	compatibilityNoChecks: 'No compatibility checks have been run.',
	compatibilityReportPassed: 'Compatibility checks passed.',
	compatibilityReportFailed: 'Some compatibility checks failed.',
	compatibilityLatency: 'Latency',
	compatibilityFirstToken: 'First token',
	compatibilityHttp: 'HTTP',
	compatibilityRequestId: 'Request ID',
	compatibilityUsage: 'Usage',
	compatibilityDetails: 'Details',
	compatibilityTokensPerSecond: 'Output speed',
	compatibilityResponseChars: 'Response chars',
	compatibilityFrames: 'SSE frames',
	compatibilityCheckChat: 'Chat response',
	compatibilityCheckStream: 'Streaming SSE',
	compatibilityCheckUsage: 'Usage fields',
	compatibilityCheckTools: 'Tool calling',
	compatibilityCheckParallelTools: 'Parallel tools',
	compatibilityCheckReasoning: 'Reasoning',
	compatibilityCheckResponses: 'Responses protocol',
	compatibilityCheckVision: 'Native vision',
	compatibilityNativeApplied:
		'Native image input is enabled. Re-select the model or start a new chat before uploading an image.',
	compatibilityNativeApplyFailed:
		'Native image input could not be saved. Set imageMode to native in the model Profile.',
	invalidProfile: 'Profile must be a JSON object.',
	modelNotFound: 'Model is no longer in the directory.',
	unknown: 'Unknown',
	unknownCapability: 'Unconfirmed',
	fromGateway: 'Gateway',
	fromProfile: 'Profile',
	fromHeuristic: 'Name heuristic',
	fromBuiltin: 'Built-in',
	fromProbe: 'Probe',
	fromUnknown: 'Unknown source',
	confirmDiscard: 'Discard unsaved profile changes?',
	filterAll: 'All',
	filterTools: 'Tools',
	filterVision: 'Vision',
	filterReasoning: 'Reasoning',
};

/** Merge caller-provided copy while ignoring accidental non-string values. */
export function mergeModelManagerStrings(
	strings?: Partial<ModelManagerPanelStrings>,
): ModelManagerPanelStrings {
	const merged = { ...DEFAULT_MODEL_MANAGER_STRINGS };
	for (const [key, value] of Object.entries(strings ?? {})) {
		if (typeof value === 'string' && Object.hasOwn(merged, key)) {
			merged[key as keyof ModelManagerPanelStrings] = value;
		}
	}
	return merged;
}
