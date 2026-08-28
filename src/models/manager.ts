import type { ModelProfileSettings, ModelReasoningSettings } from '../config';
import { NewApiError, redactExactSecret } from '../newapi';
import type { ResolvedModel } from './profile';
import type {
	ModelManagerCatalogError,
	ModelManagerModel,
	ModelManagerVisionProbe,
} from './ui/types';

const EDITABLE_PROFILE_KEYS = [
	'enabled',
	'apiModelId',
	'displayName',
	'family',
	'version',
	'order',
	'protocol',
	'toolCalling',
	'parallelToolCalls',
	'imageMode',
	'nativeImageInput',
	'maxInputTokens',
	'maxOutputTokens',
	'contextWindowTokens',
	'maxTokensField',
	'reasoning',
	'strictTools',
	'allowProtocolFallback',
] as const satisfies readonly (keyof ModelProfileSettings)[];

const EDITABLE_PROFILE_KEY_SET = new Set<string>(EDITABLE_PROFILE_KEYS);
const EDITABLE_REASONING_KEYS = [
	'enabled',
	'efforts',
	'defaultEffort',
	'canDisable',
	'requestStyle',
	'effortMap',
	'outputStyle',
] as const satisfies readonly (keyof ModelReasoningSettings)[];
const EDITABLE_REASONING_KEY_SET = new Set<string>(EDITABLE_REASONING_KEYS);

/** Error raised when a webview profile payload is outside the supported schema. */
export class ModelManagerProfileError extends Error {
	readonly code = 'invalid_model_profile';

	constructor(message: string) {
		super(message);
		this.name = 'ModelManagerProfileError';
	}
}

/** Project a resolved model into the JSON-safe shape exposed to the webview. */
export function toModelManagerModel(
	model: ResolvedModel,
	exactProfile: ModelProfileSettings | undefined,
	visionProbe?: ModelManagerVisionProbe,
): ModelManagerModel {
	const reasoning = model.capabilities.reasoning;
	const capabilitySources = getCapabilitySources(model, exactProfile);
	return {
		id: model.id,
		apiModelId: model.apiModelId,
		displayName: model.displayName,
		family: model.family,
		version: model.version,
		maxInputTokens: model.maxInputTokens,
		maxOutputTokens: model.maxOutputTokens,
		protocols: [...model.protocols],
		selectedProtocol: model.selectedProtocol,
		capabilities: {
			toolCalling: model.capabilities.toolCalling,
			parallelToolCalls: model.capabilities.parallelToolCalls,
			imageMode: model.capabilities.imageMode,
			reasoning: {
				enabled: reasoning.enabled,
				efforts: [...reasoning.efforts],
				defaultEffort: reasoning.defaultEffort,
				canDisable: reasoning.canDisable,
				requestStyle: reasoning.requestStyle,
				effortMap: reasoning.effortMap ? { ...reasoning.effortMap } : undefined,
			},
			sources: capabilitySources,
		},
		// Show only the exact user profile. Inferred/built-in values remain visible
		// in the capability summary, but are not silently persisted by Save.
		profile: toEditableModelProfile(exactProfile),
		visionProbe,
		source: {
			endpointTypes: [...model.source.endpointTypes],
			profileIds: [...model.source.profileIds],
			metadataIncomplete: model.source.metadataIncomplete,
			fromStaleCache: model.source.fromStaleCache,
		},
	};
}

/**
 * Preserve provenance without pretending that `/models` exposes capabilities
 * it does not actually publish. Only explicit user Profiles/rules and the
 * extension's built-in rules are labelled; unknown defaults remain unconfirmed.
 */
function getCapabilitySources(
	model: ResolvedModel,
	exactProfile: ModelProfileSettings | undefined,
): Readonly<Record<string, string>> | undefined {
	const sources: Record<string, string> = {};
	const profileIds = model.source.profileIds;
	const hasBuiltIn = profileIds.some(
		(id) => id.startsWith('builtInRule:') || id.startsWith('builtInProfile:'),
	);
	if (exactProfile?.toolCalling !== undefined) {
		sources.toolCalling = 'profile';
	} else if (hasBuiltIn) {
		sources.toolCalling = 'builtin';
	}
	if (exactProfile?.parallelToolCalls !== undefined) {
		sources.parallelToolCalls = 'profile';
	} else if (hasBuiltIn) {
		sources.parallelToolCalls = 'builtin';
	}
	if (exactProfile?.imageMode !== undefined || exactProfile?.nativeImageInput !== undefined) {
		sources.imageMode = 'profile';
	} else if (profileIds.includes('upstreamMetadata:vision')) {
		sources.imageMode = 'gateway';
	} else if (hasBuiltIn) {
		sources.imageMode = 'builtin';
	}
	if (exactProfile?.reasoning !== undefined) {
		sources.reasoning = 'profile';
	} else if (profileIds.includes('upstreamMetadata:reasoning')) {
		sources.reasoning = 'gateway';
	} else if (hasBuiltIn) {
		sources.reasoning = 'builtin';
	}
	return Object.keys(sources).length > 0 ? sources : undefined;
}

