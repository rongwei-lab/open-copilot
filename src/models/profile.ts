import type { ModelDefinition, ReasoningEffort } from '../types';
import type {
	ModelReasoningMetadata,
	ModelTokenLimits,
	ModelVisionMetadata,
} from '../protocols/model-metadata';

/**
 * Model discovery domain types and capability/profile resolution.
 *
 * This module deliberately has no VS Code or provider dependencies.  It can
 * therefore be used by the model picker as well as by a request adapter, and
 * it is straightforward to test with plain objects.
 */

export type ApiProtocol = 'chat-completions' | 'responses';

export type ImageMode = 'none' | 'proxy' | 'native' | 'auto';

export type UnknownModelPolicy = 'hide' | 'safe' | 'optimistic';

export const CHAT_ENDPOINT_TYPE = 'openai';
export const RESPONSES_ENDPOINT_TYPE = 'openai-response';
export const RESPONSES_COMPACT_ENDPOINT_TYPE = 'openai-response-compact';

/**
 * Conservative limits used only when the gateway does not publish model
 * metadata and no user Profile overrides them.  VS Code renders the context
 * indicator as maxInputTokens + maxOutputTokens, so these values deliberately
 * add up to 128K instead of accidentally advertising 136K.
 */
export const DEFAULT_CONTEXT_WINDOW_TOKENS = 128_000;
export const DEFAULT_MAX_OUTPUT_TOKENS = 8_192;
export const DEFAULT_MAX_INPUT_TOKENS = DEFAULT_CONTEXT_WINDOW_TOKENS - DEFAULT_MAX_OUTPUT_TOKENS;
const DEFAULT_REASONING_EFFORTS = ['low', 'medium', 'high'] as const;

/** A model returned by New API's `/v1/models` endpoint. */
export interface RemoteModel {
	readonly id: string;
	readonly object?: string;
	readonly created?: number;
	readonly ownedBy?: string;
	/** Values are retained even when they are not known to this extension. */
	readonly supportedEndpointTypes: readonly string[];
	/** True when the gateway omitted or malformed endpoint metadata. */
	readonly metadataIncomplete: boolean;
	/** Unknown endpoint values are useful for diagnostics, but never grant a capability. */
	readonly unknownEndpointTypes?: readonly string[];
	/** Optional token limits forwarded by a compatible model registry. */
	readonly contextWindowTokens?: number;
	readonly maxInputTokens?: number;
	readonly maxOutputTokens?: number;
	/** Optional reasoning capability metadata forwarded by the gateway. */
	readonly reasoning?: ModelReasoningMetadata;
	/** Optional explicit native image-input metadata forwarded by the gateway. */
	readonly vision?: ModelVisionMetadata;
	/** The raw item is intentionally never logged by this module. */
	readonly raw?: Readonly<Record<string, unknown>>;
}

export interface ReasoningProfile {
	enabled: boolean;
	efforts: string[];
	defaultEffort?: string;
	canDisable: boolean;
	requestStyle?: 'chat-reasoning-effort' | 'chat-thinking' | 'responses-object' | 'none';
	effortMap?: Record<string, string>;
	outputStyle: 'summary' | 'raw' | 'none';
}

/**
 * A partial profile is accepted at every configuration layer.  Merge is
 * field-level, so a rule changing `imageMode` does not erase its reasoning
 * settings.
 */
export interface ModelProfile {
	enabled?: boolean;
	apiModelId?: string;
	displayName?: string;
	family?: string;
	version?: string;
	order?: number;
	protocol?: ApiProtocol;
	allowProtocolFallback?: boolean;
	maxInputTokens?: number;
	maxOutputTokens?: number;
	/** Total context window; used to derive the VS Code input/output split. */
	contextWindowTokens?: number;
	maxTokensField?: 'max_tokens' | 'max_completion_tokens';
	toolCalling?: boolean;
	parallelToolCalls?: boolean;
	imageMode?: ImageMode;
	nativeImageInput?: boolean;
	reasoning?: Partial<ReasoningProfile> & { enabled?: boolean };
	strictTools?: boolean;
	/** Adapter-specific fields.  The adapter must apply its own allow-list. */
	extraRequestFields?: Record<string, unknown>;
}

export interface ModelRule {
	readonly id?: string;
	readonly match: string;
	readonly profile: ModelProfile;
}

export interface ProfileResolverOptions {
	/** User exact profiles; keys are remote model IDs. */
	readonly exactProfiles?: Readonly<Record<string, ModelProfile>>;
	/** User rules. Later matching rules override earlier matching rules. */
	readonly rules?: readonly ModelRule[];
	/** Built-in exact profiles (for example, DeepSeek compatibility mappings). */
	readonly builtInProfiles?: Readonly<Record<string, ModelProfile>>;
	/** Built-in family/model rules. */
	readonly builtInRules?: readonly ModelRule[];
	/** Defaults applied to models without a more specific profile. */
	readonly unknownModelDefaults?: ModelProfile;
	readonly unknownModelPolicy?: UnknownModelPolicy;
	readonly defaultProtocol?: ApiProtocol;
	/** Responses are opt-in unless a profile explicitly chooses responses. */
	readonly responsesEnabled?: boolean;
	readonly includePatterns?: readonly string[];
	readonly excludePatterns?: readonly string[];
	/** Name heuristics are intentionally narrow and can be disabled. */
	readonly excludeHeuristics?: boolean;
	readonly defaultMaxInputTokens?: number;
	readonly defaultMaxOutputTokens?: number;
}

