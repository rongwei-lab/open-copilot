import type { ModelProfile, ModelRule } from './profile';

/**
 * Effort values understood by New API's mainstream OpenAI-compatible
 * converters.  Keep this list deliberately small: a model being labelled
 * "reasoning" does not prove that it accepts every vendor-specific value.
 */
export const STANDARD_REASONING_EFFORTS = ['low', 'medium', 'high'] as const;

/** Shared profile for providers whose OpenAI-compatible bridge maps effort to
 * a native thinking budget (Claude/Gemini/Grok). */
export const CLAUDE_REASONING_PROFILE: ModelProfile = {
	reasoning: {
		enabled: true,
		efforts: [...STANDARD_REASONING_EFFORTS],
		defaultEffort: 'medium',
		canDisable: true,
		requestStyle: 'chat-reasoning-effort',
		outputStyle: 'summary',
	},
};

/** OpenAI o-series and GPT-5 reasoning profile. These models do not have a
 * universally safe explicit `none` value, so disabling is not advertised. */
export const OPENAI_REASONING_PROFILE: ModelProfile = {
	reasoning: {
		enabled: true,
		efforts: [...STANDARD_REASONING_EFFORTS],
		defaultEffort: 'medium',
		canDisable: false,
		requestStyle: 'chat-reasoning-effort',
		outputStyle: 'summary',
	},
};

/** DeepSeek V4 uses the vendor `thinking` toggle and accepts its own
 * low/high/max ladder. */
export const DEEPSEEK_V4_REASONING_PROFILE: ModelProfile = {
	reasoning: {
		enabled: true,
		efforts: ['low', 'high', 'max'],
		defaultEffort: 'high',
		canDisable: true,
		requestStyle: 'chat-thinking',
		outputStyle: 'summary',
	},
};

/** Models such as DeepSeek R1 always emit reasoning but do not expose a
 * documented effort parameter through the generic New API contract. Keeping
 * the wire style `none` prevents the extension from inventing a request field
 * while still allowing diagnostics and the picker to identify reasoning-only
 * output when metadata is available. */
export const ALWAYS_REASONING_PROFILE: ModelProfile = {
	reasoning: {
		enabled: true,
		efforts: [],
		canDisable: false,
		requestStyle: 'none',
		outputStyle: 'summary',
	},
};

/**
 * Capability hints for Codex-compatible New API aliases.
 *
 * QuantumNous New API deployments commonly expose only `supported_endpoint_types`
 * in `/v1/models`, while their Codex channel still accepts the complete effort
 * ladder. Keep this fallback narrow and let explicit gateway metadata or a user
 * Profile override it whenever the deployment supports a different set.
 */
const STANDARD_CODEX_EFFORTS = ['low', 'medium', 'high'] as const;
const XHIGH_CODEX_EFFORTS = [...STANDARD_CODEX_EFFORTS, 'xhigh'] as const;
const MAX_CODEX_EFFORTS = [...XHIGH_CODEX_EFFORTS, 'max'] as const;

/** Full ladder used by the GPT-5.6 aliases documented by the gateway. */
export const CODEX_REASONING_PROFILE: ModelProfile = {
	reasoning: {
		enabled: true,
		efforts: [...MAX_CODEX_EFFORTS],
		defaultEffort: 'medium',
		canDisable: true,
		requestStyle: 'responses-object',
		outputStyle: 'summary',
	},
};

export const CODEX_REASONING_MODEL_PATTERNS = [
	'gpt-5.6',
	'gpt-5.6-*',
	'gpt-5.5',
	'gpt-5.5-*',
	'gpt-5.4*',
	'gpt-5.3-codex',
	'gpt-5.3-codex-*',
	'gpt-5.2',
	'codex-auto-review',
] as const;

const CODEX_MAX_REASONING_MODEL_PATTERNS = ['gpt-5.6', 'gpt-5.6-*'] as const;

const CODEX_BASE_REASONING_MODEL_PATTERNS = ['codex-mini-latest'] as const;

