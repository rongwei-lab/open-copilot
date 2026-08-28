/**
 * Shared types for the DeepSeek Copilot extension.
 */

// ---- API request/response types ----

/** API-level reasoning efforts. Gateways may expose vendor-specific values. */
export type ReasoningEffort = string;

/** Protocol selected for a resolved New API model. */
export type ApiProtocol = 'chat-completions' | 'responses';

export interface DeepSeekTextContentPart {
	type: 'text';
	text: string;
}

export interface DeepSeekImageUrlContentPart {
	type: 'image_url';
	image_url: {
		url: string;
	};
}

export type DeepSeekContentPart = DeepSeekTextContentPart | DeepSeekImageUrlContentPart;

export interface DeepSeekMessage {
	role: 'system' | 'developer' | 'user' | 'assistant' | 'tool';
	content: string | DeepSeekContentPart[];
	tool_call_id?: string;
	tool_calls?: DeepSeekToolCall[];
	reasoning_content?: string;
}

export interface DeepSeekToolCall {
	id: string;
	type: 'function';
	function: {
		name: string;
		arguments: string;
	};
}

export interface DeepSeekTool {
	type: 'function';
	function: {
		name: string;
		description?: string;
		parameters?: Record<string, unknown>;
	};
}

export interface DeepSeekUsage {
	prompt_tokens: number;
	completion_tokens: number;
	total_tokens: number;
	prompt_cache_hit_tokens?: number;
	prompt_cache_miss_tokens?: number;
}

export interface DeepSeekRequest {
	model: string;
	messages: DeepSeekMessage[];
	stream: boolean;
	temperature?: number;
	top_p?: number;
	max_tokens?: number;
	max_completion_tokens?: number;
	tools?: DeepSeekTool[];
	tool_choice?: 'none' | 'auto' | 'required';
	parallel_tool_calls?: boolean;
	thinking?: { type: 'enabled' | 'disabled' };
	reasoning_effort?: ReasoningEffort;
	stream_options?: {
		include_usage: boolean;
	};
	/** Provider-specific OpenAI-compatible fields forwarded by the generic adapter. */
	extraBody?: Record<string, unknown>;
}

export interface DeepSeekStreamChunk {
	id: string;
	object: string;
	created: number;
	model: string;
	choices: Array<{
		index: number;
		delta: {
			role?: string;
			content?: string;
			reasoning_content?: string;
			tool_calls?: Array<{
				index: number;
				id?: string;
				type?: string;
				function?: {
					name?: string;
					arguments?: string;
				};
			}>;
		};
		finish_reason: string | null;
	}>;
	usage?: DeepSeekUsage;
}

// ---- Stream callbacks ----

export interface StreamCallbacks {
	onContent: (content: string) => void;
	onThinking: (text: string) => void;
	onToolCall: (toolCall: DeepSeekToolCall) => void;
	onError: (error: Error) => void;
	onDone: () => void;
	onUsage?: (usage: DeepSeekUsage) => void;
}

// ---- Model definitions ----

export type PricingCurrency = 'USD' | 'CNY';

export type PriceCategory = 'low' | 'medium' | 'high' | 'very_high';

export interface ModelPricing {
	cacheHitInput: number;
	cacheMissInput: number;
	output: number;
}

export interface ThinkingCapability {
	/** Effort values this model implements and may receive in API requests. */
	supportedEfforts: readonly ReasoningEffort[];
	defaultEffort: ReasoningEffort;
	canDisable: boolean;
}

export interface ModelDefinition {
	id: string;
	/** Model ID sent to the gateway; defaults to id. */
	apiModelId?: string;
	name: string;
	family: string;
	version: string;
	detail: string;
	maxInputTokens: number;
	maxOutputTokens: number;
	capabilities: {
		toolCalling: boolean | number;
		parallelToolCalls?: boolean;
		/** Whether the upstream model accepts raw image parts (native input only). */
		imageInput: boolean;
		nativeImageInput?: boolean;
		thinking: ThinkingCapability | false;
	};
	requiresThinkingParam: boolean;
	/** Protocol selected by ProfileResolver. Defaults to Chat for legacy models. */
	protocol?: ApiProtocol;
	allowProtocolFallback?: boolean;
	/** Profile-controlled wire style for reasoning fields. */
	reasoningRequestStyle?: 'chat-reasoning-effort' | 'chat-thinking' | 'responses-object' | 'none';
	reasoningOutputStyle?: 'summary' | 'raw' | 'none';
	imageMode?: 'none' | 'proxy' | 'native';
	supportedEndpointTypes?: readonly string[];
	fromStaleCache?: boolean;
	pricing?: Readonly<Record<PricingCurrency, ModelPricing>>;
	priceCategory?: PriceCategory;
}