export interface ResolvedModel {
	readonly id: string;
	readonly apiModelId: string;
	readonly displayName: string;
	readonly family: string;
	readonly version: string;
	readonly maxInputTokens: number;
	readonly maxOutputTokens: number;
	readonly protocols: readonly ApiProtocol[];
	readonly selectedProtocol: ApiProtocol;
	readonly capabilities: {
		readonly toolCalling: boolean;
		readonly parallelToolCalls: boolean;
		readonly imageMode: ImageMode;
		readonly reasoning: ReasoningProfile;
	};
	readonly profile: Readonly<ModelProfile>;
	readonly source: {
		readonly endpointTypes: readonly string[];
		readonly profileIds: readonly string[];
		readonly metadataIncomplete: boolean;
		/** Set to true only when this model came from an expired cache. */
		readonly fromStaleCache: boolean;
	};
}

export interface ProfileResolution {
	readonly model?: ResolvedModel;
	readonly mergedProfile: Readonly<ModelProfile>;
	readonly profileIds: readonly string[];
	readonly hasExactProfile: boolean;
	readonly hasExplicitProtocol: boolean;
	readonly reason?: string;
}

/**
 * Bridge a resolved dynamic model to the legacy provider's model shape.
 *
 * The generic New API path intentionally does not invent pricing or vendor
 * thinking fields.  Consumers that still use `provider/models.ts` can use
 * this bridge while the provider is migrated to `ResolvedModel` directly.
 */
export function toModelDefinition(model: ResolvedModel): ModelDefinition {
	const reasoning = model.capabilities.reasoning;
	// `imageInput` is consumed by the VS Code picker as an assertion that this
	// specific model accepts raw image parts. The extension's proxy path remains
	// available internally, but proxy-only models must not receive the Vision
	// capability badge.
	const supportsNativeImageInput = model.capabilities.imageMode === 'native';
	return {
		id: model.id,
		apiModelId: model.apiModelId,
		name: model.displayName,
		family: model.family,
		version: model.version,
		detail: model.displayName,
		maxInputTokens: model.maxInputTokens,
		maxOutputTokens: model.maxOutputTokens,
		capabilities: {
			toolCalling: model.capabilities.toolCalling,
			parallelToolCalls: model.capabilities.parallelToolCalls,
			imageInput: supportsNativeImageInput,
			nativeImageInput: supportsNativeImageInput,
			thinking:
				reasoning.enabled &&
				(reasoning.efforts.length > 0 || reasoning.canDisable) &&
				reasoning.defaultEffort
					? {
							supportedEfforts: reasoning.efforts as ReasoningEffort[],
							defaultEffort: reasoning.defaultEffort as ReasoningEffort,
							canDisable: reasoning.canDisable,
						}
					: false,
		},
		requiresThinkingParam: reasoning.requestStyle === 'chat-thinking',
		protocol: model.selectedProtocol,
		allowProtocolFallback: model.profile.allowProtocolFallback,
		reasoningRequestStyle: reasoning.requestStyle,
		reasoningOutputStyle: reasoning.outputStyle,
		imageMode: model.capabilities.imageMode === 'auto' ? 'proxy' : model.capabilities.imageMode,
		supportedEndpointTypes: model.source.endpointTypes,
		fromStaleCache: model.source.fromStaleCache,
	};
}

/** Explicitly named alias for callers migrating from `ModelDefinition`. */
export const toLegacyModelDefinition = toModelDefinition;

export class ProfileConfigurationError extends Error {
	readonly code = 'invalid_model_profile';

	constructor(message: string) {
		super(message);
		this.name = 'ProfileConfigurationError';
	}
}

/**
 * Convert New API endpoint metadata to client protocols.  Unknown values are
 * ignored; in particular, an embedding or image-generation endpoint must not
 * accidentally make a model appear as a chat model.
 */
export function protocolsFromEndpointTypes(endpointTypes: readonly string[]): ApiProtocol[] {
	const normalized = new Set(endpointTypes.map((value) => value.trim().toLowerCase()));
	const protocols: ApiProtocol[] = [];
	if (normalized.has(CHAT_ENDPOINT_TYPE)) {
		protocols.push('chat-completions');
	}
	// `openai-response-compact` is the OpenAI response-compaction endpoint
	// (`/v1/responses/compact`), not a chat-generation endpoint. It must not be
	// advertised as a normal Responses model or the provider would POST a chat
	// request to a compaction contract.
	if (normalized.has(RESPONSES_ENDPOINT_TYPE)) {
		protocols.push('responses');
	}
	return protocols;
}

/** Return true for the compact Responses contract, which is intentionally conservative. */
export function isResponsesCompactOnly(remote: RemoteModel): boolean {
	const types = new Set(remote.supportedEndpointTypes.map((value) => value.trim().toLowerCase()));
	return types.has(RESPONSES_COMPACT_ENDPOINT_TYPE) && !types.has(RESPONSES_ENDPOINT_TYPE);
}

