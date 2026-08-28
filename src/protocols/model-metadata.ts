/**
 * Token-limit metadata is not part of the current New API `/v1/models` DTO,
 * but a number of compatible gateways forward it from their upstream model
 * registry.  Keep the parser deliberately provider-neutral and tolerant of
 * the naming conventions used by OpenAI-compatible gateways.
 */

export interface ModelTokenLimits {
	/** Total context window, when the gateway reports it explicitly. */
	readonly contextWindowTokens?: number;
	/** Maximum prompt/input tokens accepted by the model. */
	readonly maxInputTokens?: number;
	/** Maximum output/completion tokens produced by the model. */
	readonly maxOutputTokens?: number;
}

/**
 * 推理能力的上游声明。不同网关的字段命名并不统一，解析器会把它们
 * 归一化成同一组字段，再由 ProfileResolver 按优先级合并。
 */
export interface ModelReasoningMetadata {
	/** 上游接受的原始 effort 枚举；`none` 会在能力层转换成 canDisable。 */
	readonly supportedEfforts?: readonly string[];
	readonly defaultEffort?: string;
	readonly enabled?: boolean;
	readonly canDisable?: boolean;
	readonly requestStyle?: 'chat-reasoning-effort' | 'chat-thinking' | 'responses-object' | 'none';
	/** Optional canonical-to-wire value mapping supplied by the gateway. */
	readonly effortMap?: Readonly<Record<string, string>>;
}

/** Explicit image-input declaration from an upstream model registry. */
export interface ModelVisionMetadata {
	/** True means the model accepts image parts directly; false is text-only. */
	readonly nativeImageInput?: boolean;
}

/**
 * Merge duplicate channel declarations conservatively. A text-only
 * declaration wins a conflict because falsely forwarding image bytes is more
 * harmful than falling back to the configured vision proxy.
 */
export function mergeModelVisionMetadata(
	base: ModelVisionMetadata | undefined,
	next: ModelVisionMetadata | undefined,
): ModelVisionMetadata | undefined {
	if (!base) return next;
	if (!next) return base;
	if (base.nativeImageInput === false || next.nativeImageInput === false) {
		return { nativeImageInput: false };
	}
	if (base.nativeImageInput === true || next.nativeImageInput === true) {
		return { nativeImageInput: true };
	}
	return {};
}

/**
 * Parse explicit image capability fields from a gateway model item. Name
 * heuristics are intentionally not used here; they remain the last-resort
 * compatibility fallback in `ProfileResolver`.
 */
export function parseModelVisionMetadata(input: unknown): ModelVisionMetadata | undefined {
	const records = collectMetadataRecords(input);
	let sawNative = false;
	let sawTextOnly = false;
	for (const record of records) {
		for (const key of VISION_TAG_KEYS) {
			const value = valueForNormalizedKey(record, key);
			const values = Array.isArray(value) ? value : value === undefined ? [] : [value];
			if (
				values.some((item) => typeof item === 'string' && /\b(?:vision|multimodal)\b/iu.test(item))
			) {
				sawNative = true;
			}
			if (
				values.some(
					(item) =>
						typeof item === 'string' &&
						/\b(?:text[-_ ]?only|text[-_ ]?model|language[-_ ]?only)\b/iu.test(item),
				)
			) {
				sawTextOnly = true;
			}
		}
		for (const key of VISION_MODALITY_KEYS) {
			const value = valueForNormalizedKey(record, key);
			if (value === undefined) continue;
			const values = Array.isArray(value) ? value : [value];
			if (
				values.some((item) => typeof item === 'string' && /image|vision|multimodal/iu.test(item))
			) {
				sawNative = true;
				continue;
			}
			if (
				values.length > 0 &&
				values.every((item) => typeof item === 'string') &&
				values.some((item) => /text|language/iu.test(item))
			) {
				sawTextOnly = true;
			}
		}

		for (const key of VISION_FLAG_KEYS) {
			const value = valueForNormalizedKey(record, key);
			if (typeof value === 'boolean') {
				if (value === false) sawTextOnly = true;
				if (value === true) sawNative = true;
			}
		}
		for (const key of ['capabilities', 'supports', 'features'] as const) {
			const nested = valueForNormalizedKey(record, key);
			if (!isRecord(nested)) continue;
			for (const flag of VISION_FLAG_KEYS) {
				const value = valueForNormalizedKey(nested, flag);
				if (typeof value !== 'boolean') continue;
				if (value === false) sawTextOnly = true;
				if (value === true) sawNative = true;
			}
		}
	}
	if (!sawNative && !sawTextOnly) return undefined;
	return { nativeImageInput: sawTextOnly ? false : true };
}

const VISION_MODALITY_KEYS = [
	'modalities',
	'input_modalities',
	'supported_modalities',
	'input_types',
	'supported_input_types',
] as const;

