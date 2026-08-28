import type { ModelProfile, ModelRule } from './profile';
import {
	createCodexReasoningRules,
	createMainstreamReasoningRules,
	OPENAI_REASONING_PROFILE,
} from './reasoning-rules';

/**
 * Built-in capability matrix for model IDs commonly published by New API.
 *
 * New API's public `/v1/models` response usually contains only an ID and an
 * endpoint list. These rules fill the missing, well-documented hints while
 * preserving the resolver precedence:
 *
 *   user Profile/rule > gateway metadata > compatibility probe > built-in rule
 *   > conservative default
 *
 * A rule intentionally grants only capabilities that are stable across the
 * mainstream OpenAI-compatible adapters. Vendor-specific reasoning protocols
 * (for example Qwen's `thinking_budget`) stay opt-in through a user Profile.
 */

const GPT_4O_LIMITS: ModelProfile = {
	contextWindowTokens: 128_000,
	maxOutputTokens: 16_384,
};

const GPT_4_1_LIMITS: ModelProfile = {
	contextWindowTokens: 1_047_576,
	maxOutputTokens: 32_768,
};

const GPT_5_LIMITS: ModelProfile = {
	contextWindowTokens: 400_000,
	maxOutputTokens: 128_000,
};

const GPT_5_STANDARD_SPLIT_LIMITS: ModelProfile = {
	contextWindowTokens: 400_000,
	maxInputTokens: 272_000,
	maxOutputTokens: 128_000,
};

const GPT_4_LIMITS: ModelProfile = {
	contextWindowTokens: 8_192,
	maxOutputTokens: 4_096,
};

// GPT-3.5 Turbo remains present in a number of long-lived New API channels.
// Keep it separate from the GPT-4 fallback so the picker does not advertise
// the 128K unknown-model window for the documented 16K chat endpoint.
const GPT_35_LIMITS: ModelProfile = {
	contextWindowTokens: 16_384,
	maxOutputTokens: 4_096,
};

const OPENAI_O_LIMITS: ModelProfile = {
	contextWindowTokens: 200_000,
	maxOutputTokens: 100_000,
};

const OPENAI_GPT_5_LONG_CONTEXT_LIMITS: ModelProfile = {
	contextWindowTokens: 1_050_000,
	maxInputTokens: 922_000,
	maxOutputTokens: 128_000,
};

const OPENAI_GPT_5_CHAT_LIMITS: ModelProfile = {
	contextWindowTokens: 128_000,
	maxInputTokens: 111_616,
	maxOutputTokens: 16_384,
};

const CLAUDE_STANDARD_LIMITS: ModelProfile = {
	contextWindowTokens: 200_000,
	maxOutputTokens: 8_192,
};

const CLAUDE_LONG_CONTEXT_LIMITS: ModelProfile = {
	contextWindowTokens: 1_000_000,
	maxOutputTokens: 32_000,
};

const GEMINI_LIMITS: ModelProfile = {
	contextWindowTokens: 1_048_576,
	maxOutputTokens: 65_536,
};

const GROK_STANDARD_LIMITS: ModelProfile = {
	contextWindowTokens: 131_072,
	maxOutputTokens: 32_768,
};

const GROK_LONG_CONTEXT_LIMITS: ModelProfile = {
	contextWindowTokens: 500_000,
	maxOutputTokens: 32_768,
};

const GROK_MILLION_CONTEXT_LIMITS: ModelProfile = {
	contextWindowTokens: 1_000_000,
	maxOutputTokens: 32_768,
};

const DEEPSEEK_STANDARD_LIMITS: ModelProfile = {
	contextWindowTokens: 128_000,
	maxOutputTokens: 8_192,
};

const DEEPSEEK_V4_LIMITS: ModelProfile = {
	contextWindowTokens: 1_048_576,
	maxInputTokens: 655_360,
	maxOutputTokens: 393_216,
};

const DEEPSEEK_MILLION_LIMITS: ModelProfile = {
	contextWindowTokens: 1_000_000,
	maxOutputTokens: 8_192,
};

const DEEPSEEK_163K_LIMITS: ModelProfile = {
	contextWindowTokens: 163_840,
	maxOutputTokens: 8_192,
};

const QWEN_LIMITS: ModelProfile = {
	contextWindowTokens: 128_000,
	maxOutputTokens: 8_192,
};

const QWEN_131K_LIMITS: ModelProfile = {
	contextWindowTokens: 131_072,
	maxOutputTokens: 8_192,
};

const QWEN_262K_LIMITS: ModelProfile = {
	contextWindowTokens: 262_144,
	maxOutputTokens: 8_192,
};

const QWEN_MILLION_LIMITS: ModelProfile = {
	contextWindowTokens: 1_000_000,
	maxOutputTokens: 8_192,
};

const QWEN_65K_LIMITS: ModelProfile = {
	contextWindowTokens: 65_536,
	maxOutputTokens: 8_192,
};

const CONTEXT_8K_LIMITS: ModelProfile = {
	contextWindowTokens: 8_192,
	maxOutputTokens: 4_096,
};

const CONTEXT_16K_LIMITS: ModelProfile = {
	contextWindowTokens: 16_384,
	maxOutputTokens: 4_096,
};

const CONTEXT_32K_LIMITS: ModelProfile = {
	contextWindowTokens: 32_768,
	maxOutputTokens: 8_192,
};

const CONTEXT_64K_LIMITS: ModelProfile = {
	contextWindowTokens: 65_536,
	maxOutputTokens: 8_192,
};

const CONTEXT_131K_LIMITS: ModelProfile = {
	contextWindowTokens: 131_072,
	maxOutputTokens: 8_192,
};

const CONTEXT_196K_LIMITS: ModelProfile = {
	contextWindowTokens: 196_608,
	maxOutputTokens: 8_192,
};

const CONTEXT_524K_LIMITS: ModelProfile = {
	contextWindowTokens: 524_288,
	maxOutputTokens: 8_192,
};