/**
 * Resolve profiles and endpoint capabilities.  The resolver does not perform
 * network I/O and never infers a protocol from a model name.
 */
export class ProfileResolver {
	private readonly options: Required<
		Pick<
			ProfileResolverOptions,
			| 'unknownModelPolicy'
			| 'defaultProtocol'
			| 'responsesEnabled'
			| 'excludeHeuristics'
			| 'defaultMaxInputTokens'
			| 'defaultMaxOutputTokens'
		>
	> &
		Omit<
			ProfileResolverOptions,
			| 'unknownModelPolicy'
			| 'defaultProtocol'
			| 'responsesEnabled'
			| 'excludeHeuristics'
			| 'defaultMaxInputTokens'
			| 'defaultMaxOutputTokens'
		>;
	private readonly includePatterns: readonly RegExp[];
	private readonly excludePatterns: readonly RegExp[];
	private readonly rules: readonly CompiledRule[];
	private readonly builtInRules: readonly CompiledRule[];

	constructor(options: ProfileResolverOptions = {}) {
		this.options = {
			...options,
			unknownModelPolicy: options.unknownModelPolicy ?? 'safe',
			defaultProtocol: options.defaultProtocol ?? 'chat-completions',
			responsesEnabled: options.responsesEnabled ?? false,
			excludeHeuristics: options.excludeHeuristics ?? true,
			defaultMaxInputTokens: positiveLimit(options.defaultMaxInputTokens, DEFAULT_MAX_INPUT_TOKENS),
			defaultMaxOutputTokens: positiveLimit(
				options.defaultMaxOutputTokens,
				DEFAULT_MAX_OUTPUT_TOKENS,
			),
		};
		this.includePatterns = compilePatterns(options.includePatterns, 'includePatterns');
		this.excludePatterns = compilePatterns(options.excludePatterns, 'excludePatterns');
		this.rules = compileRules(options.rules, 'modelRules');
		this.builtInRules = compileRules(options.builtInRules, 'builtInRules');
		validateProfileMap(options.exactProfiles, 'modelProfiles');
		validateProfileMap(options.builtInProfiles, 'builtInProfiles');
		validateProfile(options.unknownModelDefaults, 'unknownModelDefaults');
	}

	/** Resolve all visible models, sorted by explicit order then ID. */
	resolveAll(remoteModels: readonly RemoteModel[]): ResolvedModel[] {
		return remoteModels
			.map((remote) => this.explain(remote).model)
			.filter((model): model is ResolvedModel => model !== undefined)
			.sort((a, b) => {
				const orderA = a.profile.order ?? Number.MAX_SAFE_INTEGER;
				const orderB = b.profile.order ?? Number.MAX_SAFE_INTEGER;
				return orderA - orderB || a.id.localeCompare(b.id);
			});
	}