/**
 * Validate an editable Profile submitted by the webview.
 *
 * Request headers and arbitrary request-body fields are intentionally not
 * accepted here. Advanced users can still maintain those fields directly in
 * settings; saving from the manager preserves them without exposing them to
 * the browser context.
 */
export function parseModelManagerProfile(
	value: Readonly<Record<string, unknown>>,
): ModelProfileSettings {
	for (const key of Object.keys(value)) {
		if (!EDITABLE_PROFILE_KEY_SET.has(key)) {
			throw new ModelManagerProfileError(`Unsupported model profile field: ${key}`);
		}
	}

	const profile: ModelProfileSettings = {};
	assignOptionalBoolean(value, profile, 'enabled');
	assignOptionalString(value, profile, 'apiModelId');
	assignOptionalString(value, profile, 'displayName');
	assignOptionalString(value, profile, 'family');
	assignOptionalString(value, profile, 'version');
	assignOptionalInteger(value, profile, 'order', 0);
	assignOptionalEnum(value, profile, 'protocol', ['chat-completions', 'responses']);
	assignOptionalBoolean(value, profile, 'toolCalling');
	assignOptionalBoolean(value, profile, 'parallelToolCalls');
	assignOptionalEnum(value, profile, 'imageMode', ['auto', 'native', 'proxy', 'none']);
	assignOptionalBoolean(value, profile, 'nativeImageInput');
	assignOptionalInteger(value, profile, 'maxInputTokens', 1);
	assignOptionalInteger(value, profile, 'maxOutputTokens', 1);
	assignOptionalInteger(value, profile, 'contextWindowTokens', 1);
	assignOptionalEnum(value, profile, 'maxTokensField', ['max_tokens', 'max_completion_tokens']);
	assignOptionalBoolean(value, profile, 'strictTools');
	assignOptionalBoolean(value, profile, 'allowProtocolFallback');

	if (Object.hasOwn(value, 'reasoning')) {
		if (!isRecord(value.reasoning)) {
			throw new ModelManagerProfileError('reasoning must be a JSON object');
		}
		profile.reasoning = parseReasoningProfile(value.reasoning);
	}
	return profile;
}

/**
 * Convert the validated editor value into a replacement patch for editable
 * fields. Omitted fields are explicitly removed while advanced fields outside
 * this UI (for example extraRequestFields) remain intact.
 */
export function createModelManagerProfilePatch(
	profile: ModelProfileSettings,
): ModelProfileSettings {
	const replacement = Object.fromEntries(
		EDITABLE_PROFILE_KEYS.map((key) => [key, undefined]),
	) as ModelProfileSettings;
	return { ...replacement, ...profile };
}

/** Return a bounded, redacted error suitable for displaying inside a webview. */
export function toModelManagerCatalogError(
	error: unknown,
	fallbackMessage: string,
	secret?: string,
): ModelManagerCatalogError {
	const message = sanitizeModelManagerMessage(
		error instanceof Error && error.message ? error.message : fallbackMessage,
		secret,
	);
	const candidate = error as {
		code?: unknown;
		status?: unknown;
		requestId?: unknown;
	};
	const code = typeof candidate?.code === 'string' ? candidate.code : undefined;
	const status = typeof candidate?.status === 'number' ? candidate.status : undefined;
	const requestId = typeof candidate?.requestId === 'string' ? candidate.requestId : undefined;
	return {
		code,
		status,
		requestId,
		message,
		retryable:
			status === 408 ||
			status === 429 ||
			(status !== undefined && status >= 500) ||
			code === 'timeout' ||
			code === 'network' ||
			code === 'models_timeout' ||
			code === 'models_network_error',
	};
}

export function sanitizeModelManagerMessage(value: string, secret?: string): string {
	let result = value;
	if (secret?.trim()) {
		result = redactExactSecret(result, secret, '<redacted>');
	}
	return result
		.replace(/bearer\s+[^\s,;]+/giu, 'Bearer <redacted>')
		.replace(/\bsk-[a-z0-9._~-]+/giu, 'sk-<redacted>')
		.replace(/authorization\s*[:=]\s*[^\s,;]+/giu, 'Authorization: <redacted>')
		.replace(/\s+/gu, ' ')
		.trim()
		.slice(0, 512);
}

/** Extract a response model identifier without exposing the full API body. */
export function getResponseModel(value: unknown): string | undefined {
	if (!isRecord(value)) return undefined;
	if (typeof value.model === 'string' && value.model.trim()) return value.model.trim();
	if (isRecord(value.response) && typeof value.response.model === 'string') {
		return value.response.model.trim() || undefined;
	}
	return undefined;
}