const GENERIC_128K_LIMITS: ModelProfile = {
	contextWindowTokens: 128_000,
	maxOutputTokens: 8_192,
};

const CONTEXT_200K_LIMITS: ModelProfile = {
	contextWindowTokens: 204_800,
	maxOutputTokens: 8_192,
};

const CONTEXT_256K_LIMITS: ModelProfile = {
	contextWindowTokens: 262_144,
	maxOutputTokens: 8_192,
};

const CONTEXT_1M_LIMITS: ModelProfile = {
	contextWindowTokens: 1_000_000,
	maxOutputTokens: 8_192,
};

const NATIVE_VISION: ModelProfile = {
	imageMode: 'native',
	nativeImageInput: true,
};

const TEXT_ONLY: ModelProfile = {
	imageMode: 'proxy',
	nativeImageInput: false,
};

const NO_REASONING: ModelProfile = {
	reasoning: {
		enabled: false,
		efforts: [],
		defaultEffort: 'none',
		canDisable: false,
		requestStyle: 'none',
		outputStyle: 'none',
	},
};

// Glob rules do not understand word boundaries. Keep the o-series patterns
// segment-aware so an unrelated ID such as `solar-pro4` is not mistaken for
// OpenAI `o4` merely because it contains the same characters.
const OPENAI_O_MODEL_PATTERNS = [
	'o1*',
	'o3*',
	'o4*',
	'*[/_.:]o1*',
	'*[/_.:]o3*',
	'*[/_.:]o4*',
] as const;

const OPENAI_O3_MINI_PATTERNS = ['o3-mini*', '*[/_.:]o3-mini*'] as const;
const OPENAI_O1_MINI_PATTERNS = ['o1-mini*', '*[/_.:]o1-mini*'] as const;