	/** Resolve one model and expose a reason when it is hidden. */
	explain(remote: RemoteModel): ProfileResolution {
		const exactUser = this.options.exactProfiles?.[remote.id];
		const exactBuiltIn = this.options.builtInProfiles?.[remote.id];
		const matchingBuiltIn = this.builtInRules.filter((rule) => rule.pattern.test(remote.id));
		const matchingUser = this.rules.filter((rule) => rule.pattern.test(remote.id));

		let merged: ModelProfile = {};
		const profileIds: string[] = [];
		const apply = (profile: ModelProfile | undefined, id: string): void => {
			if (!profile) return;
			merged = mergeProfiles(merged, profile);
			profileIds.push(id);
		};

		apply(this.options.unknownModelDefaults, 'unknownModelDefaults');
		for (const rule of matchingBuiltIn) {
			apply(rule.profile, rule.id ?? `builtInRule:${rule.source}`);
		}
		apply(exactBuiltIn, `builtInProfile:${remote.id}`);
		// Apply explicit/fallback token limits after built-in aliases. This keeps
		// a gateway that actually publishes a smaller/larger window authoritative
		// without making users maintain an exact Profile for every channel.
		apply(toTokenLimitModelProfile(remote), 'upstreamMetadata:tokenLimits');
		// Gateway metadata is more specific than a family heuristic, but user
		// Rules/Profiles below it remain authoritative. This lets an upstream
		// declaration such as ["low", "high", "xhigh"] replace the generic
		// built-in list without making users edit settings for every model.
		apply(toReasoningModelProfile(remote.reasoning), 'upstreamMetadata:reasoning');
		apply(toVisionModelProfile(remote.vision), 'upstreamMetadata:vision');
		for (const rule of matchingUser) {
			apply(rule.profile, rule.id ?? `modelRule:${rule.source}`);
		}
		apply(exactUser, `modelProfile:${remote.id}`);

		const hasExactProfile = exactUser !== undefined;
		const hasExplicitProtocol = profileIds.some((id) => {
			if (id === 'unknownModelDefaults')
				return this.options.unknownModelDefaults?.protocol !== undefined;
			if (id.startsWith('builtInProfile:')) return exactBuiltIn?.protocol !== undefined;
			if (id.startsWith('modelProfile:')) return exactUser?.protocol !== undefined;
			const rule = [...matchingBuiltIn, ...matchingUser].find(
				(candidate) => (candidate.id ?? `${candidate.kind}:${candidate.source}`) === id,
			);
			return rule?.profile.protocol !== undefined;
		});

		if (merged.enabled === false) {
			return {
				mergedProfile: merged,
				profileIds,
				hasExactProfile,
				hasExplicitProtocol,
				reason: 'disabled by profile',
			};
		}

		const explicitlyEnabled = hasExactProfile && exactUser?.enabled === true;
		const include = this.includePatterns;
		if (
			!explicitlyEnabled &&
			include.length > 0 &&
			!include.some((pattern) => pattern.test(remote.id))
		) {
			return {
				mergedProfile: merged,
				profileIds,
				hasExactProfile,
				hasExplicitProtocol,
				reason: 'excluded by includePatterns',
			};
		}
		if (!explicitlyEnabled && this.excludePatterns.some((pattern) => pattern.test(remote.id))) {
			return {
				mergedProfile: merged,
				profileIds,
				hasExactProfile,
				hasExplicitProtocol,
				reason: 'excluded by excludePatterns',
			};
		}

		if (this.options.excludeHeuristics && !explicitlyEnabled && isLikelyNonChatModel(remote.id)) {
			return {
				mergedProfile: merged,
				profileIds,
				hasExactProfile,
				hasExplicitProtocol,
				reason: 'excluded by non-chat model name heuristic',
			};
		}

		const endpointProtocols = protocolsFromEndpointTypes(remote.supportedEndpointTypes);
		const metadataIncomplete = remote.metadataIncomplete;
		let supported = endpointProtocols;
		if (metadataIncomplete) {
			// Missing metadata is never evidence for Responses.  Even an explicit
			// Responses profile cannot prove that the gateway exposes /responses;
			// require the endpoint advertisement before exposing that route.
			if (merged.protocol === 'responses') {
				return {
					mergedProfile: merged,
					profileIds,
					hasExactProfile,
					hasExplicitProtocol,
					reason: 'Responses requires advertised endpoint metadata',
				};
			}
			if (
				this.options.unknownModelPolicy === 'hide' &&
				!hasExplicitProtocol &&
				!explicitlyEnabled
			) {
				return {
					mergedProfile: merged,
					profileIds,
					hasExactProfile,
					hasExplicitProtocol,
					reason: 'endpoint metadata is incomplete',
				};
			}
			supported = ['chat-completions'];
		} else if (supported.length === 0 && !hasExplicitProtocol) {
			return {
				mergedProfile: merged,
				profileIds,
				hasExactProfile,
				hasExplicitProtocol,
				reason: 'no supported chat or Responses endpoint',
			};
		}

		let requested = merged.protocol ?? this.options.defaultProtocol;
		// `defaultProtocol` is a preference, not a hard capability constraint. A
		// common New API response advertises only `openai` (Chat Completions), while
		// a user may have enabled the experimental Responses route globally. Do not
		// hide every otherwise usable model in that case; fall back to an advertised
		// protocol. An explicitly configured model Profile remains strict so a
		// typo or an intentional protocol pin is visible instead of being silently
		// changed.
		if (!supported.includes(requested)) {
			if (merged.protocol !== undefined) {
				return {
					mergedProfile: merged,
					profileIds,
					hasExactProfile,
					hasExplicitProtocol,
					reason: `requested protocol ${requested} is not advertised by the gateway`,
				};
			}

			if (supported.includes('chat-completions')) {
				requested = 'chat-completions';
			} else if (this.options.responsesEnabled && supported.includes('responses')) {
				// Responses is opt-in. Only choose it automatically when the user
				// enabled the route and the gateway advertises no Chat endpoint.
				requested = 'responses';
			} else {
				return {
					mergedProfile: merged,
					profileIds,
					hasExactProfile,
					hasExplicitProtocol,
					reason: `requested protocol ${requested} is not advertised by the gateway`,
				};
			}
		}
		if (requested === 'responses' && !this.options.responsesEnabled && !hasExplicitProtocol) {
			// Responses is an opt-in route.  Treat the global default as a
			// preference, so a model that also advertises Chat Completions remains
			// usable instead of disappearing from the picker when the experiment is
			// disabled.  A Responses-only model still stays hidden until explicitly
			// enabled (or pinned in an exact Profile).
			if (supported.includes('chat-completions')) {
				requested = 'chat-completions';
			} else {
				return {
					mergedProfile: merged,
					profileIds,
					hasExactProfile,
					hasExplicitProtocol,
					reason: 'Responses is disabled without an explicit profile opt-in',
				};
			}
		}

		const compactOnly = isResponsesCompactOnly(remote);
		const capabilities = resolveCapabilities(
			merged,
			this.options.unknownModelPolicy,
			compactOnly,
			remote,
			requested,
		);
		const tokenLimits = resolveTokenLimits(
			merged,
			remote,
			this.options.defaultMaxInputTokens,
			this.options.defaultMaxOutputTokens,
		);
		const model: ResolvedModel = {
			id: remote.id,
			apiModelId: nonEmpty(merged.apiModelId) ?? remote.id,
			displayName: nonEmpty(merged.displayName) ?? remote.id,
			family: nonEmpty(merged.family) ?? inferFamily(remote),
			version: nonEmpty(merged.version) ?? inferVersion(remote.id),
			maxInputTokens: tokenLimits.maxInputTokens,
			maxOutputTokens: tokenLimits.maxOutputTokens,
			protocols: [...supported],
			selectedProtocol: requested,
			capabilities,
			profile: merged,
			source: {
				endpointTypes: [...remote.supportedEndpointTypes],
				profileIds,
				metadataIncomplete,
				fromStaleCache: false,
			},
		};
		return {
			model,
			mergedProfile: merged,
			profileIds,
			hasExactProfile,
			hasExplicitProtocol,
		};
	}
}