const VISION_TAG_KEYS = ['tags', 'capability_tags', 'model_tags'] as const;

const VISION_FLAG_KEYS = [
	'image',
	'vision',
	'multimodal',
	'image_input',
	'vision_input',
	'supports_image',
	'supports_vision',
	'supports_multimodal',
	'supports_image_input',
	'supports_vision_input',
] as const;

/** 合并同一模型从多个 New API 渠道返回的能力，避免后一个渠道抹掉前一个声明。 */
export function mergeModelReasoningMetadata(
	base: ModelReasoningMetadata | undefined,
	next: ModelReasoningMetadata | undefined,
): ModelReasoningMetadata | undefined {
	if (!base) return next;
	if (!next) return base;
	let supportedEfforts =
		next.supportedEfforts && next.supportedEfforts.length > 0
			? mergeEffortValues(base.supportedEfforts, next.supportedEfforts)
			: isExplicitDisableOnly(next) || isExplicitEmptyDeclaration(next)
				? []
				: (base.supportedEfforts ?? next.supportedEfforts);
	if (
		next.defaultEffort &&
		next.defaultEffort.toLowerCase() !== 'none' &&
		supportedEfforts !== undefined &&
		!supportedEfforts.some((effort) => effort.toLowerCase() === next.defaultEffort?.toLowerCase())
	) {
		supportedEfforts = mergeEffortValues(supportedEfforts, [next.defaultEffort]);
	}
	return {
		supportedEfforts,
		defaultEffort: next.defaultEffort ?? base.defaultEffort,
		enabled: next.enabled ?? base.enabled,
		canDisable: next.canDisable ?? base.canDisable,
		// A model ID can be exposed through both Chat and Responses channels. If
		// their explicit wire styles disagree, discard the channel-specific hint
		// and let ProfileResolver infer the style from the selected endpoint rather
		// than accidentally sending a Responses field to Chat (or vice versa).
		requestStyle: mergeRequestStyle(base.requestStyle, next.requestStyle),
		...(base.effortMap || next.effortMap
			? { effortMap: { ...base.effortMap, ...next.effortMap } }
			: {}),
	};
}

function mergeRequestStyle(
	base: ModelReasoningMetadata['requestStyle'],
	next: ModelReasoningMetadata['requestStyle'],
): ModelReasoningMetadata['requestStyle'] {
	if (base === undefined) return next;
	if (next === undefined) return base;
	return base === next ? base : undefined;
}

function isExplicitDisableOnly(metadata: ModelReasoningMetadata): boolean {
	return (
		metadata.supportedEfforts !== undefined &&
		metadata.supportedEfforts.length === 0 &&
		(metadata.canDisable === true || metadata.defaultEffort?.toLowerCase() === 'none')
	);
}

function isExplicitEmptyDeclaration(metadata: ModelReasoningMetadata): boolean {
	return metadata.supportedEfforts?.length === 0 && metadata.enabled !== undefined;
}

/**
 * 从 OpenAI-compatible `/models` 条目中提取推理能力。
 *
 * New API 的不同渠道可能把字段放在 `supports`、`capabilities`、`reasoning`
 * 或 `metadata` 下，因此这里只访问有限的元数据分支，不遍历任意业务对象，
 * 避免把价格、描述中的字符串误识别成推理级别。
 */