export function isNewApiError(error: unknown): error is NewApiError {
	return error instanceof NewApiError;
}

function toEditableModelProfile(
	profile: ModelProfileSettings | undefined,
): Readonly<Record<string, unknown>> {
	if (!profile) return {};
	const result: Record<string, unknown> = {};
	for (const key of EDITABLE_PROFILE_KEYS) {
		if (key === 'reasoning') {
			const reasoning = profile.reasoning;
			if (reasoning === undefined) continue;
			result.reasoning = {
				...reasoning,
				efforts: reasoning.efforts ? [...reasoning.efforts] : undefined,
				effortMap: reasoning.effortMap ? { ...reasoning.effortMap } : undefined,
			};
			continue;
		}
		const value = profile[key];
		if (value !== undefined) result[key] = value;
	}
	return result;
}

function parseReasoningProfile(value: Readonly<Record<string, unknown>>): ModelReasoningSettings {
	for (const key of Object.keys(value)) {
		if (!EDITABLE_REASONING_KEY_SET.has(key)) {
			throw new ModelManagerProfileError(`Unsupported reasoning profile field: ${key}`);
		}
	}
	const reasoning: ModelReasoningSettings = {};
	assignOptionalBoolean(value, reasoning, 'enabled');
	assignOptionalString(value, reasoning, 'defaultEffort');
	assignOptionalBoolean(value, reasoning, 'canDisable');
	assignOptionalEnum(value, reasoning, 'requestStyle', [
		'chat-reasoning-effort',
		'chat-thinking',
		'responses-object',
		'none',
	]);
	assignOptionalEnum(value, reasoning, 'outputStyle', ['summary', 'raw', 'none']);

	if (Object.hasOwn(value, 'efforts')) {
		if (!Array.isArray(value.efforts) || value.efforts.length > 32) {
			throw new ModelManagerProfileError(
				'reasoning.efforts must be an array of at most 32 strings',
			);
		}
		const efforts = value.efforts.map((entry, index) =>
			assertNonEmptyString(entry, `reasoning.efforts[${index}]`),
		);
		reasoning.efforts = [...new Set(efforts)];
	}
	if (Object.hasOwn(value, 'effortMap')) {
		if (!isRecord(value.effortMap)) {
			throw new ModelManagerProfileError('reasoning.effortMap must be a JSON object');
		}
		const effortMap: Record<string, string> = {};
		for (const [key, entry] of Object.entries(value.effortMap)) {
			const normalizedKey = assertNonEmptyString(key, 'reasoning.effortMap key');
			effortMap[normalizedKey] = assertNonEmptyString(
				entry,
				`reasoning.effortMap.${normalizedKey}`,
			);
		}
		reasoning.effortMap = effortMap;
	}
	return reasoning;
}

function assignOptionalBoolean(
	input: Readonly<Record<string, unknown>>,
	output: object,
	key: string,
): void {
	if (!Object.hasOwn(input, key)) return;
	if (typeof input[key] !== 'boolean') {
		throw new ModelManagerProfileError(`${key} must be a boolean`);
	}
	(output as Record<string, unknown>)[key] = input[key];
}

function assignOptionalString(
	input: Readonly<Record<string, unknown>>,
	output: object,
	key: string,
): void {
	if (!Object.hasOwn(input, key)) return;
	(output as Record<string, unknown>)[key] = assertNonEmptyString(input[key], key);
}

function assignOptionalInteger(
	input: Readonly<Record<string, unknown>>,
	output: object,
	key: string,
	minimum: number,
): void {
	if (!Object.hasOwn(input, key)) return;
	const value = input[key];
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum) {
		throw new ModelManagerProfileError(
			`${key} must be an integer greater than or equal to ${minimum}`,
		);
	}
	(output as Record<string, unknown>)[key] = value;
}

function assignOptionalEnum(
	input: Readonly<Record<string, unknown>>,
	output: object,
	key: string,
	allowed: readonly string[],
): void {
	if (!Object.hasOwn(input, key)) return;
	const value = input[key];
	if (typeof value !== 'string' || !allowed.includes(value)) {
		throw new ModelManagerProfileError(`${key} must be one of: ${allowed.join(', ')}`);
	}
	(output as Record<string, unknown>)[key] = value;
}

function assertNonEmptyString(value: unknown, field: string): string {
	if (typeof value !== 'string' || !value.trim()) {
		throw new ModelManagerProfileError(`${field} must be a non-empty string`);
	}
	const normalized = value.trim();
	if (normalized.length > 512) {
		throw new ModelManagerProfileError(`${field} is too long`);
	}
	return normalized;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}