interface CompiledRule {
	readonly id?: string;
	readonly source: string;
	readonly kind: 'builtInRule' | 'modelRule';
	readonly pattern: RegExp;
	readonly profile: ModelProfile;
}

function compileRules(
	rules: readonly ModelRule[] | undefined,
	name: string,
): readonly CompiledRule[] {
	if (!rules) return [];
	return rules.map((rule, index) => {
		if (!rule || typeof rule.match !== 'string' || !rule.match.trim()) {
			throw new ProfileConfigurationError(`${name}[${index}].match must be a non-empty glob`);
		}
		validateProfile(rule.profile, `${name}[${index}].profile`);
		return {
			id: rule.id,
			source: rule.match,
			kind: name === 'modelRules' ? 'modelRule' : 'builtInRule',
			pattern: globToRegExp(rule.match, `${name}[${index}].match`),
			profile: rule.profile,
		};
	});
}

function validateProfileMap(
	profiles: Readonly<Record<string, ModelProfile>> | undefined,
	name: string,
): void {
	if (!profiles) return;
	for (const [id, profile] of Object.entries(profiles)) {
		validateProfile(profile, `${name}.${id}`);
	}
}

function validateProfile(profile: ModelProfile | undefined, path: string): void {
	if (!profile) return;
	if (profile.protocol !== undefined && !isProtocol(profile.protocol)) {
		throw new ProfileConfigurationError(`${path}.protocol is invalid`);
	}
	if (profile.imageMode !== undefined && !isImageMode(profile.imageMode)) {
		throw new ProfileConfigurationError(`${path}.imageMode is invalid`);
	}
	for (const key of ['maxInputTokens', 'maxOutputTokens'] as const) {
		if (profile[key] !== undefined && !isPositiveFinite(profile[key])) {
			throw new ProfileConfigurationError(`${path}.${key} must be a positive finite number`);
		}
	}
	if (profile.contextWindowTokens !== undefined && !isPositiveFinite(profile.contextWindowTokens)) {
		throw new ProfileConfigurationError(
			`${path}.contextWindowTokens must be a positive finite number`,
		);
	}
	if (profile.reasoning) {
		if (
			profile.reasoning.efforts !== undefined &&
			(!Array.isArray(profile.reasoning.efforts) ||
				profile.reasoning.efforts.some((effort) => typeof effort !== 'string' || !effort.trim()))
		) {
			throw new ProfileConfigurationError(
				`${path}.reasoning.efforts must contain non-empty strings`,
			);
		}
		if (
			profile.reasoning.outputStyle !== undefined &&
			!['summary', 'raw', 'none'].includes(profile.reasoning.outputStyle)
		) {
			throw new ProfileConfigurationError(`${path}.reasoning.outputStyle is invalid`);
		}
	}
}

/**
 * Resolve the VS Code input/output split from explicit profile values first,
 * then gateway metadata, and finally the safe defaults. VS Code renders the
 * context indicator as `maxInputTokens + maxOutputTokens`, so a reported total
 * window must be converted into that split rather than copied into one field.
 */
function resolveTokenLimits(
	profile: ModelProfile,
	remote: Pick<RemoteModel, keyof ModelTokenLimits>,
	defaultMaxInputTokens: number,
	defaultMaxOutputTokens: number,
): { maxInputTokens: number; maxOutputTokens: number } {
	const contextWindowTokens = positiveLimit(
		profile.contextWindowTokens ?? remote.contextWindowTokens,
		0,
	);
	const explicitInput = positiveLimit(profile.maxInputTokens ?? remote.maxInputTokens, 0);
	const explicitOutput = positiveLimit(profile.maxOutputTokens ?? remote.maxOutputTokens, 0);

	if (contextWindowTokens > 0) {
		// If one side is known, derive the other so the sum exactly matches the
		// advertised total. With no split, reserve the normal safe output budget.
		if (explicitInput > 0 && explicitOutput === 0 && explicitInput < contextWindowTokens) {
			return {
				maxInputTokens: explicitInput,
				maxOutputTokens: contextWindowTokens - explicitInput,
			};
		}
		if (explicitOutput > 0 && explicitInput === 0 && explicitOutput < contextWindowTokens) {
			return {
				maxInputTokens: contextWindowTokens - explicitOutput,
				maxOutputTokens: explicitOutput,
			};
		}
		if (explicitInput === 0 && explicitOutput === 0) {
			const output = Math.min(defaultMaxOutputTokens, Math.max(1, contextWindowTokens - 1));
			return {
				maxInputTokens: contextWindowTokens - output,
				maxOutputTokens: output,
			};
		}
	}

	return {
		maxInputTokens: explicitInput > 0 ? explicitInput : defaultMaxInputTokens,
		maxOutputTokens: explicitOutput > 0 ? explicitOutput : defaultMaxOutputTokens,
	};
}