export function parseModelReasoningMetadata(input: unknown): ModelReasoningMetadata | undefined {
	const records = collectMetadataRecords(input);
	let declared = false;
	let efforts: string[] | undefined;
	let defaultEffort: string | undefined;
	let enabled: boolean | undefined;
	let canDisable: boolean | undefined;
	let requestStyle: ModelReasoningMetadata['requestStyle'];
	let effortMap: Record<string, string> | undefined;

	for (const record of records) {
		for (const key of REASONING_TAG_KEYS) {
			const value = valueForNormalizedKey(record, key);
			const values = Array.isArray(value) ? value : value === undefined ? [] : [value];
			if (
				values.some((item) => typeof item === 'string' && /\b(?:reasoning|thinking)\b/iu.test(item))
			) {
				declared = true;
				enabled ??= true;
			}
		}
		for (const key of REASONING_EFFORT_KEYS) {
			const value = valueForNormalizedKey(record, key);
			if (value === undefined) continue;
			declared = true;
			const parsed = parseEffortValues(value);
			if (parsed) {
				efforts = mergeEffortValues(efforts, parsed);
			}
		}

		for (const key of REASONING_DEFAULT_KEYS) {
			const value = valueForNormalizedKey(record, key);
			const parsed = parseEffortValue(value);
			if (parsed) {
				declared = true;
				defaultEffort ??= parsed;
			}
		}

		for (const key of REASONING_ENABLED_KEYS) {
			const value = valueForNormalizedKey(record, key);
			if (typeof value === 'boolean') {
				declared = true;
				enabled ??= value;
			}
		}

		for (const key of REASONING_DISABLE_KEYS) {
			const value = valueForNormalizedKey(record, key);
			if (typeof value === 'boolean') {
				declared = true;
				canDisable ??= value;
			}
		}

		for (const key of REASONING_STYLE_KEYS) {
			const value = valueForNormalizedKey(record, key);
			const parsed = parseReasoningRequestStyle(value);
			if (parsed) {
				declared = true;
				requestStyle ??= parsed;
			}
		}

		for (const key of REASONING_MAP_KEYS) {
			const parsed = parseEffortMap(valueForNormalizedKey(record, key));
			if (parsed) {
				declared = true;
				effortMap = mergeEffortMaps(effortMap, parsed);
			}
		}

		// `reasoning: { enabled, effort, ... }` is common in Responses metadata.
		for (const key of ['reasoning', 'thinking'] as const) {
			const nested = valueForNormalizedKey(record, key);
			// Some registries use a compact boolean form such as
			// `capabilities: { reasoning: false }`. Treat it as an explicit
			// capability declaration instead of silently retaining a built-in
			// reasoning profile for the same model.
			if (typeof nested === 'boolean') {
				declared = true;
				enabled ??= nested;
				continue;
			}
			if (!isRecord(nested)) continue;
			const nestedEfforts = firstParsedEffortValues(nested, [
				'effort',
				'efforts',
				'reasoning_efforts',
				'supported_efforts',
				'supported',
				'levels',
				'values',
				'options',
				'enum',
			]);
			if (nestedEfforts) {
				declared = true;
				efforts = mergeEffortValues(efforts, nestedEfforts);
			}
			const nestedDefault =
				parseEffortValue(nested.effort) ??
				parseEffortValue(nested.level) ??
				parseEffortValue(nested.default);
			if (nestedDefault) {
				declared = true;
				defaultEffort ??= nestedDefault;
			}
			if (typeof nested.enabled === 'boolean') {
				declared = true;
				enabled ??= nested.enabled;
			}
			if (typeof nested.can_disable === 'boolean') {
				declared = true;
				canDisable ??= nested.can_disable;
			}
			for (const key of ['can_disable', 'supports_none', 'supports_disable', 'disable'] as const) {
				const value = valueForNormalizedKey(nested, key);
				if (typeof value === 'boolean') {
					declared = true;
					canDisable ??= value;
				}
			}
			const nestedStyle =
				parseReasoningRequestStyle(nested.request_style) ??
				parseReasoningRequestStyle(nested.request_field) ??
				parseReasoningRequestStyle(nested.parameter) ??
				parseReasoningRequestStyle(nested.type) ??
				parseReasoningRequestStyle(nested.protocol);
			if (nestedStyle) {
				declared = true;
				requestStyle ??= nestedStyle;
			}
			const nestedMap = firstParsedEffortMap(nested, REASONING_MAP_KEYS);
			if (nestedMap) {
				declared = true;
				effortMap = mergeEffortMaps(effortMap, nestedMap);
			}
		}
	}

	if (!declared) return undefined;
	if (defaultEffort && effortMap) {
		// Registries sometimes publish the default in wire form while the
		// supported list/effort map uses canonical names. Resolve that mismatch
		// before the profile resolver chooses the picker default.
		const canonical = Object.entries(effortMap).find(
			([, wire]) => wire.toLowerCase() === defaultEffort?.toLowerCase(),
		)?.[0];
		if (canonical) defaultEffort = canonical;
	}
	// A gateway may publish only the default value (for example
	// `default_reasoning_effort: "xhigh"`). Preserve that value as a supported
	// level instead of allowing ProfileResolver to fall back to medium. A
	// default of `none` is an explicit disable declaration.
	if (defaultEffort) {
		if (defaultEffort.toLowerCase() === 'none') {
			canDisable = canDisable ?? true;
		} else {
			efforts = mergeEffortValues(efforts, [defaultEffort]);
		}
	}
	// Once a reasoning field is explicitly present, an omitted effort list is
	// meaningful: the upstream has not told us which wire values are safe. Keep
	// an empty list so the resolver does not invent low/medium/high levels.
	if (efforts === undefined) efforts = [];
	if (efforts?.some((effort) => effort.toLowerCase() === 'none')) {
		// `none` is a switch, not a reasoning level in VS Code's schema.
		canDisable = canDisable ?? true;
		efforts = efforts.filter((effort) => effort.toLowerCase() !== 'none');
	}
	if (enabled === undefined) {
		enabled =
			efforts.length > 0 ||
			canDisable === true ||
			(requestStyle !== undefined && requestStyle !== 'none');
	}
	return {
		supportedEfforts: efforts,
		defaultEffort,
		enabled,
		canDisable,
		requestStyle,
		...(effortMap ? { effortMap } : {}),
	};
}

