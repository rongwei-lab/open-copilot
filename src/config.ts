import vscode from 'vscode';
import { CONFIG_SECTION, DEFAULT_NEW_API_BASE_URL } from './consts';
import { IMAGE_DESCRIPTION_PROMPT } from './provider/vision/consts';

export type DebugMode = 'minimal' | 'metadata' | 'verbose';
export type UnknownModelPolicy = 'safe' | 'optimistic' | 'hide';
export type ApiProtocol = 'chat-completions' | 'responses';
export type ResponsesTruncation = 'auto' | 'disabled';
export type ResponsesReasoningSummary = 'auto' | 'none' | 'summary' | 'raw';
export type IncludeUsageMode = 'auto' | 'always' | 'never';
export type VisionMode = 'auto' | 'native' | 'proxy' | 'none';

/** User-configurable, provider-neutral capability profile. */
export interface ModelReasoningSettings {
	enabled?: boolean;
	efforts?: readonly string[];
	defaultEffort?: string;
	canDisable?: boolean;
	requestStyle?: 'chat-reasoning-effort' | 'chat-thinking' | 'responses-object' | 'none';
	effortMap?: Readonly<Record<string, string>>;
	outputStyle?: 'summary' | 'raw' | 'none';
}

export interface ModelProfileSettings {
	enabled?: boolean;
	apiModelId?: string;
	displayName?: string;
	family?: string;
	version?: string;
	order?: number;
	protocol?: ApiProtocol;
	toolCalling?: boolean;
	parallelToolCalls?: boolean;
	imageMode?: VisionMode;
	nativeImageInput?: boolean;
	maxInputTokens?: number;
	maxOutputTokens?: number;
	/** Total context window; the resolver derives the input/output split. */
	contextWindowTokens?: number;
	maxTokensField?: 'max_tokens' | 'max_completion_tokens';
	reasoning?: ModelReasoningSettings;
	strictTools?: boolean;
	allowProtocolFallback?: boolean;
	extraRequestFields?: Readonly<Record<string, unknown>>;
}

export interface ModelRuleSettings {
	match: string;
	profile: ModelProfileSettings;
}

export interface ModelDiscoverySettings {
	enabled: boolean;
	cacheTtlMinutes: number;
	includePatterns: readonly string[];
	excludePatterns: readonly string[];
}

export interface ResponsesSettings {
	enabled: boolean;
	store: boolean;
	truncation: ResponsesTruncation;
	reasoningSummary: ResponsesReasoningSummary;
}

export interface NewApiSettings {
	baseUrl: string;
	maxTokens: number;
	modelIdOverrides: Readonly<Record<string, string>>;
	modelDiscovery: ModelDiscoverySettings;
	unknownModelPolicy: UnknownModelPolicy;
	defaultProtocol: ApiProtocol;
	responses: ResponsesSettings;
	chatIncludeUsage: IncludeUsageMode;
	requestTimeoutMs: number;
	modelRules: readonly ModelRuleSettings[];
	modelProfiles: Readonly<Record<string, ModelProfileSettings>>;
	visionMode: VisionMode;
	visionModel: string;
	visionPrompt: string;
	debugMode: DebugMode;
	stabilizeToolList: boolean;
}

export const DEFAULT_MODEL_EXCLUDE_PATTERNS = [
	'*embedding*',
	'*rerank*',
	'*tts*',
	'*whisper*',
	'*moderation*',
	'*image-generation*',
	'*video-generation*',
	'*gpt-image*',
	'*chatgpt-image*',
	'*gemini-*-image*',
	'*imagen*',
	'*veo*',
	'*qwen-image*',
	'*wan*-image*',
	'*grok-imagine*',
	'*dall-e*',
	'*sora*',
	'*seedream*',
	'*seedance*',
	'*kling*',
	'*jimeng*',
	'*vidu*',
	'*jina-clip*',
	'*realtime*',
	'*live-translate*',
	'*embed*',
] as const;

export const DEFAULT_VISION_PROMPT = IMAGE_DESCRIPTION_PROMPT;

/** Read a setting from the New API namespace. */
export function getConfigValue<T>(
	key: string,
	defaultValue?: T,
	resource?: vscode.ConfigurationScope,
): T | undefined {
	const current = vscode.workspace.getConfiguration(CONFIG_SECTION, resource);
	return current.get<T>(key, defaultValue as T);
}