function resolveCapabilities(
	profile: ModelProfile,
	unknownPolicy: UnknownModelPolicy,
	compactOnly: boolean,
	remote: RemoteModel,
	selectedProtocol: ApiProtocol,
): ResolvedModel['capabilities'] {
	const profileReasoning = profile.reasoning;
	const reasoningEnabled = profileReasoning?.enabled === true;
	const rawEfforts = uniqueStrings(
		profileReasoning?.efforts ?? (reasoningEnabled ? [...DEFAULT_REASONING_EFFORTS] : []),
	);
	const hasExplicitEfforts = profileReasoning?.efforts !== undefined;
	const noneEffort = rawEfforts.some((effort) => effort.toLowerCase() === 'none');
	const efforts = rawEfforts.filter((effort) => effort.toLowerCase() !== 'none');
	const normalizedEfforts =
		reasoningEnabled && efforts.length === 0 && !hasExplicitEfforts
			? [...DEFAULT_REASONING_EFFORTS]
			: efforts;
	const requestedDefault = nonEmpty(profileReasoning?.defaultEffort);
	const canDisable = reasoningEnabled && (profileReasoning?.canDisable ?? noneEffort);
	const matchingDefault = requestedDefault
		? normalizedEfforts.find((effort) => effort.toLowerCase() === requestedDefault.toLowerCase())
		: undefined;
	const defaultEffort =
		requestedDefault?.toLowerCase() === 'none' && canDisable
			? 'none'
			: normalizedEfforts.length > 0
				? matchingDefault
					? matchingDefault
					: normalizedEfforts[Math.min(1, normalizedEfforts.length - 1)]
				: canDisable
					? 'none'
					: undefined;
	const outputStyle = reasoningEnabled
		? profileReasoning?.outputStyle === 'raw'
			? 'raw'
			: profileReasoning?.outputStyle === 'none'
				? 'none'
				: 'summary'
		: 'none';
	const reasoning: ReasoningProfile = {
		enabled: reasoningEnabled,
		efforts: normalizedEfforts,
		defaultEffort,
		canDisable,
		requestStyle:
			profileReasoning?.requestStyle ??
			(reasoningEnabled
				? selectedProtocol === 'responses'
					? 'responses-object'
					: 'chat-reasoning-effort'
				: undefined),
		effortMap: profileReasoning?.effortMap ? { ...profileReasoning.effortMap } : undefined,
		outputStyle,
	};

	const defaultTools = unknownPolicy === 'optimistic';
	// The compact Responses contract is deliberately conservative. It may be
	// enabled for a model that is otherwise known to support Responses, but it
	// does not prove tools or native images unless the profile says so.
	const toolCalling = compactOnly
		? profile.toolCalling === true
		: (profile.toolCalling ?? defaultTools);
	const imageMode =
		compactOnly &&
		(profile.imageMode === undefined || profile.imageMode === 'auto') &&
		profile.nativeImageInput === undefined
			? 'none'
			: resolveImageMode(profile, remote);
	return {
		toolCalling,
		parallelToolCalls: toolCalling && (profile.parallelToolCalls ?? false),
		imageMode,
		// Compact Responses is text/basic-usage by default.  Explicit profile
		// fields still win, allowing a verified contract to opt capabilities in.
		reasoning:
			compactOnly && profileReasoning?.enabled !== true ? disableReasoning(reasoning) : reasoning,
	};
}

function resolveImageMode(profile: ModelProfile, remote: RemoteModel): Exclude<ImageMode, 'auto'> {
	if (profile.imageMode && profile.imageMode !== 'auto') {
		return profile.imageMode;
	}
	if (profile.nativeImageInput !== undefined) {
		return profile.nativeImageInput ? 'native' : 'proxy';
	}
	if (
		hasNativeVisionMetadata(remote.raw) ||
		(!hasExplicitTextOnlyVisionMetadata(remote.raw) && isLikelyVisionModel(remote.id))
	) {
		return 'native';
	}
	// Text-only models use the existing image-to-text proxy path by default. A
	// profile can explicitly set `imageMode: none` when proxying is undesirable.
	return 'proxy';
}

function hasNativeVisionMetadata(raw: Readonly<Record<string, unknown>> | undefined): boolean {
	if (!raw) return false;
	const candidates: unknown[] = [
		raw.modalities,
		raw.input_modalities,
		raw.supported_modalities,
		raw.capabilities,
		raw.architecture,
	];
	return candidates.some(containsImageCapability);
}

/**
 * Return true only when a gateway explicitly supplied a modality list that
 * contains no image-capable value. This prevents a broad model-name hint such
 * as `gemini-*` from overriding an authoritative `modalities: ["text"]`.
 */