function firstParsedEffortValues(
	record: Record<string, unknown>,
	keys: readonly string[],
): string[] | undefined {
	for (const key of keys) {
		const parsed = parseEffortValues(valueForNormalizedKey(record, key));
		if (parsed !== undefined) return parsed;
	}
	return undefined;
}

const REASONING_EFFORT_KEYS = [
	'reasoning_effort',
	'reasoning_efforts',
	'supported_reasoning_efforts',
	'supported_efforts',
	'efforts',
	'reasoning_levels',
	'levels',
	'thinking_levels',
	'supported_thinking_levels',
	'reasoning_level',
] as const;

const REASONING_DEFAULT_KEYS = [
	'default_reasoning_effort',
	'reasoning_effort_default',
	'default_effort',
	'default_thinking_level',
	'reasoning_default',
] as const;

const REASONING_ENABLED_KEYS = [
	'reasoning_enabled',
	'supports_reasoning',
	'reasoning_supported',
	'supports_thinking',
] as const;

const REASONING_DISABLE_KEYS = [
	'reasoning_can_disable',
	'can_disable_reasoning',
	'supports_reasoning_disable',
	'supports_thinking_disable',
] as const;

const REASONING_STYLE_KEYS = [
	'reasoning_request_style',
	'reasoning_protocol',
	'request_style',
	'reasoning_field',
	'reasoning_parameter',
] as const;

const REASONING_MAP_KEYS = [
	'effort_map',
	'effort_mapping',
	'reasoning_effort_map',
	'reasoning_effort_mapping',
	'thinking_effort_map',
] as const;

const REASONING_TAG_KEYS = ['tags', 'capability_tags', 'model_tags'] as const;

function valueForNormalizedKey(record: Record<string, unknown>, expected: string): unknown {
	const wanted = normalizeKey(expected);
	for (const [key, value] of Object.entries(record)) {
		if (normalizeKey(key) === wanted) return value;
	}
	return undefined;
}

function parseEffortValues(value: unknown): string[] | undefined {
	if (Array.isArray(value)) {
		const values = value.flatMap((item) => parseEffortValues(item) ?? []);
		return values.length > 0 || value.length === 0 ? values : undefined;
	}
	if (isRecord(value)) {
		for (const key of ['enum', 'values', 'levels', 'supported', 'options']) {
			const nested = valueForNormalizedKey(value, key);
			const parsed = parseEffortValues(nested);
			if (parsed) return parsed;
		}
		return undefined;
	}
	if (typeof value !== 'string') return undefined;
	const tokens = value
		.split(/[,|\s]+/u)
		.map((item) => item.trim())
		.filter(Boolean);
	return tokens.length > 0 && tokens.every(isEffortToken)
		? tokens.map(normalizeEffortToken)
		: undefined;
}

function parseEffortValue(value: unknown): string | undefined {
	if (typeof value !== 'string') return undefined;
	const token = value.trim();
	return isEffortToken(token) ? normalizeEffortToken(token) : undefined;
}

function parseEffortMap(value: unknown): Record<string, string> | undefined {
	if (!isRecord(value)) return undefined;
	const result: Record<string, string> = {};
	for (const [key, mapped] of Object.entries(value)) {
		if (Object.keys(result).length >= 32) break;
		if (typeof mapped !== 'string') continue;
		const canonical = normalizeEffortToken(key);
		const wire = mapped.trim();
		if (!canonical || canonical.length > 64 || !wire || wire.length > 128) continue;
		result[canonical] = wire;
	}
	return Object.keys(result).length > 0 ? result : undefined;
}

function firstParsedEffortMap(
	record: Record<string, unknown>,
	keys: readonly string[],
): Record<string, string> | undefined {
	for (const key of keys) {
		const parsed = parseEffortMap(valueForNormalizedKey(record, key));
		if (parsed) return parsed;
	}
	return undefined;
}

function mergeEffortMaps(
	base: Record<string, string> | undefined,
	next: Record<string, string>,
): Record<string, string> {
	return { ...base, ...next };
}

function mergeEffortValues(base: readonly string[] | undefined, next: readonly string[]): string[] {
	const result = [...(base ?? [])];
	for (const effort of next) {
		if (!result.some((item) => item.toLowerCase() === effort.toLowerCase())) result.push(effort);
	}
	return result;
}

function isEffortToken(value: string): boolean {
	return /^[a-z][a-z0-9_.:-]{0,63}$/iu.test(value);
}

function normalizeEffortToken(value: string): string {
	const normalized = value.trim().toLowerCase();
	if (normalized === 'disabled' || normalized === 'off') return 'none';
	return normalized;
}