const CODEX_XHIGH_REASONING_MODEL_PATTERNS = [
	'gpt-5.5',
	'gpt-5.5-*',
	'gpt-5.4*',
	'gpt-5.3-codex',
	'gpt-5.3-codex-*',
	'gpt-5.2',
	'codex-auto-review',
] as const;

const CLAUDE_REASONING_MODEL_PATTERNS = [
	'*claude-3-7-*',
	'*claude-4-*',
	'*claude-4.*',
	'*claude-*-4-*',
	'*claude-*-4.*',
	'*claude-5-*',
	'*claude-5.*',
	'*claude-*-5*',
	'*claude-fable-5*',
] as const;

// Keep o-series matching segment-aware. A plain `*o4*` glob would also match
// unrelated IDs such as `solar-pro4`.
const OPENAI_REASONING_MODEL_PATTERNS = [
	'o1*',
	'o3*',
	'o4*',
	'*[/_.:]o1*',
	'*[/_.:]o3*',
	'*[/_.:]o4*',
	'*gpt-5*',
] as const;

const GEMINI_REASONING_MODEL_PATTERNS = [
	'*gemini-2.5-*',
	'*gemini-3-*',
	'*gemini-3.*',
	'*gemini-robotics-*',
	'*gemini-flash*',
	'*gemini-pro*',
	'*gemini-omni*',
] as const;

const GROK_REASONING_MODEL_PATTERNS = ['*grok-3-mini*', '*grok-4*', '*grok-build-*'] as const;

const ALWAYS_REASONING_MODEL_PATTERNS = [
	'*deepseek-r1*',
	'*deepseek-reasoner*',
	'*deepseek-v3.1-*',
	'*deepseek-v3.2*',
	'*qwen3-[0-9]*',
	'*qwen3-vl-*',
	'*qwen3-omni-*',
	'*qwen3-next-*thinking*',
	'*qwen3.*-*',
	'*qwen-plus*',
	'*qwen-turbo*',
	'*qwen-flash*',
	'*qwq-*',
	'*qvq-*',
	'*kimi-k2-thinking*',
	'*kimi-k2.5*',
	'*kimi-k2.6*',
	'*kimi-k2.7*',
	'*kimi-k3*',
	'*kimi-for-coding*',
	'*k3',
	'*k3-*',
	'*glm-4.5*',
	'*glm-4.6*',
	'*glm-4.7*',
	'*glm-5*',
	'*minimax-m2*',
	'*minimax-m3*',
	'*magistral-*',
	'*command-a-plus*',
	'*command-a-reasoning*',
	'*mistral-medium-2604*',
	'*mistral-medium-latest*',
	'*mistral-small-2603*',
	'*mistral-small-latest*',
	'*hunyuan-*thinking*',
	'*hunyuan-t1*',
	'*ernie-x1*',
	'*ernie-*-thinking*',
	'*doubao-*-thinking*',
	'*seed-*-thinking*',
	'*longcat-*',
	'*mimo-*',
	'*step-3.5-*',
	'*step-3.7-*',
	'*solar-pro2*',
	'*solar-pro3*',
	'*solar-pro4*',
	'*sonar-deep-research*',
	'*sonar-reasoning-*',
	'*gemma-4-*',
	'*nova-2-*',
	'*fugu*',
	'*deep-research-*',
	'*muse-spark-*',
	'*north-mini-*',
	'*mercury-2*',
	'*sakana-*',
	'*sarvam-*',
	'*ring-1t*',
	'*thinkingmachines/*',
	'v0-*',
	'*hy3*',
	'*laguna-*',
] as const;

const DEEPSEEK_V4_REASONING_MODEL_PATTERNS = ['*deepseek-v4-*', '*deepseek-v4'] as const;

function reasoningRule(match: string, efforts: readonly string[], idPrefix: string): ModelRule {
	return {
		id: `builtInRule:codex-reasoning:${idPrefix}:${match}`,
		match,
		profile: {
			reasoning: {
				...CODEX_REASONING_PROFILE.reasoning,
				efforts: [...efforts],
			},
		},
	};
}

function profileReasoningRule(match: string, profile: ModelProfile, idPrefix: string): ModelRule {
	return {
		id: `builtInRule:${idPrefix}:${match}`,
		match,
		profile: cloneProfile(profile),
	};
}

