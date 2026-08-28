/**
 * Provider-neutral New API/OpenAI-compatible protocol types.
 *
 * The existing extension has DeepSeek-specific request types.  These types
 * intentionally live in a separate namespace so transport/protocol code can
 * be reused by other providers without making the legacy provider depend on
 * vendor fields.
 */

import type { ModelReasoningMetadata, ModelVisionMetadata } from '../protocols/model-metadata';

export type ApiProtocol = 'chat-completions' | 'responses';

export type StreamUsageMode = 'auto' | 'always' | 'never';

export type ChatRole = 'system' | 'developer' | 'user' | 'assistant' | 'tool';

export interface ChatTextPart {
	type: 'text';
	text: string;
}

export interface ChatImagePart {
	type: 'image_url';
	image_url: {
		url: string;
		detail?: 'auto' | 'low' | 'high';
	};
}

export type ChatContentPart = ChatTextPart | ChatImagePart;
export type ChatContent = string | readonly ChatContentPart[];

export interface ChatToolCall {
	id: string;
	type?: 'function' | string;
	function: {
		name: string;
		arguments: string;
	};
}

export interface ChatMessage {
	role: ChatRole;
	content?: ChatContent | null;
	name?: string;
	toolCallId?: string;
	toolCalls?: readonly ChatToolCall[];
	/** Provider-neutral reasoning history. Adapters may omit it by policy. */
	reasoningContent?: string;
}

export interface ChatTool {
	type: 'function' | string;
	function: {
		name: string;
		description?: string;
		parameters?: Record<string, unknown>;
		strict?: boolean;
	};
}

export type ChatToolChoice = 'none' | 'auto' | 'required' | Record<string, unknown>;

export interface ChatRequestInput {
	model: string;
	messages: readonly ChatMessage[];
	maxTokens?: number;
	temperature?: number;
	topP?: number;
	tools?: readonly ChatTool[];
	toolChoice?: ChatToolChoice;
	parallelToolCalls?: boolean;
	reasoningEffort?: string;
	thinking?: boolean;
	streamUsage?: StreamUsageMode;
	/** Additional OpenAI-compatible fields, intentionally opt-in. */
	extraBody?: Record<string, unknown>;
}

export type MaxTokensField = 'max_tokens' | 'max_completion_tokens';

export interface ChatReasoningProfile {
	/** Which wire field, if any, the upstream model accepts. */
	requestField?: 'reasoning_effort' | 'thinking' | 'none';
	/** How a reasoning delta should be exposed to the host UI. */
	outputStyle?: 'summary' | 'raw' | 'none';
	supportedEfforts?: readonly string[];
	effortMap?: Readonly<Record<string, string>>;
	/** Whether the upstream model supports explicitly disabling reasoning. */
	canDisable?: boolean;
	/** Some vendors (notably DeepSeek) require reasoning history on assistants. */
	includeReasoningContent?: boolean;
	/** Send reasoning_effort alongside a vendor's `thinking` toggle. */
	includeEffortWithThinking?: boolean;
}

export interface ChatModelProfile {
	supportsTools?: boolean;
	supportsParallelTools?: boolean;
	supportsVision?: boolean;
	maxTokensField?: MaxTokensField;
	reasoning?: ChatReasoningProfile;
	streamUsage?: StreamUsageMode;
	strictTools?: boolean;
	/** Provider-specific defaults. Callers may override these per request. */
	extraBody?: Record<string, unknown>;
}

export interface UnifiedToolCall {
	id: string;
	name: string;
	arguments: string;
}

export interface NormalizedUsage {
	inputTokens: number;
	outputTokens: number;
	totalTokens: number;
	cachedInputTokens: number;
	reasoningTokens: number;
	/** Preserve the raw object for diagnostics without requiring consumers to use it. */
	raw?: unknown;
}

export interface CompletionMetadata {
	finishReason?: string;
	responseId?: string;
	model?: string;
}

/** Protocol-neutral sink consumed by the VS Code provider adapter. */
export interface UnifiedStreamSink {
	text(delta: string): void;
	reasoning(delta: string, kind: 'summary' | 'raw'): void;
	toolCall(call: UnifiedToolCall): void;
	usage(usage: NormalizedUsage): void;
	completed(meta?: CompletionMetadata): void;
}

export interface SseEvent {
	/** Explicit SSE event field, if one was sent. */
	event?: string;
	id?: string;
	retry?: number;
	data: string;
	/** JSON parsed data. Undefined for [DONE], empty data, or invalid JSON. */
	json?: unknown;
	jsonParseError?: Error;
	/** JSON.type takes precedence over the SSE event field. */
	type?: string;
	done: boolean;
}

export interface RemoteModel {
	id: string;
	object?: string;
	created?: number;
	ownedBy?: string;
	supportedEndpointTypes: readonly string[];
	metadataIncomplete: boolean;
	/** Optional limits forwarded by an OpenAI-compatible model registry. */
	contextWindowTokens?: number;
	maxInputTokens?: number;
	maxOutputTokens?: number;
	/** Optional reasoning capability metadata forwarded by the gateway. */
	reasoning?: ModelReasoningMetadata;
	/** Optional explicit native image-input metadata forwarded by the gateway. */
	vision?: ModelVisionMetadata;
	/** Original model item, retained for a resolver but never logged by transport. */
	raw?: Readonly<Record<string, unknown>>;
}

export interface NewApiClientOptions {
	/** Timeout for obtaining response headers. Set 0 to disable. */
	timeoutMs?: number;
	/** Whether a server-root URL should be normalized to `/v1`. Defaults true. */
	appendV1ForRoot?: boolean;
	/** Permit a streaming endpoint to return a non-SSE response. */
	allowNonSse?: boolean;
	maxErrorBodyBytes?: number;
	headers?: Record<string, string>;
	fetchImpl?: typeof fetch;
}

export interface StreamRequestOptions {
	allowNonSse?: boolean;
}