function parseReasoningRequestStyle(value: unknown): ModelReasoningMetadata['requestStyle'] {
	if (typeof value !== 'string') return undefined;
	const normalized = normalizeKey(value);
	if (normalized === 'none' || normalized === 'disabled' || normalized === 'off') return 'none';
	if (
		['response', 'responses', 'responseobject', 'responsesobject', 'openairesponse'].includes(
			normalized,
		)
	) {
		return 'responses-object';
	}
	if (['thinking', 'chatthinking', 'thinkingtoggle', 'deepseekthinking'].includes(normalized)) {
		return 'chat-thinking';
	}
	if (
		[
			'chat',
			'chatcompletions',
			'openaichat',
			'reasoningeffort',
			'chatreasoningeffort',
			'openaireasoningeffort',
		].includes(normalized)
	) {
		return 'chat-reasoning-effort';
	}
	return undefined;
}

/**
 * Best-effort context hints for common New API registry IDs. These are used
 * only after the gateway has omitted an explicit limit/tag, so a deployment
 * that aliases a model to a smaller window remains authoritative.
 */
export function inferKnownContextWindowTokens(modelId: string): number | undefined {
	const id = modelId.trim();
	if (!id) return undefined;
	// The most specific aliases come first.  Prefixes such as `openai/` and
	// suffixes such as `-thinking` are intentionally accepted because New API
	// commonly preserves the upstream path/model spelling.
	if (/(?:^|[/_:])gpt-5\.6(?:[-_.:/]|$)/iu.test(id)) return 1_050_000;
	if (/(?:^|[/_:])gpt-5\.5(?:[-_.:/]|$)/iu.test(id)) return 1_050_000;
	if (/(?:^|[/_:])gpt-5\.4(?:[-_.:/]|$)/iu.test(id)) {
		if (/(?:[-_.:/])(?:mini|nano)(?:[-_.:/]|$)/iu.test(id)) return 400_000;
		return 1_050_000;
	}
	if (/(?:^|[/_:])gpt-5\.3-codex-spark(?:[-_.:/]|$)/iu.test(id)) return 128_000;
	if (/(?:^|[/_:])gpt-5\.[23]-chat(?:[-_.:/]|$)/iu.test(id)) return 128_000;
	if (/(?:^|[/_:])gpt-4\.1(?:[-_.:/]|$)/iu.test(id)) return 1_047_576;
	if (/(?:^|[/_:])gpt-5(?:[-_.:/]|$)/iu.test(id)) return 400_000;
	if (/(?:^|[/_:])gpt-4o(?:[-_.:/]|$)/iu.test(id)) return 128_000;
	if (/(?:^|[/_:])gpt-3\.5-turbo(?:[-_.:/]|$)/iu.test(id)) return 16_384;
	if (/(?:^|[/_:])gpt-4-(?:vision|1106-vision)(?:[-_.:/]|$)/iu.test(id)) return 128_000;
	if (/(?:^|[/_:])gpt-4(?:[-_.:/]|$)/iu.test(id)) return 8_192;
	if (/(?:^|[/_:])o[134](?:[-_.:/]|$)/iu.test(id)) return 200_000;
	if (/(?:^|[/_:])claude-(?:opus|sonnet)-4-(?:6|7|8)(?:[-_.:/]|$)/iu.test(id)) {
		return 1_000_000;
	}
	if (/(?:^|[/_:])claude-(?:opus|sonnet)-5(?:[-_.:/]|$)/iu.test(id)) return 1_000_000;
	if (/(?:^|[/_:])claude-fable-5(?:[-_.:/]|$)/iu.test(id)) return 1_000_000;
	if (/(?:^|[/_:])claude-(?:3|4|5)(?:[-_.:/]|$)/iu.test(id)) return 200_000;
	if (/(?:^|[/_:])claude-[^/]*-(?:4|5)[-_.]/iu.test(id)) return 200_000;
	if (/(?:^|[/_:])gemini-(?:2|3)(?:[-_.:/]|\.|$)/iu.test(id)) return 1_048_576;
	if (/(?:^|[/_:])grok-4(?:[-_.:/]|$)/iu.test(id)) return 500_000;
	if (/(?:^|[/_:])grok-3(?:[-_.:/]|$)/iu.test(id)) return 131_072;
	if (/(?:^|[/_:])grok-build-/iu.test(id)) return 262_144;
	if (/(?:^|[/_:])deepseek-v4(?:[-_.:/]|$)/iu.test(id)) return 1_048_576;
	if (/(?:^|[/_:])deepseek-r1-0528(?:[-_.:/]|$)/iu.test(id)) return 163_840;
	if (/(?:^|[/_:])deepseek-v3-(?:0324|terminus)(?:[-_.:/]|$)/iu.test(id)) return 163_840;
	if (/(?:^|[/_:])deepseek-(?:v3|r1|reasoner)(?:[-_.:/]|$)/iu.test(id)) return 128_000;
	if (/(?:^|[/_:])qwen-long(?:[-_.:/]|$)/iu.test(id)) return 10_000_000;
	if (/(?:^|[/_:])qwen-plus-character-ja(?:[-_.:/]|$)/iu.test(id)) return 8_192;
	if (/(?:^|[/_:])qwen-plus-character(?:[-_.:/]|$)/iu.test(id)) return 32_768;
	if (/(?:^|[/_:])qwen-max(?:[-_.:/]|$)/iu.test(id)) return 32_768;
	if (/(?:^|[/_:])qwen-deep-research(?:[-_.:/]|$)/iu.test(id)) return 1_000_000;
	if (/(?:^|[/_:])qwen-(?:plus|turbo|flash)(?:[-_.:/]|$)/iu.test(id)) return 1_000_000;
	if (
		/(?:^|[/_:])qwen3-(?:coder-(?:flash|plus)|3\.[78]-(?:flash|plus)|next-.*(?:plus|flash))(?:[-_.:/]|$)/iu.test(
			id,
		)
	)
		return 1_000_000;
	if (/(?:^|[/_:])qwen3\.(?:5|6)-(?:flash|plus)(?:[-_.:/]|$)/iu.test(id)) return 1_000_000;
	if (/(?:^|[/_:])qwen3\.[78]-(?:flash|plus|max)(?:[-_.:/]|$)/iu.test(id)) return 1_000_000;
	if (/(?:^|[/_:])qwen3\.(?:5|6)-/iu.test(id)) return 262_144;
	if (/(?:^|[/_:])qwen3-(?:vl-plus|max|coder)(?:[-_.:/]|$)/iu.test(id)) return 262_144;
	if (/(?:^|[/_:])qwen3-vl-/iu.test(id)) return 131_072;
	if (/(?:^|[/_:])qwen2-5-vl(?:[-_.:/]|$)/iu.test(id)) return 131_072;
	if (/(?:^|[/_:])qwen-vl-(?:max|plus)(?:[-_.:/]|$)/iu.test(id)) return 131_072;
	if (/(?:^|[/_:])qwen3-omni-/iu.test(id)) return 65_536;
	if (/(?:^|[/_:])qwen3-(?:next|[0-9])(?:[-_.:/]|$)/iu.test(id)) return 131_072;
	if (/(?:^|[/_:])qwen(?:-math-|_math_)/iu.test(id)) return 8_192;
	if (/(?:^|[/_:])qwen(?:2-5-)?math-(?:plus|turbo|[0-9])/iu.test(id)) return 8_192;
	if (/(?:^|[/_:])qwen2-5-omni-/iu.test(id)) return 32_768;
	if (/(?:^|[/_:])(?:qwen-omni-|qwen3-omni-)/iu.test(id)) {
		return /qwen3-omni-/iu.test(id) ? 65_536 : 32_768;
	}
	if (/(?:^|[/_:])(?:qwen(?:[0-9]|[-_.:/])|qwq(?:[-_.:/]|$))/iu.test(id)) return 128_000;
	if (
		/(?:^|[/_:])(?:labs-)?devstral-|(?:^|[/_:])(?:mistral|mixtral|codestral|devstral)-/iu.test(id)
	) {
		if (/(?:mixtral-8x7b|open-mistral-7b)/iu.test(id)) return 32_768;
		if (/(?:mistral-large-2411|mistral-medium-2505|mistral-small-2506)/iu.test(id)) {
			return 131_072;
		}
		if (/(?:mixtral-8x22b|codestral-latest|mistral-(?:large|medium|small)-|devstral-)/iu.test(id)) {
			return 262_144;
		}
	}
	if (/(?:^|[/_:])k3-256k(?:[-_.:/]|$)/iu.test(id)) return 262_144;
	if (/(?:^|[/_:])k3(?:[-_.:/]|$)/iu.test(id)) return 1_000_000;
	if (/(?:^|[/_:])kimi-(?:k2|for-coding)(?:[-_.:/]|$)/iu.test(id)) return 262_144;
	if (/(?:^|[/_:])kimi-k3(?:[-_.:/]|$)/iu.test(id)) return 1_000_000;
	if (/(?:^|[/_:])mimo-v2\.5(?:[-_.:/]|$)/iu.test(id)) return 1_000_000;
	if (/(?:^|[/_:])mimo-v2-pro(?:[-_.:/]|$)/iu.test(id)) return 1_000_000;
	if (/(?:^|[/_:])mimo-v2-(?:flash|omni)(?:[-_.:/]|$)/iu.test(id)) return 262_144;
	if (/(?:^|[/_:])(?:nova-2|fugu)(?:[-_.:/]|$)/iu.test(id)) return 1_000_000;
	if (/(?:^|[/_:])(?:longcat|muse-spark)(?:[-_.:/]|$)/iu.test(id)) return 1_000_000;
	if (/(?:^|[/_:])hy3(?:[-_.:/]|$)/iu.test(id)) return 262_144;
	if (/(?:^|[/_:])laguna-s-/iu.test(id)) return 1_000_000;
	if (/(?:^|[/_:])laguna-(?:m|xs)(?:[-_.:/]|$)/iu.test(id)) return 262_144;
	if (/(?:^|[/_:])north-mini-(?:[-_.:/]|$)/iu.test(id)) return 262_144;
	if (/(?:^|[/_:])(?:sakana|thinkingmachines)(?:[-_.:/]|$)/iu.test(id)) return 262_144;
	if (/(?:^|[/_:])sarvam-30b(?:[-_.:/]|$)/iu.test(id)) return 65_536;
	if (/(?:^|[/_:])sonar-pro(?:[-_.:/]|$)/iu.test(id)) return 200_000;
	if (/(?:^|[/_:])(?:sonar-reasoning-pro|sonar)(?:[-_.:/]|$)/iu.test(id)) return 128_000;
	if (/(?:^|[/_:])step-1-32k(?:[-_.:/]|$)/iu.test(id)) return 32_768;
	if (/(?:^|[/_:])step-2-16k(?:[-_.:/]|$)/iu.test(id)) return 16_384;
	if (/(?:^|[/_:])solar-mini(?:[-_.:/]|$)/iu.test(id)) return 32_768;
	if (/(?:^|[/_:])solar-pro2(?:[-_.:/]|$)/iu.test(id)) return 65_536;
	if (/(?:^|[/_:])solar-pro4(?:[-_.:/]|$)/iu.test(id)) return 524_288;
	if (/(?:^|[/_:])v0-1\.5-lg(?:[-_.:/]|$)/iu.test(id)) return 524_288;
	if (/(?:^|[/_:])(?:yi-medium-200k|yi-34b-chat-200k)(?:[-_.:/]|$)/iu.test(id)) {
		return 200_000;
	}
	if (/(?:^|[/_:])yi-(?:vision|vl)(?:[-_.:/]|$)/iu.test(id)) return 32_768;
	if (/(?:^|[/_:])yi-(?:[-_.:/]|$)/iu.test(id)) return 32_768;
	if (/(?:^|[/_:])ernie-[^/]*-200k(?:[-_.:/]|$)/iu.test(id)) return 200_000;
	if (/(?:^|[/_:])ernie-[^/]*-128k(?:[-_.:/]|$)/iu.test(id)) return 131_072;
	if (/(?:^|[/_:])ernie-(?:[-_.:/]|$)/iu.test(id)) return 8_192;
	if (/(?:^|[/_:])doubao-[^/]*-128k(?:[-_.:/]|$)/iu.test(id)) return 131_072;
	if (/(?:^|[/_:])doubao-[^/]*-32k(?:[-_.:/]|$)/iu.test(id)) return 32_768;
	if (/(?:^|[/_:])doubao-(?:[-_.:/]|$)/iu.test(id)) return 128_000;
	if (/(?:^|[/_:])abab\d*(?:[-_.:/]|$)/iu.test(id)) return 32_768;
	if (/(?:^|[/_:])chatglm(?:[-_.:/]|$)/iu.test(id)) return 128_000;
	if (/(?:^|[/_:])gemma-4-(?:[0-9]|[a-z])/iu.test(id)) return 262_144;
	if (
		/(?:^|[/_:])(?:mistral|mixtral|codestral|llama|glm|kimi|moonshot|minimax)(?:[-_.:/]|$)/iu.test(
			id,
		)
	) {
		if (/(?:^|[/_:])glm-4\.5(?:[-_.:/]|$)/iu.test(id)) return 131_072;
		if (/(?:^|[/_:])minimax-m2(?:\.1|\.5|\.7)(?:[-_.:/]|$)/iu.test(id)) {
			return 204_800;
		}
		return 128_000;
	}
	if (/(?:^|[/_:])(?:hunyuan|step|solar|sonar|gemma|mimo|nova|longcat)-/iu.test(id)) {
		return 131_072;
	}
	return undefined;
}