function hasExplicitTextOnlyVisionMetadata(
	raw: Readonly<Record<string, unknown>> | undefined,
): boolean {
	if (!raw) return false;
	for (const key of ['modalities', 'input_modalities', 'supported_modalities'] as const) {
		const value = valueForKey(raw, key);
		if (value === undefined) continue;
		const values = Array.isArray(value) ? value : [value];
		if (
			values.length > 0 &&
			values.every((item) => typeof item === 'string') &&
			!values.some((item) => /image|vision|multimodal/iu.test(item))
		) {
			return true;
		}
	}
	for (const branch of ['capabilities', 'supports', 'metadata'] as const) {
		const value = valueForKey(raw, branch);
		if (!isRecord(value)) continue;
		for (const key of ['image', 'vision', 'multimodal', 'image_input', 'vision_input']) {
			const flag = valueForKey(value, key);
			if (flag === false) return true;
		}
	}
	return false;
}

function valueForKey(record: Readonly<Record<string, unknown>>, expected: string): unknown {
	const wanted = expected.replace(/[^a-z0-9]/giu, '').toLowerCase();
	for (const [key, value] of Object.entries(record)) {
		if (key.replace(/[^a-z0-9]/giu, '').toLowerCase() === wanted) return value;
	}
	return undefined;
}

function containsImageCapability(value: unknown): boolean {
	if (Array.isArray(value)) {
		return value.some((item) => typeof item === 'string' && /image|vision|multimodal/iu.test(item));
	}
	if (typeof value === 'string') return /image|vision|multimodal/iu.test(value);
	if (value && typeof value === 'object') {
		return Object.entries(value).some(
			([key, entry]) =>
				/image|vision|multimodal/iu.test(key) && (entry === true || containsImageCapability(entry)),
		);
	}
	return false;
}

function isLikelyVisionModel(id: string): boolean {
	// New API often forwards only an ID and endpoint type. Keep the fallback
	// family hints narrow: these families have documented image-input variants,
	// while unknown/free aliases remain proxy-only until a Profile or metadata
	// explicitly confirms native input.
	return /(?:vision|(?:^|[-_.])(?:vl|omni)(?:$|[-_.])|(?:^|[-_.])4o(?:$|[-_.])|gpt-4\.1|pixtral|llava|qwen2?\.5-vl|gemini|claude-(?:(?:3|4)(?:$|[-_.])|(?:opus|sonnet|haiku)[-_.](?:3|4)(?:$|[-_.]))|grok-(?:3|4)(?:$|[-_.]))/iu.test(
		id,
	);
}

function disableReasoning(reasoning: ReasoningProfile): ReasoningProfile {
	return {
		...reasoning,
		enabled: false,
		efforts: [],
		defaultEffort: undefined,
		canDisable: false,
		outputStyle: 'none',
	};
}

/** 将网关的推理元数据转换成可参与现有 Profile 合并的局部配置。 */
function toReasoningModelProfile(
	metadata: ModelReasoningMetadata | undefined,
): ModelProfile | undefined {
	if (!metadata) return undefined;
	const reasoning: NonNullable<ModelProfile['reasoning']> = {};
	if (metadata.enabled !== undefined) reasoning.enabled = metadata.enabled;
	// An upstream declaration without an effort list must not inherit the
	// resolver's compatibility defaults. An explicit empty list also prevents
	// a boolean-only `supports_reasoning` flag from causing an unsafe wire field
	// to be sent.
	reasoning.efforts = [...(metadata.supportedEfforts ?? [])];
	if (metadata.defaultEffort !== undefined) reasoning.defaultEffort = metadata.defaultEffort;
	if (metadata.canDisable !== undefined) reasoning.canDisable = metadata.canDisable;
	if (metadata.requestStyle !== undefined) reasoning.requestStyle = metadata.requestStyle;
	if (metadata.effortMap !== undefined) reasoning.effortMap = { ...metadata.effortMap };
	if (
		reasoning.requestStyle === undefined &&
		reasoning.efforts.length === 0 &&
		reasoning.defaultEffort === undefined &&
		reasoning.effortMap === undefined
	) {
		// The gateway confirmed a reasoning-related capability but did not
		// describe its request protocol. Keep the capability visible to the
		// resolver while disabling automatic protocol guessing; users can opt in
		// explicitly with a model Profile once the vendor wire contract is known.
		reasoning.requestStyle = 'none';
	}
	if (
		reasoning.enabled === undefined &&
		(reasoning.efforts !== undefined ||
			reasoning.defaultEffort !== undefined ||
			reasoning.requestStyle !== undefined ||
			reasoning.effortMap !== undefined ||
			reasoning.canDisable === true)
	) {
		reasoning.enabled = true;
	}
	return { reasoning };
}

function toVisionModelProfile(metadata: ModelVisionMetadata | undefined): ModelProfile | undefined {
	if (metadata?.nativeImageInput === undefined) return undefined;
	return {
		imageMode: metadata.nativeImageInput ? 'native' : 'proxy',
		nativeImageInput: metadata.nativeImageInput,
	};
}