function rule(id: string, match: string, profile: ModelProfile): ModelRule {
	return { id: `builtInRule:${id}`, match, profile: cloneProfile(profile) };
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

/**
 * Return a fresh capability matrix. Profiles are treated as immutable by the
 * resolver, but returning new objects prevents a future caller from mutating
 * module-level state and changing another provider instance.
 */
export function createBuiltInModelRules(): readonly ModelRule[] {
	return [
		// ---- OpenAI ---------------------------------------------------------
		rule('openai-gpt-tool-calling', '*gpt-*', {
			toolCalling: true,
			parallelToolCalls: true,
		}),
		rule('openai-gpt-3.5-tool-calling', '*gpt-3.5-turbo*', { toolCalling: true }),
		...OPENAI_O_MODEL_PATTERNS.map((match) =>
			rule(`openai-o-tool-calling:${match}`, match, {
				toolCalling: true,
				parallelToolCalls: true,
			}),
		),
		rule('openai-gpt-3.5-limits', '*gpt-3.5-turbo*', { ...GPT_35_LIMITS }),
		rule('openai-gpt-4-limits', '*gpt-4*', { ...GPT_4_LIMITS }),
		rule('openai-gpt-4o-limits', '*gpt-4o*', { ...GPT_4O_LIMITS }),
		rule('openai-gpt-4-turbo-limits', '*gpt-4-turbo*', {
			contextWindowTokens: 128_000,
			maxOutputTokens: 4_096,
		}),
		rule('openai-gpt-4.1-limits', '*gpt-4.1*', { ...GPT_4_1_LIMITS }),
		rule('openai-gpt-5-limits', '*gpt-5*', { ...GPT_5_LIMITS }),
		// GPT-5.6 aliases published by the current Codex gateway use a larger
		// 922K prompt + 128K output split than the regular GPT-5 endpoint.
		rule('openai-gpt-5.6-limits', '*gpt-5.6*', {
			...OPENAI_GPT_5_LONG_CONTEXT_LIMITS,
		}),
		rule('openai-gpt-5.5-limits', '*gpt-5.5*', {
			...OPENAI_GPT_5_LONG_CONTEXT_LIMITS,
		}),
		rule('openai-gpt-5.4-limits', '*gpt-5.4*', {
			...OPENAI_GPT_5_LONG_CONTEXT_LIMITS,
		}),
		// Mini/nano variants retain the regular GPT-5 window even though the
		// flagship/pro aliases expose the larger 1.05M split.
		rule('openai-gpt-5.4-mini-limits', '*gpt-5.4-mini*', {
			...GPT_5_STANDARD_SPLIT_LIMITS,
		}),
		rule('openai-gpt-5.4-nano-limits', '*gpt-5.4-nano*', {
			...GPT_5_STANDARD_SPLIT_LIMITS,
		}),
		rule('openai-gpt-5.4-pro-limits', '*gpt-5.4-pro*', {
			...OPENAI_GPT_5_LONG_CONTEXT_LIMITS,
		}),
		rule('openai-gpt-5.3-codex-spark-limits', '*gpt-5.3-codex-spark*', {
			...OPENAI_GPT_5_CHAT_LIMITS,
		}),
		rule('openai-gpt-5.2-chat-limits', '*gpt-5.2-chat-*', {
			...OPENAI_GPT_5_CHAT_LIMITS,
		}),
		rule('openai-gpt-5.3-chat-limits', '*gpt-5.3-chat-*', {
			...OPENAI_GPT_5_CHAT_LIMITS,
		}),
		rule('openai-gpt-5-chat-limits', '*gpt-5.*-chat-*', {
			...OPENAI_GPT_5_CHAT_LIMITS,
		}),
		...OPENAI_O_MODEL_PATTERNS.map((match) =>
			rule(`openai-o-limits:${match}`, match, { ...OPENAI_O_LIMITS }),
		),
		rule('openai-native-vision', '*gpt-4o*', { ...NATIVE_VISION }),
		rule('openai-native-vision-4.1', '*gpt-4.1*', { ...NATIVE_VISION }),
		rule('openai-native-vision-5', '*gpt-5*', { ...NATIVE_VISION }),
		...OPENAI_O_MODEL_PATTERNS.map((match) =>
			rule(`openai-native-vision:${match}`, match, { ...NATIVE_VISION }),
		),
		rule('openai-gpt-4-turbo-vision', '*gpt-4-turbo*', { ...NATIVE_VISION }),
		rule('openai-gpt-4-vision-preview', '*gpt-4-vision*', { ...NATIVE_VISION }),
		// o3-mini is a text-only reasoning model in the mainstream registry;
		// do not inherit the broader o-series vision hint.
		...OPENAI_O3_MINI_PATTERNS.map((match) =>
			rule(`openai-o3-mini-text-only:${match}`, match, { ...TEXT_ONLY }),
		),
		...OPENAI_O1_MINI_PATTERNS.map((match) =>
			rule(`openai-o1-mini-text-only:${match}`, match, { ...TEXT_ONLY }),
		),

		// ---- Anthropic Claude ----------------------------------------------
		rule('claude-tool-calling', '*claude-*', { toolCalling: true }),
		rule('claude-standard-limits', '*claude-*', { ...CLAUDE_STANDARD_LIMITS }),
		// Claude Opus/Sonnet 4.6+ and the newer aliases publish the 1M window;
		// keep the narrower 200K rule above for older/date-suffixed models.
		rule('claude-long-context-limits', '*claude-opus-4-6*', {
			...CLAUDE_LONG_CONTEXT_LIMITS,
		}),
		rule('claude-long-context-limits-47', '*claude-opus-4-7*', {
			...CLAUDE_LONG_CONTEXT_LIMITS,
		}),
		rule('claude-long-context-limits-48', '*claude-opus-4-8*', {
			...CLAUDE_LONG_CONTEXT_LIMITS,
		}),
		rule('claude-long-context-limits-5', '*claude-opus-5*', {
			...CLAUDE_LONG_CONTEXT_LIMITS,
		}),
		rule('claude-long-context-sonnet-46', '*claude-sonnet-4-6*', {
			...CLAUDE_LONG_CONTEXT_LIMITS,
		}),
		rule('claude-long-context-sonnet-45', '*claude-sonnet-4-5*', {
			...CLAUDE_LONG_CONTEXT_LIMITS,
		}),
		rule('claude-long-context-sonnet-5', '*claude-sonnet-5*', {
			...CLAUDE_LONG_CONTEXT_LIMITS,
		}),
		rule('claude-long-context-fable-5', '*claude-fable-5*', {
			...CLAUDE_LONG_CONTEXT_LIMITS,
		}),
		rule('claude-native-vision-3', '*claude-3-*', { ...NATIVE_VISION }),
		rule('claude-native-vision-4', '*claude-4-*', { ...NATIVE_VISION }),
		rule('claude-native-vision-4-named', '*claude-*-4-*', { ...NATIVE_VISION }),
		rule('claude-native-vision-5', '*claude-5-*', { ...NATIVE_VISION }),
		rule('claude-native-vision-5-named', '*claude-*-5*', { ...NATIVE_VISION }),
		rule('claude-native-vision-fable', '*claude-fable-5*', { ...NATIVE_VISION }),

		// ---- Google Gemini --------------------------------------------------
		rule('gemini-tool-calling', '*gemini-*', {
			toolCalling: true,
			parallelToolCalls: true,
		}),
		rule('gemini-2-limits', '*gemini-2.*', { ...GEMINI_LIMITS }),
		rule('gemini-3-limits', '*gemini-3*', { ...GEMINI_LIMITS }),
		rule('gemini-flash-latest-limits', '*gemini-flash*', { ...GEMINI_LIMITS }),
		rule('gemini-pro-latest-limits', '*gemini-pro*', { ...GEMINI_LIMITS }),
		rule('gemini-omni-latest-limits', '*gemini-omni*', { ...GEMINI_LIMITS }),
		rule('gemini-native-vision-2', '*gemini-2.*', { ...NATIVE_VISION }),
		rule('gemini-native-vision-3', '*gemini-3*', { ...NATIVE_VISION }),
		rule('gemini-native-vision-flash-latest', '*gemini-flash*', { ...NATIVE_VISION }),
		rule('gemini-native-vision-pro-latest', '*gemini-pro*', { ...NATIVE_VISION }),
		rule('gemini-native-vision-omni-latest', '*gemini-omni*', { ...NATIVE_VISION }),

		// ---- xAI Grok ------------------------------------------------------
		rule('grok-tool-calling', '*grok-*', {
			toolCalling: true,
			parallelToolCalls: true,
		}),
		rule('grok-standard-limits', '*grok-3*', { ...GROK_STANDARD_LIMITS }),
		rule('grok-long-context-limits', '*grok-4*', { ...GROK_LONG_CONTEXT_LIMITS }),
		rule('grok-million-context-43', '*grok-4.3*', { ...GROK_MILLION_CONTEXT_LIMITS }),
		rule('grok-million-context-420', '*grok-4.20*', { ...GROK_MILLION_CONTEXT_LIMITS }),
		rule('grok-build-limits', '*grok-build-*', { ...CONTEXT_256K_LIMITS }),
		rule('grok-native-vision-2', '*grok-2-vision*', { ...NATIVE_VISION }),
		rule('grok-native-vision-3', '*grok-3*', { ...NATIVE_VISION }),
		rule('grok-native-vision-4', '*grok-4*', { ...NATIVE_VISION }),
		rule('grok-build-native-vision', '*grok-build-*', { ...NATIVE_VISION }),
		// xAI's mini reasoning aliases are text-first in several gateways;
		// leave them proxy-only until `/models` or a probe confirms images.
		rule('grok-mini-text-only', '*grok-3-mini*', { ...TEXT_ONLY }),

		// ---- DeepSeek -------------------------------------------------------
		rule('deepseek-tool-calling', '*deepseek-*', {
			toolCalling: true,
			parallelToolCalls: true,
		}),
		rule('deepseek-standard-limits', '*deepseek-v3*', { ...DEEPSEEK_STANDARD_LIMITS }),
		rule('deepseek-r1-limits', '*deepseek-r1*', { ...DEEPSEEK_STANDARD_LIMITS }),
		rule('deepseek-163k-r1-0528-limits', '*deepseek-r1-0528*', {
			...DEEPSEEK_163K_LIMITS,
		}),
		rule('deepseek-163k-v3-limits', '*deepseek-v3-*', { ...DEEPSEEK_163K_LIMITS }),
		rule('deepseek-reasoner-limits', '*deepseek-reasoner*', {
			...DEEPSEEK_MILLION_LIMITS,
		}),
		rule('deepseek-chat-limits', '*deepseek-chat*', { ...DEEPSEEK_MILLION_LIMITS }),
		rule('deepseek-v31-limits', '*deepseek-v3.1*', { ...DEEPSEEK_163K_LIMITS }),
		rule('deepseek-v32-limits', '*deepseek-v3.2*', { ...DEEPSEEK_163K_LIMITS }),
		rule('deepseek-v4-limits', '*deepseek-v4*', { ...DEEPSEEK_V4_LIMITS }),
		// V3/R1 are text-only. Do not turn the presence of a DeepSeek model into
		// a native Vision badge; only explicit VL/vision/omni variants qualify.
		rule('deepseek-text-only', '*deepseek-v3*', { ...TEXT_ONLY }),
		rule('deepseek-r1-text-only', '*deepseek-r1*', { ...TEXT_ONLY }),
		rule('deepseek-reasoner-text-only', '*deepseek-reasoner*', { ...TEXT_ONLY }),
		rule('deepseek-native-vision', '*deepseek-*-vision*', { ...NATIVE_VISION }),
		rule('deepseek-native-vl', '*deepseek-*-vl*', { ...NATIVE_VISION }),
		rule('deepseek-native-omni', '*deepseek-*-omni*', { ...NATIVE_VISION }),

		// ---- Alibaba Qwen --------------------------------------------------
		rule('qwen-tool-calling', '*qwen*', { toolCalling: true }),
		rule('qwen-tool-calling-prefixed', '*qwen/*', { toolCalling: true }),
		rule('qwq-tool-calling', '*qwq-*', { toolCalling: true }),
		rule('qvq-tool-calling', '*qvq-*', { toolCalling: true }),
		rule('qwen-limits', '*qwen*', { ...QWEN_LIMITS }),
		rule('qwen-limits-prefixed', '*qwen/*', { ...QWEN_LIMITS }),
		rule('qwq-limits', '*qwq-*', { ...QWEN_LIMITS }),
		rule('qwen-131k-limits', '*qwen3-*', { ...QWEN_131K_LIMITS }),
		rule('qwen-131k-vl-limits', '*qwen-vl-*', { ...QWEN_131K_LIMITS }),
		rule('qwen-131k-vl-25-limits', '*qwen2-5-vl-*', { ...QWEN_131K_LIMITS }),
		rule('qwen-131k-vl-hosted-limits', '*qwen-vl-(max|plus)*', {
			...QWEN_131K_LIMITS,
		}),
		rule('qwen-131k-qvq-limits', '*qvq-*', { ...QWEN_131K_LIMITS }),
		rule('qwen-1m-deep-research-limits', '*qwen-deep-research*', {
			...QWEN_MILLION_LIMITS,
		}),
		rule('qwen-max-limits', '*qwen-max*', { ...CONTEXT_32K_LIMITS }),
		rule('qwen-math-limits', '*qwen-math-*', { ...CONTEXT_8K_LIMITS }),
		rule('qwen-any-math-limits', '*qwen*-math-*', { ...CONTEXT_8K_LIMITS }),
		rule('qwen-mt-limits', '*qwen-mt-*', { ...CONTEXT_16K_LIMITS }),
		rule('qwen-omni-turbo-limits', '*qwen-omni-*', { ...CONTEXT_32K_LIMITS }),
		rule('qwen-omni-25-limits', '*qwen2-5-omni-*', { ...CONTEXT_32K_LIMITS }),
		rule('qwen-vl-ocr-limits', '*qwen-vl-ocr*', { ...CONTEXT_32K_LIMITS }),
		rule('qwen-262k-coder-limits', '*qwen3-coder-*', { ...QWEN_262K_LIMITS }),
		rule('qwen-262k-max-limits', '*qwen3-max*', { ...QWEN_262K_LIMITS }),
		rule('qwen-262k-vl-plus-limits', '*qwen3-vl-plus*', { ...QWEN_262K_LIMITS }),
		rule('qwen-262k-35-limits', '*qwen3.5-*', { ...QWEN_262K_LIMITS }),
		rule('qwen-262k-36-limits', '*qwen3.6-*', { ...QWEN_262K_LIMITS }),
		rule('qwen-1m-hosted-limits', '*qwen-plus*', { ...QWEN_MILLION_LIMITS }),
		rule('qwen-1m-turbo-limits', '*qwen-turbo*', { ...QWEN_MILLION_LIMITS }),
		rule('qwen-1m-flash-limits', '*qwen-flash*', { ...QWEN_MILLION_LIMITS }),
		rule('qwen-1m-long-limits', '*qwen-long*', {
			contextWindowTokens: 10_000_000,
			maxOutputTokens: 8_192,
		}),
		rule('qwen-1m-coder-flash-limits', '*qwen3-coder-flash*', { ...QWEN_MILLION_LIMITS }),
		rule('qwen-1m-coder-plus-limits', '*qwen3-coder-plus*', { ...QWEN_MILLION_LIMITS }),
		rule('qwen-1m-35-plus-limits', '*qwen3.5-plus*', { ...QWEN_MILLION_LIMITS }),
		rule('qwen-1m-35-flash-limits', '*qwen3.5-flash*', { ...QWEN_MILLION_LIMITS }),
		rule('qwen-1m-36-flash-limits', '*qwen3.6-flash*', { ...QWEN_MILLION_LIMITS }),
		rule('qwen-1m-36-plus-limits', '*qwen3.6-plus*', { ...QWEN_MILLION_LIMITS }),
		rule('qwen-1m-37-limits', '*qwen3.7-*', { ...QWEN_MILLION_LIMITS }),
		rule('qwen-1m-38-limits', '*qwen3.8-*', { ...QWEN_MILLION_LIMITS }),
		rule('qwen-65k-omni-limits', '*qwen3-omni-*', { ...QWEN_65K_LIMITS }),
		rule('qwen-native-vl', '*qwen*-vl*', { ...NATIVE_VISION }),
		rule('qwen-native-vision', '*qwen*-vision*', { ...NATIVE_VISION }),
		rule('qwen-native-omni', '*qwen*-omni*', { ...NATIVE_VISION }),
		rule('qwenvl-native', '*qwenvl*', { ...NATIVE_VISION }),
		rule('qwen-native-qvq', '*qvq-*', { ...NATIVE_VISION }),
		rule('qwen-native-omni-turbo', '*qwen-omni-*', { ...NATIVE_VISION }),
		rule('qwen-native-35', '*qwen3.5-*', { ...NATIVE_VISION }),
		rule('qwen-native-36-27b', '*qwen3.6-27b*', { ...NATIVE_VISION }),
		rule('qwen-native-36-35b', '*qwen3.6-35b*', { ...NATIVE_VISION }),
		rule('qwen-native-36-flash', '*qwen3.6-flash*', { ...NATIVE_VISION }),
		rule('qwen-native-36-plus', '*qwen3.6-plus*', { ...NATIVE_VISION }),
		rule('qwen-native-37-flash', '*qwen3.7-flash*', { ...NATIVE_VISION }),
		rule('qwen-native-37-plus', '*qwen3.7-plus*', { ...NATIVE_VISION }),
		rule('qwen-native-38-max', '*qwen3.8-max*', { ...NATIVE_VISION }),

		// ---- Mistral / Meta Llama / open multimodal families --------------
		rule('mistral-tool-calling', '*mistral-*', { toolCalling: true }),
		rule('mixtral-tool-calling', '*mixtral-*', { toolCalling: true }),
		rule('codestral-tool-calling', '*codestral-*', { toolCalling: true }),
		rule('devstral-tool-calling', '*devstral-*', { toolCalling: true }),
		rule('magistral-tool-calling', '*magistral-*', { toolCalling: true }),
		rule('mistral-limits', '*mistral-*', { ...GENERIC_128K_LIMITS }),
		rule('mixtral-limits', '*mixtral-*', { ...GENERIC_128K_LIMITS }),
		rule('codestral-limits', '*codestral-*', { ...GENERIC_128K_LIMITS }),
		rule('mistral-large-2411-limits', '*mistral-large-2411*', {
			...CONTEXT_131K_LIMITS,
		}),
		rule('devstral-limits', '*devstral-*', { ...CONTEXT_131K_LIMITS }),
		rule('devstral-long-limits', '*devstral-2512*', { ...CONTEXT_256K_LIMITS }),
		rule('devstral-latest-limits', '*devstral-latest*', { ...CONTEXT_256K_LIMITS }),
		rule('labs-devstral-long-limits', '*labs-devstral-small-2512*', {
			...CONTEXT_256K_LIMITS,
		}),
		rule('devstral-medium-latest-limits', '*devstral-medium-latest*', {
			...CONTEXT_256K_LIMITS,
		}),
		rule('codestral-latest-limits', '*codestral-latest*', { ...CONTEXT_256K_LIMITS }),
		rule('mistral-large-long-limits', '*mistral-large-25*', { ...CONTEXT_256K_LIMITS }),
		rule('mistral-large-latest-limits', '*mistral-large-latest*', {
			...CONTEXT_256K_LIMITS,
		}),
		rule('mistral-medium-2505-limits', '*mistral-medium-2505*', {
			...CONTEXT_131K_LIMITS,
		}),
		rule('mistral-medium-2508-limits', '*mistral-medium-2508*', {
			...CONTEXT_256K_LIMITS,
		}),
		rule('mistral-medium-2604-limits', '*mistral-medium-2604*', {
			...CONTEXT_256K_LIMITS,
		}),
		rule('mistral-medium-latest-limits', '*mistral-medium-latest*', {
			...CONTEXT_256K_LIMITS,
		}),
		rule('mistral-small-2506-limits', '*mistral-small-2506*', {
			...CONTEXT_131K_LIMITS,
		}),
		rule('mistral-small-2603-limits', '*mistral-small-2603*', {
			...CONTEXT_256K_LIMITS,
		}),
		rule('mistral-small-latest-limits', '*mistral-small-latest*', {
			...CONTEXT_256K_LIMITS,
		}),
		rule('mixtral-8x22b-limits', '*mixtral-8x22b*', { ...CONTEXT_64K_LIMITS }),
		rule('mixtral-8x7b-limits', '*mixtral-8x7b*', { ...CONTEXT_32K_LIMITS }),
		rule('open-mistral-7b-limits', '*open-mistral-7b*', { ...CONTEXT_8K_LIMITS }),
		rule('mistral-native-pixtral', '*pixtral*', { ...NATIVE_VISION }),
		rule('mistral-native-small-31', '*mistral-small-3.1*', { ...NATIVE_VISION }),
		rule('mistral-native-small-32', '*mistral-small-3.2*', { ...NATIVE_VISION }),
		rule('mistral-native-small-25', '*mistral-small-25*', { ...NATIVE_VISION }),
		rule('mistral-native-small-26', '*mistral-small-26*', { ...NATIVE_VISION }),
		rule('mistral-native-medium', '*mistral-medium-*', { ...NATIVE_VISION }),
		rule('mistral-native-large', '*mistral-large-25*', { ...NATIVE_VISION }),
		rule('mistral-native-large-latest', '*mistral-large-latest*', { ...NATIVE_VISION }),
		rule('mistral-native-small-2506', '*mistral-small-2506*', { ...NATIVE_VISION }),
		rule('mistral-native-small-2603', '*mistral-small-2603*', { ...NATIVE_VISION }),
		rule('mistral-native-small-latest', '*mistral-small-latest*', { ...NATIVE_VISION }),
		rule('mistral-native-devstral', '*devstral-*vision*', { ...NATIVE_VISION }),
		// The standard Devstral 2512 endpoint is text-only; the hosted
		// `labs-devstral-small-2512` alias below is the explicit vision variant.
		rule('mistral-devstral-2512-text-only', '*devstral-2512*', { ...TEXT_ONLY }),
		rule('mistral-native-labs-devstral', '*labs-devstral-small-2512*', {
			...NATIVE_VISION,
		}),
		rule('cohere-command-tool-calling', '*command-*', { toolCalling: true }),
		rule('cohere-command-limits', '*command-*', { ...GENERIC_128K_LIMITS }),
		rule('cohere-command-a-limits', '*command-a-*', { ...CONTEXT_256K_LIMITS }),
		rule('cohere-command-a-plus-limits', '*command-a-plus*', { ...CONTEXT_131K_LIMITS }),
		rule('cohere-command-a-vision-limits', '*command-a-*-vision*', {
			...CONTEXT_131K_LIMITS,
		}),
		rule('cohere-command-native-vision', '*command-a-*-vision*', { ...NATIVE_VISION }),
		rule('cohere-command-a-plus-native-vision', '*command-a-plus*', { ...NATIVE_VISION }),
		rule('cohere-aya-vision-limits', '*c4ai-aya-vision-*', { ...CONTEXT_16K_LIMITS }),
		rule('cohere-aya-native-vision', '*c4ai-aya-vision-*', { ...NATIVE_VISION }),
		rule('llama-tool-calling', '*llama-*', { toolCalling: true }),
		rule('llama-limits', '*llama-*', { ...GENERIC_128K_LIMITS }),
		rule('llama-native-32-vision', '*llama-3.2-*-vision*', { ...NATIVE_VISION }),
		rule('llama-native-4', '*llama-4-*', { ...NATIVE_VISION }),
		rule('llava-native-vision', '*llava*', { ...NATIVE_VISION }),
		rule('gemma-tool-calling', '*gemma-*', { toolCalling: true }),
		rule('gemma-limits', '*gemma-*', { ...CONTEXT_256K_LIMITS }),
		rule('gemma-native-vision', '*gemma-4-*', { ...NATIVE_VISION }),
		rule('hy3-tool-calling', '*hy3*', { toolCalling: true }),
		rule('hy3-limits', '*hy3*', { ...CONTEXT_256K_LIMITS }),
		rule('laguna-tool-calling', '*laguna-*', { toolCalling: true }),
		rule('laguna-other-limits', '*laguna-*', { ...CONTEXT_256K_LIMITS }),
		rule('laguna-limits', '*laguna-s-*', { ...CONTEXT_1M_LIMITS }),

		// ---- Zhipu / Moonshot / MiniMax -----------------------------------
		rule('glm-tool-calling', '*glm-*', { toolCalling: true }),
		rule('chatglm-tool-calling', '*chatglm*', { toolCalling: true }),
		rule('glm-limits', '*glm-*', { ...GENERIC_128K_LIMITS }),
		rule('chatglm-limits', '*chatglm*', { ...GENERIC_128K_LIMITS }),
		rule('glm-131k-limits-45', '*glm-4.5*', { ...CONTEXT_131K_LIMITS }),
		rule('glm-204k-limits', '*glm-4.6*', { ...CONTEXT_200K_LIMITS }),
		rule('glm-204k-limits-47', '*glm-4.7*', { ...CONTEXT_200K_LIMITS }),
		rule('glm-204k-limits-5', '*glm-5*', { ...CONTEXT_200K_LIMITS }),
		rule('glm-1m-limits', '*glm-5.2*', { ...CONTEXT_1M_LIMITS }),
		rule('glm-1m-limits-53', '*glm-5.3*', { ...CONTEXT_1M_LIMITS }),
		rule('glm-native-vision', '*glm-*-v*', { ...NATIVE_VISION }),
		rule('glm-native-vision-4v', '*glm-4v*', { ...NATIVE_VISION }),
		rule('chatglm-native-vision', '*chatglm*-vision*', { ...NATIVE_VISION }),
		rule('glm-native-vision-45v', '*glm-4.5v*', { ...NATIVE_VISION }),
		rule('glm-native-vision-46v', '*glm-4.6v*', { ...NATIVE_VISION }),
		rule('glm-native-vision-5v', '*glm-5v*', { ...NATIVE_VISION }),
		rule('glm-45v-limits', '*glm-4.5v*', { ...CONTEXT_64K_LIMITS }),
		rule('glm-46v-limits', '*glm-4.6v*', { ...CONTEXT_131K_LIMITS }),
		rule('glm-5v-limits', '*glm-5v*', { ...CONTEXT_200K_LIMITS }),
		rule('kimi-tool-calling', '*kimi-*', { toolCalling: true }),
		rule('moonshot-tool-calling', '*moonshot-*', { toolCalling: true }),
		rule('k3-tool-calling', 'k3*', { toolCalling: true }),
		rule('kimi-limits', '*kimi-*', { ...GENERIC_128K_LIMITS }),
		rule('moonshot-limits', '*moonshot-*', { ...GENERIC_128K_LIMITS }),
		rule('k3-limits', 'k3*', { ...CONTEXT_1M_LIMITS }),
		rule('k3-256k-limits', 'k3-256k*', { ...CONTEXT_256K_LIMITS }),
		rule('kimi-262k-limits', '*kimi-k2*', { ...CONTEXT_256K_LIMITS }),
		rule('kimi-k2-0711-limits', '*kimi-k2-0711*', { ...CONTEXT_131K_LIMITS }),
		rule('kimi-coding-limits', '*kimi-for-coding*', { ...CONTEXT_256K_LIMITS }),
		rule('kimi-1m-limits', '*kimi-k3*', { ...CONTEXT_1M_LIMITS }),
		rule('kimi-native-vision', '*kimi*-vision*', { ...NATIVE_VISION }),
		rule('kimi-native-k25', '*kimi-k2.5*', { ...NATIVE_VISION }),
		rule('kimi-native-k26', '*kimi-k2.6*', { ...NATIVE_VISION }),
		rule('kimi-native-k27', '*kimi-k2.7*', { ...NATIVE_VISION }),
		rule('kimi-native-k3', '*kimi-k3*', { ...NATIVE_VISION }),
		rule('kimi-native-k3-short', 'k3*', { ...NATIVE_VISION }),
		rule('kimi-native-coding', '*kimi-for-coding*', { ...NATIVE_VISION }),
		rule('minimax-tool-calling', '*minimax-*', { toolCalling: true }),
		rule('minimax-limits', '*minimax-*', { ...GENERIC_128K_LIMITS }),
		rule('minimax-reasoning-limits', '*minimax-m2*', { ...CONTEXT_200K_LIMITS }),
		rule('minimax-m2-exact-limits', '*minimax-m2', { ...CONTEXT_196K_LIMITS }),
		rule('minimax-m2-limits-exact', '*minimax-m2-*', { ...CONTEXT_196K_LIMITS }),
		rule('minimax-reasoning-limits-25', '*minimax-m2.5*', { ...CONTEXT_200K_LIMITS }),
		rule('minimax-reasoning-limits-27', '*minimax-m2.7*', { ...CONTEXT_200K_LIMITS }),
		rule('minimax-m3-limits', '*minimax-m3*', { ...CONTEXT_1M_LIMITS }),
		rule('minimax-native-vision', '*minimax*-vision*', { ...NATIVE_VISION }),
		rule('minimax-native-m3', '*minimax-m3*', { ...NATIVE_VISION }),

		// ---- Long-lived Chinese provider aliases ----------------------------
		// These IDs are still common in existing New API installations. Keep
		// the rules capability-light: only explicit vision/VL names receive raw
		// image input, while vendor-specific thinking fields remain opt-in.
		rule('yi-limits', '*yi-*', { ...CONTEXT_32K_LIMITS }),
		rule('yi-200k-limits', '*yi-medium-200k*', { ...CONTEXT_200K_LIMITS }),
		rule('yi-34b-200k-limits', '*yi-34b-chat-200k*', { ...CONTEXT_200K_LIMITS }),
		rule('yi-native-vision', '*yi-vision*', { ...NATIVE_VISION }),
		rule('yi-native-vl', '*yi-vl*', { ...NATIVE_VISION }),
		rule('ernie-limits', '*ernie-*', { ...CONTEXT_8K_LIMITS }),
		rule('ernie-128k-limits', '*ernie-*-128k*', { ...CONTEXT_131K_LIMITS }),
		rule('ernie-200k-limits', '*ernie-*-200k*', { ...CONTEXT_200K_LIMITS }),
		rule('ernie-native-vision', '*ernie-vision*', { ...NATIVE_VISION }),
		rule('ernie-native-vl', '*ernie-vl*', { ...NATIVE_VISION }),
		rule('doubao-limits', '*doubao-*', { ...GENERIC_128K_LIMITS }),
		rule('doubao-32k-limits', '*doubao-*-32k*', { ...CONTEXT_32K_LIMITS }),
		rule('doubao-128k-limits', '*doubao-*-128k*', { ...CONTEXT_131K_LIMITS }),
		rule('doubao-native-vision', '*doubao-*-vision*', { ...NATIVE_VISION }),
		rule('doubao-native-vl', '*doubao-*-vl*', { ...NATIVE_VISION }),
		rule('abab-limits', '*abab*', { ...CONTEXT_32K_LIMITS }),
		rule('abab-native-vision', '*abab*-vision*', { ...NATIVE_VISION }),

		// ---- Other mainstream families -------------------------------------
		rule('hunyuan-tool-calling', '*hunyuan-*', { toolCalling: true }),
		rule('hunyuan-limits', '*hunyuan-*', { ...CONTEXT_131K_LIMITS }),
		rule('longcat-tool-calling', '*longcat-*', { toolCalling: true }),
		rule('longcat-limits', '*longcat-*', { ...CONTEXT_1M_LIMITS }),
		rule('nova-tool-calling', '*nova-2-*', { toolCalling: true }),
		rule('nova-limits', '*nova-2-*', { ...CONTEXT_1M_LIMITS }),
		rule('nova-native-vision', '*nova-2-*', { ...NATIVE_VISION }),
		rule('mimo-tool-calling', '*mimo-*', { toolCalling: true }),
		rule('mimo-limits', '*mimo-v2-*', { ...CONTEXT_256K_LIMITS }),
		rule('mimo-v2-pro-limits', '*mimo-v2-pro*', { ...CONTEXT_1M_LIMITS }),
		rule('mimo-v25-limits', '*mimo-v2.5*', { ...CONTEXT_1M_LIMITS }),
		rule('mimo-native-vision', '*mimo-v2.5*', { ...NATIVE_VISION }),
		rule('mimo-native-omni', '*mimo-v2-omni*', { ...NATIVE_VISION }),
		rule('step-tool-calling', '*step-*', { toolCalling: true }),
		rule('step-limits', '*step-*', { ...CONTEXT_256K_LIMITS }),
		rule('step-1-limits', '*step-1-*', { ...CONTEXT_32K_LIMITS }),
		rule('step-2-limits', '*step-2-*', { ...CONTEXT_16K_LIMITS }),
		rule('step-native-vision', '*step-3.7-*', { ...NATIVE_VISION }),
		rule('solar-tool-calling', '*solar-*', { toolCalling: true }),
		rule('solar-limits', '*solar-*', { ...CONTEXT_131K_LIMITS }),
		rule('solar-mini-limits', '*solar-mini*', { ...CONTEXT_32K_LIMITS }),
		rule('solar-pro2-limits', '*solar-pro2*', { ...CONTEXT_64K_LIMITS }),
		rule('solar-pro4-limits', '*solar-pro4*', { ...CONTEXT_524K_LIMITS }),
		rule('sonar-native-pro', '*sonar-pro*', { ...NATIVE_VISION }),
		rule('sonar-native-reasoning-pro', '*sonar-reasoning-pro*', { ...NATIVE_VISION }),
		rule('sonar-pro-limits', '*sonar-pro*', { ...CONTEXT_200K_LIMITS }),
		rule('fugu-tool-calling', '*fugu*', { toolCalling: true }),
		rule('fugu-limits', '*fugu*', { ...CONTEXT_1M_LIMITS }),
		rule('fugu-native-vision', '*fugu*', { ...NATIVE_VISION }),
		rule('google-deep-research-tool-calling', '*deep-research-*', {
			toolCalling: true,
		}),
		rule('google-deep-research-limits', '*deep-research-*', { ...CONTEXT_131K_LIMITS }),
		rule('google-deep-research-native-vision', '*deep-research-*', { ...NATIVE_VISION }),
		rule('ling-tool-calling', '*ling-*', { toolCalling: true }),
		rule('ling-limits', '*ling-*', { ...GENERIC_128K_LIMITS }),
		rule('mercury-tool-calling', '*mercury-*', { toolCalling: true }),
		rule('mercury-limits', '*mercury-*', { ...GENERIC_128K_LIMITS }),
		rule('ministral-tool-calling', '*ministral-*', { toolCalling: true }),
		rule('ministral-limits', '*ministral-*', { ...GENERIC_128K_LIMITS }),
		rule('muse-spark-tool-calling', '*muse-spark-*', { toolCalling: true }),
		rule('muse-spark-limits', '*muse-spark-*', { ...CONTEXT_1M_LIMITS }),
		rule('muse-spark-native-vision', '*muse-spark-*', { ...NATIVE_VISION }),
		rule('pixtral-tool-calling', '*pixtral*', { toolCalling: true }),
		rule('north-mini-tool-calling', '*north-mini-*', { toolCalling: true }),
		rule('north-mini-limits', '*north-mini-*', { ...CONTEXT_256K_LIMITS }),
		rule('sakana-tool-calling', '*sakana-*', { toolCalling: true }),
		rule('sakana-limits', '*sakana-*', { ...CONTEXT_256K_LIMITS }),
		rule('sakana-native-vision', '*sakana-*', { ...NATIVE_VISION }),
		rule('sarvam-tool-calling', '*sarvam-*', { toolCalling: true }),
		rule('sarvam-limits', '*sarvam-*', { ...CONTEXT_131K_LIMITS }),
		rule('sarvam-30b-limits', '*sarvam-30b*', { ...CONTEXT_64K_LIMITS }),
		rule('tencent-code-tool-calling', '*tc-code-*', { toolCalling: true }),
		rule('tencent-code-limits', '*tc-code-*', { ...CONTEXT_131K_LIMITS }),
		rule('thinkingmachines-tool-calling', '*thinkingmachines/*', { toolCalling: true }),
		rule('thinkingmachines-limits', '*thinkingmachines/*', { ...CONTEXT_64K_LIMITS }),
		rule('thinkingmachines-peft-limits', '*thinkingmachines/*262144*', {
			...CONTEXT_256K_LIMITS,
		}),
		rule('thinkingmachines-native-vision', '*thinkingmachines/*', { ...NATIVE_VISION }),
		rule('v0-tool-calling', 'v0-*', { toolCalling: true }),
		rule('v0-limits', 'v0-*', { ...GENERIC_128K_LIMITS }),
		rule('v0-1.5-lg-limits', 'v0-1.5-lg*', { ...CONTEXT_524K_LIMITS }),
		rule('v0-native-vision', 'v0-*', { ...NATIVE_VISION }),
		rule('voxtral-tool-calling', '*voxtral-*', { toolCalling: true }),
		rule('voxtral-limits', '*voxtral-*', { ...CONTEXT_32K_LIMITS }),

		// Reasoning rules are appended after capability/context rules. The Codex
		// rules are narrower and therefore intentionally come last.
		...createMainstreamReasoningRules(),
		...createCodexReasoningRules(),
		// Keep non-reasoning chat aliases from inheriting the broad GPT-5
		// reasoning rule above. GPT-5.2 Chat is the documented exception in the
		// current mainstream registry and is restored immediately afterwards.
		rule('openai-gpt-5-chat-no-reasoning-final', '*gpt-5-chat-*', { ...NO_REASONING }),
		rule('openai-gpt-5-decimal-chat-no-reasoning-final', '*gpt-5.*-chat-*', {
			...NO_REASONING,
		}),
		rule('openai-gpt-5.2-chat-reasoning-final', '*gpt-5.2-chat-*', {
			reasoning: { ...OPENAI_REASONING_PROFILE.reasoning },
		}),
		rule('grok-4.20-non-reasoning-final', '*grok-4.20*-non-reasoning*', {
			...NO_REASONING,
		}),
		rule('qwen-character-no-reasoning-final', '*qwen-plus-character*', {
			...NO_REASONING,
		}),
		rule('qwen-plus-character-limits-final', '*qwen-plus-character*', {
			...CONTEXT_32K_LIMITS,
		}),
		rule('qwen-plus-character-ja-limits-final', '*qwen-plus-character-ja*', {
			...CONTEXT_8K_LIMITS,
		}),
		rule('mimo-pro-text-only-final', '*mimo-v2.5-pro*', { ...TEXT_ONLY }),
	];
}