const TOTAL_KEYS = new Set([
	'contextlength',
	'contextlengthtokens',
	'contextwindow',
	'contextwindowtokens',
	'maxcontextwindowtokens',
	'maxcontextwindow',
	'maxcontexttokens',
	'maxcontextlengthtokens',
	'maxcontextlength',
	'contextmaxtokens',
	'contextmax',
]);

const INPUT_KEYS = new Set([
	'maxinputtokens',
	'maxprompttokens',
	'inputtokenlimit',
	'maxinputtokenlimit',
]);

const OUTPUT_KEYS = new Set([
	'maxoutputtokens',
	'maxcompletiontokens',
	'outputtokenlimit',
	'maxoutputtokenlimit',
]);

const NESTED_METADATA_KEYS = new Set([
	'capabilities',
	'supports',
	'support',
	'reasoning',
	'thinking',
	'features',
	'limits',
	'modelinfo',
	'metadata',
	'meta',
	'tokenlimits',
	'tokenlimit',
	'usage',
	'pricing',
]);

// New API's model metadata registry commonly stores the context window as a
// human-readable tag (for example `Reasoning,Tools,1M`).  The relay DTO does
// not currently forward this field, but accepting it here makes the parser
// forward-compatible with gateways that do. Only explicit K/M token tags are
// considered; arbitrary numbers in descriptions/pricing are ignored.
const CONTEXT_TAG_KEYS = new Set(['tag', 'tags', 'modeltags', 'capabilitytags']);