/** Get and normalize the New API OpenAI-compatible API root. */
export function getBaseUrl(): string {
	const value = getConfigValue<string>('baseUrl');
	return normalizeBaseUrl(value) ?? DEFAULT_NEW_API_BASE_URL;
}

export function normalizeBaseUrl(value: unknown): string | undefined {
	if (typeof value !== 'string' || value.trim().length === 0) return undefined;
	const trimmed = value.trim().replace(/\/+$/, '');
	return /^https?:\/\//i.test(trimmed) ? trimmed : undefined;
}

/** Resolve the API model ID, applying the configured New API alias map. */
export function getApiModelId(vscodeModelId: string): string {
	const overrides = getConfigValue<Record<string, string>>('modelIdOverrides');
	const override = overrides?.[vscodeModelId];
	return typeof override === 'string' && override.trim() ? override.trim() : vscodeModelId;
}

/** Get the configured max output token limit; zero means API default. */
export function getMaxTokens(): number | undefined {
	const value = getFiniteNonNegativeNumber(getConfigValue<unknown>('maxTokens', 0));
	return value !== undefined && value > 0 ? value : undefined;
}

export function getModelDiscoveryConfig(): ModelDiscoverySettings {
	const enabled = getConfigValue<boolean>('modelDiscovery.enabled', true) === true;
	const cacheTtlMinutes = clampInteger(
		getConfigValue<unknown>('modelDiscovery.cacheTtlMinutes', 15),
		1,
		24 * 60,
		15,
	);
	const includePatterns = normalizePatterns(
		getConfigValue<unknown>('modelDiscovery.includePatterns', []),
	);
	const excludePatterns = normalizePatterns(
		getConfigValue<unknown>('modelDiscovery.excludePatterns', DEFAULT_MODEL_EXCLUDE_PATTERNS),
	);
	return { enabled, cacheTtlMinutes, includePatterns, excludePatterns };
}

export function getUnknownModelPolicy(): UnknownModelPolicy {
	const value = getConfigValue<unknown>('unknownModelPolicy', 'safe');
	return value === 'optimistic' || value === 'hide' || value === 'safe' ? value : 'safe';
}

export function getDefaultProtocol(): ApiProtocol {
	const value = getConfigValue<unknown>('defaultProtocol', 'chat-completions');
	return value === 'responses' ? 'responses' : 'chat-completions';
}

export function getResponsesConfig(): ResponsesSettings {
	const truncation = getConfigValue<unknown>('responses.truncation', 'auto');
	const reasoningSummary = getConfigValue<unknown>('responses.reasoningSummary', 'auto');
	return {
		enabled: getConfigValue<boolean>('responses.enabled', false) === true,
		store: getConfigValue<boolean>('responses.store', false) === true,
		truncation: truncation === 'disabled' ? 'disabled' : 'auto',
		reasoningSummary:
			reasoningSummary === 'none' || reasoningSummary === 'summary' || reasoningSummary === 'raw'
				? reasoningSummary
				: 'auto',
	};
}

export function getChatIncludeUsage(): IncludeUsageMode {
	const value = getConfigValue<unknown>('chat.includeUsage', 'auto');
	return value === 'always' || value === 'never' || value === 'auto' ? value : 'auto';
}

export function getRequestTimeoutMs(): number {
	return clampInteger(
		getConfigValue<unknown>('requestTimeoutMs', 120_000),
		1_000,
		600_000,
		120_000,
	);
}

export function getVisionMode(): VisionMode {
	const value = getConfigValue<unknown>('vision.mode', 'auto');
	return value === 'native' || value === 'proxy' || value === 'none' || value === 'auto'
		? value
		: 'auto';
}