function cloneProfile(profile: ModelProfile): ModelProfile {
	return {
		...profile,
		reasoning: profile.reasoning
			? {
					...profile.reasoning,
					efforts: profile.reasoning.efforts ? [...profile.reasoning.efforts] : undefined,
					effortMap: profile.reasoning.effortMap ? { ...profile.reasoning.effortMap } : undefined,
				}
			: undefined,
		extraRequestFields: profile.extraRequestFields ? { ...profile.extraRequestFields } : undefined,
	};
}

/** Claude 3.7+/4+/5 aliases exposed by New API's OpenAI-compatible bridge. */
export function createClaudeReasoningRules(): readonly ModelRule[] {
	return CLAUDE_REASONING_MODEL_PATTERNS.map((match) =>
		profileReasoningRule(match, CLAUDE_REASONING_PROFILE, 'claude-reasoning'),
	);
}

/** OpenAI o-series and GPT-5 aliases (Codex-specific levels are appended by
 * `createCodexReasoningRules` so their narrower rules win). */
export function createOpenAIReasoningRules(): readonly ModelRule[] {
	return OPENAI_REASONING_MODEL_PATTERNS.map((match) =>
		profileReasoningRule(match, OPENAI_REASONING_PROFILE, 'openai-reasoning'),
	);
}

/** Gemini 2.5/3 aliases. New API maps low/medium/high to the provider's
 * thinking budget/level when its thinking adapter is enabled. */
export function createGeminiReasoningRules(): readonly ModelRule[] {
	return GEMINI_REASONING_MODEL_PATTERNS.map((match) =>
		profileReasoningRule(match, CLAUDE_REASONING_PROFILE, 'gemini-reasoning'),
	);
}

/** Grok reasoning aliases supported by the OpenAI-compatible route. */
export function createGrokReasoningRules(): readonly ModelRule[] {
	return GROK_REASONING_MODEL_PATTERNS.map((match) =>
		profileReasoningRule(match, CLAUDE_REASONING_PROFILE, 'grok-reasoning'),
	);
}

/** Always-on reasoning families. No effort selector is exposed until the
 * gateway publishes a concrete wire contract. */
export function createAlwaysReasoningRules(): readonly ModelRule[] {
	return ALWAYS_REASONING_MODEL_PATTERNS.map((match) =>
		profileReasoningRule(match, ALWAYS_REASONING_PROFILE, 'always-reasoning'),
	);
}

/** DeepSeek V4 aliases, including date/provider-qualified IDs. */
export function createDeepSeekV4ReasoningRules(): readonly ModelRule[] {
	return DEEPSEEK_V4_REASONING_MODEL_PATTERNS.map((match) =>
		profileReasoningRule(match, DEEPSEEK_V4_REASONING_PROFILE, 'deepseek-v4-reasoning'),
	);
}

/** All mainstream reasoning rules, excluding the separate Codex ladder. */
export function createMainstreamReasoningRules(): readonly ModelRule[] {
	return [
		...createClaudeReasoningRules(),
		...createOpenAIReasoningRules(),
		...createGeminiReasoningRules(),
		...createGrokReasoningRules(),
		...createAlwaysReasoningRules(),
		...createDeepSeekV4ReasoningRules(),
	];
}

/** Return the built-in rules without exposing mutable shared arrays. */
export function createCodexReasoningRules(): readonly ModelRule[] {
	const fullLadderRules = CODEX_MAX_REASONING_MODEL_PATTERNS.map((match) =>
		reasoningRule(match, MAX_CODEX_EFFORTS, 'max'),
	);
	const xhighRules = CODEX_XHIGH_REASONING_MODEL_PATTERNS.map((match) =>
		reasoningRule(match, XHIGH_CODEX_EFFORTS, 'xhigh'),
	);
	const baseRules = CODEX_BASE_REASONING_MODEL_PATTERNS.map((match) =>
		reasoningRule(match, STANDARD_CODEX_EFFORTS, 'standard'),
	);
	return [...baseRules, ...xhighRules, ...fullLadderRules];
}