/**
 * Extract token limits from a model item without trusting arbitrary numeric
 * fields.  We only inspect known metadata branches and impose a sane upper
 * bound so pricing/IDs cannot accidentally become token limits.
 */
export function parseModelTokenLimits(input: unknown): ModelTokenLimits {
	const records = collectMetadataRecords(input);
	const contextWindowTokens = findNumber(records, TOTAL_KEYS) ?? findTaggedContext(records);
	return {
		contextWindowTokens,
		maxInputTokens: findNumber(records, INPUT_KEYS),
		maxOutputTokens: findNumber(records, OUTPUT_KEYS),
	};
}

function collectMetadataRecords(input: unknown): readonly Record<string, unknown>[] {
	if (!isRecord(input)) return [];
	const records: Record<string, unknown>[] = [];
	const queue: Array<{ value: Record<string, unknown>; depth: number }> = [
		{ value: input, depth: 0 },
	];
	const seen = new Set<Record<string, unknown>>();

	while (queue.length > 0) {
		const current = queue.shift();
		if (!current || seen.has(current.value)) continue;
		seen.add(current.value);
		records.push(current.value);
		if (current.depth >= 4) continue;

		for (const [key, value] of Object.entries(current.value)) {
			if (isRecord(value) && shouldVisitBranch(key)) {
				queue.push({ value, depth: current.depth + 1 });
				continue;
			}
			// A few gateways serialize `model_info`/`metadata` as JSON text.
			if (typeof value === 'string' && shouldVisitBranch(key)) {
				const parsed = parseJsonRecord(value);
				if (parsed) queue.push({ value: parsed, depth: current.depth + 1 });
			}
		}
	}
	return records;
}