export function getVisionModel(): string | undefined {
	const value = getConfigValue<string>('visionModel');
	return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

export function getVisionPrompt(): string {
	const value = getConfigValue<string>('visionPrompt');
	return typeof value === 'string' && value.trim() ? value.trim() : DEFAULT_VISION_PROMPT;
}

export function getModelProfiles(): Readonly<Record<string, ModelProfileSettings>> {
	const raw = getConfigValue<unknown>('modelProfiles', {});
	if (!isRecord(raw)) return {};
	const result: Record<string, ModelProfileSettings> = {};
	for (const [modelId, profile] of Object.entries(raw)) {
		if (!modelId.trim()) continue;
		const normalized = normalizeModelProfile(profile);
		if (normalized) result[modelId] = normalized;
	}
	return result;
}

/**
 * Merge an exact model Profile into the user configuration.
 *
 * The language-model manager invokes the provider's management command when
 * the user clicks "Add Model".  Keeping this write in the configuration layer
 * makes that flow preserve existing fields (for example context limits or a
 * reasoning profile) instead of replacing the whole model entry.
 */
export async function updateModelProfile(
	modelId: string,
	patch: ModelProfileSettings,
): Promise<void> {
	const normalizedId = modelId.trim();
	if (!normalizedId) throw new Error('Model profile ID cannot be empty');
	if (isUnsafeProfileKey(normalizedId)) {
		throw new Error('Model profile ID is not a valid object key');
	}

	const raw = getConfigValue<unknown>('modelProfiles', {});
	const profiles: Record<string, Record<string, unknown>> = {};
	if (isRecord(raw)) {
		for (const [id, value] of Object.entries(raw)) {
			if (isUnsafeProfileKey(id)) continue;
			if (isRecord(value)) profiles[id] = { ...value };
		}
	}

	const merged: Record<string, unknown> = { ...profiles[normalizedId], ...patch };
	for (const [key, value] of Object.entries(merged)) {
		if (value === undefined) delete merged[key];
	}
	profiles[normalizedId] = merged;

	await vscode.workspace
		.getConfiguration(CONFIG_SECTION)
		.update('modelProfiles', profiles, vscode.ConfigurationTarget.Global);
}

function isUnsafeProfileKey(value: string): boolean {
	return value === '__proto__' || value === 'prototype' || value === 'constructor';
}

export function getModelRules(): readonly ModelRuleSettings[] {
	const raw = getConfigValue<unknown>('modelRules', []);
	if (!Array.isArray(raw)) return [];
	const result: ModelRuleSettings[] = [];
	for (const item of raw) {
		if (!isRecord(item) || typeof item.match !== 'string' || !item.match.trim()) continue;
		const profile = normalizeModelProfile(item.profile);
		if (profile) result.push({ match: item.match.trim(), profile });
	}
	return result;
}

export function getNewApiSettings(): NewApiSettings {
	const discovery = getModelDiscoveryConfig();
	const responses = getResponsesConfig();
	return {
		baseUrl: getBaseUrl(),
		maxTokens: getFiniteNonNegativeNumber(getConfigValue<unknown>('maxTokens', 0)) ?? 0,
		modelIdOverrides: normalizeStringMap(getConfigValue<unknown>('modelIdOverrides', {})),
		modelDiscovery: discovery,
		unknownModelPolicy: getUnknownModelPolicy(),
		defaultProtocol: getDefaultProtocol(),
		responses,
		chatIncludeUsage: getChatIncludeUsage(),
		requestTimeoutMs: getRequestTimeoutMs(),
		modelRules: getModelRules(),
		modelProfiles: getModelProfiles(),
		visionMode: getVisionMode(),
		visionModel: getVisionModel() ?? '',
		visionPrompt: getVisionPrompt(),
		debugMode: getDebugMode(),
		stabilizeToolList: getStabilizeToolListEnabled(),
	};
}

/** Diagnostic mode; `verbose` also enables metadata logs. */
export function getDebugMode(): DebugMode {
	return normalizeDebugMode(getConfigValue<unknown>('debugMode', 'minimal')) ?? 'minimal';
}

export function getDebugLoggingEnabled(): boolean {
	return getDebugMode() !== 'minimal';
}

export function getRequestDumpEnabled(): boolean {
	return getDebugMode() === 'verbose';
}

export function getStabilizeToolListEnabled(): boolean {
	return getConfigValue<boolean>('experimental.stabilizeToolList', false) === true;
}

function normalizeModelProfile(value: unknown): ModelProfileSettings | undefined {
	if (!isRecord(value)) return undefined;
	const profile: ModelProfileSettings = {};
	if (typeof value.enabled === 'boolean') profile.enabled = value.enabled;
	for (const key of ['apiModelId', 'displayName', 'family', 'version'] as const) {
		if (typeof value[key] === 'string' && value[key].trim()) profile[key] = value[key].trim();
	}
	const order = getFiniteNonNegativeNumber(value.order);
	if (order !== undefined) profile.order = order;
	if (value.protocol === 'chat-completions' || value.protocol === 'responses') {
		profile.protocol = value.protocol;
	}
	if (typeof value.toolCalling === 'boolean') profile.toolCalling = value.toolCalling;
	if (typeof value.parallelToolCalls === 'boolean')
		profile.parallelToolCalls = value.parallelToolCalls;
	if (
		value.imageMode === 'auto' ||
		value.imageMode === 'native' ||
		value.imageMode === 'proxy' ||
		value.imageMode === 'none'
	) {
		profile.imageMode = value.imageMode;
	}
	if (typeof value.nativeImageInput === 'boolean')
		profile.nativeImageInput = value.nativeImageInput;
	const maxInputTokens = getFiniteNonNegativeNumber(value.maxInputTokens);
	const maxOutputTokens = getFiniteNonNegativeNumber(value.maxOutputTokens);
	const contextWindowTokens = getFiniteNonNegativeNumber(value.contextWindowTokens);
	if (maxInputTokens !== undefined && maxInputTokens > 0) profile.maxInputTokens = maxInputTokens;
	if (maxOutputTokens !== undefined && maxOutputTokens > 0)
		profile.maxOutputTokens = maxOutputTokens;
	if (contextWindowTokens !== undefined && contextWindowTokens > 0)
		profile.contextWindowTokens = contextWindowTokens;
	if (value.maxTokensField === 'max_tokens' || value.maxTokensField === 'max_completion_tokens') {
		profile.maxTokensField = value.maxTokensField;
	}
	if (typeof value.strictTools === 'boolean') profile.strictTools = value.strictTools;
	if (typeof value.allowProtocolFallback === 'boolean')
		profile.allowProtocolFallback = value.allowProtocolFallback;
	if (isRecord(value.extraRequestFields)) {
		profile.extraRequestFields = Object.freeze({ ...value.extraRequestFields });
	}
	if (isRecord(value.reasoning)) {
		const reasoning: ModelReasoningSettings = {};
		if (typeof value.reasoning.enabled === 'boolean') reasoning.enabled = value.reasoning.enabled;
		if (Array.isArray(value.reasoning.efforts)) {
			const efforts = value.reasoning.efforts.filter(
				(item): item is string => typeof item === 'string' && item.trim().length > 0,
			);
			if (efforts.length > 0 || value.reasoning.efforts.length === 0) {
				reasoning.efforts = [...new Set(efforts.map((item) => item.trim()))];
			}
		}
		if (typeof value.reasoning.defaultEffort === 'string' && value.reasoning.defaultEffort.trim()) {
			reasoning.defaultEffort = value.reasoning.defaultEffort.trim();
		}
		if (typeof value.reasoning.canDisable === 'boolean')
			reasoning.canDisable = value.reasoning.canDisable;
		if (
			value.reasoning.requestStyle === 'chat-reasoning-effort' ||
			value.reasoning.requestStyle === 'chat-thinking' ||
			value.reasoning.requestStyle === 'responses-object' ||
			value.reasoning.requestStyle === 'none'
		) {
			reasoning.requestStyle = value.reasoning.requestStyle;
		}
		if (
			value.reasoning.outputStyle === 'summary' ||
			value.reasoning.outputStyle === 'raw' ||
			value.reasoning.outputStyle === 'none'
		) {
			reasoning.outputStyle = value.reasoning.outputStyle;
		}
		if (isRecord(value.reasoning.effortMap)) {
			const effortMap: Record<string, string> = {};
			for (const [key, mapped] of Object.entries(value.reasoning.effortMap)) {
				if (typeof mapped === 'string' && mapped.trim()) effortMap[key] = mapped.trim();
			}
			if (Object.keys(effortMap).length > 0) reasoning.effortMap = effortMap;
		}
		profile.reasoning = reasoning;
	}
	return profile;
}

function normalizePatterns(value: unknown): readonly string[] {
	if (!Array.isArray(value)) return [];
	return [
		...new Set(
			value
				.filter((item): item is string => typeof item === 'string')
				.map((item) => item.trim())
				.filter(Boolean),
		),
	];
}

function normalizeStringMap(value: unknown): Readonly<Record<string, string>> {
	if (!isRecord(value)) return {};
	const result: Record<string, string> = {};
	for (const [key, item] of Object.entries(value)) {
		if (typeof item === 'string' && item.trim()) result[key] = item.trim();
	}
	return result;
}

function normalizeDebugMode(value: unknown): DebugMode | undefined {
	if (value === 'minimal' || value === 'metadata' || value === 'verbose') return value;
	return undefined;
}

function getFiniteNonNegativeNumber(value: unknown): number | undefined {
	return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function clampInteger(value: unknown, minimum: number, maximum: number, fallback: number): number {
	const number = getFiniteNonNegativeNumber(value);
	if (number === undefined) return fallback;
	return Math.min(maximum, Math.max(minimum, Math.floor(number)));
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}