function toTokenLimitModelProfile(
	metadata: Pick<RemoteModel, keyof ModelTokenLimits>,
): ModelProfile | undefined {
	const profile: ModelProfile = {
		contextWindowTokens: metadata.contextWindowTokens,
		maxInputTokens: metadata.maxInputTokens,
		maxOutputTokens: metadata.maxOutputTokens,
	};
	if (
		profile.contextWindowTokens === undefined &&
		profile.maxInputTokens === undefined &&
		profile.maxOutputTokens === undefined
	) {
		return undefined;
	}
	return profile;
}

function mergeProfiles(base: ModelProfile, override: ModelProfile): ModelProfile {
	const merged: ModelProfile = { ...base };
	for (const [key, value] of Object.entries(override) as Array<
		[keyof ModelProfile, ModelProfile[keyof ModelProfile]]
	>) {
		if (value === undefined) continue;
		if (key === 'reasoning') {
			merged.reasoning = {
				...base.reasoning,
				...(value as ModelProfile['reasoning']),
				...(base.reasoning?.effortMap || (value as ModelProfile['reasoning'])?.effortMap
					? {
							effortMap: {
								...base.reasoning?.effortMap,
								...(value as ModelProfile['reasoning'])?.effortMap,
							},
						}
					: {}),
			};
		} else if (key === 'extraRequestFields') {
			merged.extraRequestFields = {
				...base.extraRequestFields,
				...(value as Record<string, unknown>),
			};
		} else {
			(merged as Record<string, unknown>)[key] = value;
		}
	}
	return merged;
}

function compilePatterns(patterns: readonly string[] | undefined, name: string): readonly RegExp[] {
	if (!patterns) return [];
	return patterns
		.filter((pattern) => pattern.trim().length > 0)
		.map((pattern, index) => {
			return globToRegExp(pattern, `${name}[${index}]`);
		});
}

/** Small dependency-free glob matcher for model IDs and settings filters. */
export function globToRegExp(pattern: string, path = 'pattern'): RegExp {
	const source = pattern.trim();
	if (!source) throw new ProfileConfigurationError(`${path} must be a non-empty glob`);
	let regex = '^';
	for (let index = 0; index < source.length; index += 1) {
		const char = source[index];
		if (char === '*') {
			while (source[index + 1] === '*') index += 1;
			regex += '.*';
			continue;
		}
		if (char === '?') {
			regex += '.';
			continue;
		}
		if (char === '[') {
			const end = source.indexOf(']', index + 1);
			if (end < 0)
				throw new ProfileConfigurationError(`${path} has an unterminated character class`);
			let characterClass = source.slice(index + 1, end);
			if (!characterClass)
				throw new ProfileConfigurationError(`${path} has an empty character class`);
			if (characterClass[0] === '!') characterClass = `^${characterClass.slice(1)}`;
			regex += `[${characterClass.replace(/\\/gu, '\\\\')}]`;
			index = end;
			continue;
		}
		regex += escapeRegexChar(char);
	}
	try {
		return new RegExp(`${regex}$`, 'iu');
	} catch (error) {
		throw new ProfileConfigurationError(
			`${path} is invalid: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
}

function escapeRegexChar(char: string): string {
	return /[\\^$+.()|{}]/u.test(char) ? `\\${char}` : char;
}

function isLikelyNonChatModel(id: string): boolean {
	// Keep generation/realtime models out of the chat picker even when a
	// gateway advertises them through the generic `openai` endpoint. The
	// versioned Wan IDs (`wan2.7-image`) are deliberately matched as one token;
	// the older two-separator expression let those image models slip through.
	return /(?:embedding|\bembed\b|rerank|tts|asr|whisper|moderation|realtime|live[-_ ]?translate|image[-_ ]?generation|video[-_ ]?generation|text[-_ ]?to[-_]?(?:image|video)|(?:^|[-_/:])(?:gpt-image|chatgpt-image|gemini-[^/]*-image|imagen|veo|qwen-image|wan(?:\d+(?:[.-]\d+)*)?-image|grok-imagine|happyhorse|lyria|dall-e|sora|(?:doubao-)?seed(?:ream|ance)|kling|jimeng|vidu|jina-clip)(?:[-_.:/]|$))/iu.test(
		id,
	);
}

function inferFamily(remote: RemoteModel): string {
	if (remote.ownedBy && remote.ownedBy.trim()) return remote.ownedBy.trim();
	const [family] = remote.id.split(/[/:_-]/u);
	return family || 'unknown';
}

function inferVersion(id: string): string {
	const match = id.match(/(?:^|[-_])v?(\d+(?:\.\d+)*)/iu);
	return match?.[1] ?? 'unknown';
}

function positiveLimit(value: number | undefined, fallback: number): number {
	return isPositiveFinite(value) ? value : fallback;
}

function isPositiveFinite(value: unknown): value is number {
	return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function nonEmpty(value: unknown): string | undefined {
	return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function uniqueStrings(values: readonly string[]): string[] {
	return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function isProtocol(value: unknown): value is ApiProtocol {
	return value === 'chat-completions' || value === 'responses';
}

function isImageMode(value: unknown): value is ImageMode {
	return value === 'none' || value === 'proxy' || value === 'native' || value === 'auto';
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}