function shouldVisitBranch(key: string): boolean {
	return NESTED_METADATA_KEYS.has(normalizeKey(key));
}

function findNumber(
	records: readonly Record<string, unknown>[],
	keys: ReadonlySet<string>,
): number | undefined {
	for (const record of records) {
		for (const [key, value] of Object.entries(record)) {
			if (!keys.has(normalizeKey(key))) continue;
			const parsed = positiveTokenCount(value);
			if (parsed !== undefined) return parsed;
		}
	}
	return undefined;
}

function findTaggedContext(records: readonly Record<string, unknown>[]): number | undefined {
	for (const record of records) {
		for (const [key, value] of Object.entries(record)) {
			if (!CONTEXT_TAG_KEYS.has(normalizeKey(key))) continue;
			const values = Array.isArray(value) ? value : [value];
			for (const item of values) {
				if (typeof item !== 'string') continue;
				const match =
					/(?:^|[^0-9])([0-9]+(?:\.[0-9]+)?)\s*(k|m)\s*(?:tokens?)?(?=$|[^a-z0-9])/iu.exec(item);
				if (!match) continue;
				const amount = Number(match[1]);
				const multiplier = match[2].toLowerCase() === 'm' ? 1_000_000 : 1_000;
				const tokens = amount * multiplier;
				if (Number.isSafeInteger(tokens) && tokens > 0 && tokens <= 100_000_000) {
					return tokens;
				}
			}
		}
	}
	return undefined;
}

function positiveTokenCount(value: unknown): number | undefined {
	let number: number | undefined;
	if (typeof value === 'number') {
		number = value;
	} else if (typeof value === 'string') {
		const text = value.trim();
		if (/^\d+(?:\.\d+)?$/u.test(text)) {
			number = Number(text);
		} else {
			const unit = /^(\d+(?:\.\d+)?)\s*(k|m)$/iu.exec(text);
			if (unit) {
				number = Number(unit[1]) * (unit[2].toLowerCase() === 'm' ? 1_000_000 : 1_000);
			}
		}
	}
	if (number === undefined || !Number.isSafeInteger(number) || number <= 0) return undefined;
	// Context windows larger than this are not currently representable by the
	// VS Code LM API and are almost certainly an unrelated numeric field.
	return number <= 100_000_000 ? number : undefined;
}

function normalizeKey(value: string): string {
	return value.replace(/[^a-z0-9]/giu, '').toLowerCase();
}

function parseJsonRecord(value: string): Record<string, unknown> | undefined {
	try {
		const parsed: unknown = JSON.parse(value);
		return isRecord(parsed) ? parsed : undefined;
	} catch {
		return undefined;
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}
