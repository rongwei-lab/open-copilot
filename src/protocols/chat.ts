import { NewApiClient } from '../newapi/client';
import { NewApiError } from '../newapi/errors';
import { isRecord, stringAt } from '../newapi/guards';
import { decodeSseStream, isSseErrorPayload } from '../newapi/sse';
import { normalizeUsage } from '../newapi/usage';
import { sanitizeExtraBody } from './body';
import type {
	ChatMessage,
	ChatModelProfile,
	ChatRequestInput,
	ChatTool,
	ChatToolCall,
	CompletionMetadata,
	NormalizedUsage,
	StreamUsageMode,
	UnifiedStreamSink,
	UnifiedToolCall,
} from '../newapi/types';

interface PendingToolCall {
	choiceIndex: number;
	toolIndex: number;
	id?: string;
	name: string;
	arguments: string;
	emitted: boolean;
}

interface StreamState {
	pending: Map<string, PendingToolCall>;
	latestUsage?: NormalizedUsage;
	finishReason?: string;
	responseId?: string;
	model?: string;
	reasoningStyle: 'summary' | 'raw' | 'none';
	sawBusinessEvent: boolean;
	completed: boolean;
}

/**
 * OpenAI-compatible Chat Completions adapter.
 *
 * It deliberately accepts provider-neutral messages and emits a unified
 * stream. DeepSeek fields (for example reasoning_content) are only consumed
 * when a profile opts into a reasoning output style.
 */
export class ChatAdapter {
	constructor(
		private readonly client: NewApiClient,
		private readonly profile: ChatModelProfile = {},
	) {}

	buildRequest(input: ChatRequestInput): Record<string, unknown> {
		const model = input.model.trim();
		if (!model) {
			throw new NewApiError({ code: 'configuration', message: 'Chat model id is empty' });
		}
		const messages = input.messages.map((message) => toWireMessage(message, this.profile));
		const body: Record<string, unknown> = {
			...sanitizeExtraBody(this.profile.extraBody),
			...sanitizeExtraBody(input.extraBody),
			model,
			messages,
			stream: true,
		};

		if (input.temperature !== undefined) {
			body.temperature = input.temperature;
		}
		if (input.topP !== undefined) {
			body.top_p = input.topP;
		}
		if (input.maxTokens !== undefined) {
			body[this.profile.maxTokensField ?? 'max_tokens'] = input.maxTokens;
		}

		const tools = getTools(input.tools, this.profile);
		if (tools && tools.length > 0) {
			body.tools = tools.map((tool) => toWireTool(tool, this.profile.strictTools === true));
			if (input.toolChoice !== undefined) {
				body.tool_choice = input.toolChoice;
			}
			if (input.parallelToolCalls === true && this.profile.supportsParallelTools === true) {
				body.parallel_tool_calls = true;
			}
		}

		applyReasoning(body, input, this.profile);
		if (resolveStreamUsage(input.streamUsage, this.profile.streamUsage) !== 'never') {
			body.stream_options = { include_usage: true };
		}
		return body;
	}

	/** Stream one request and complete the sink exactly once on a clean EOF. */
	async stream(
		input: ChatRequestInput,
		sink: UnifiedStreamSink,
		signal?: AbortSignal,
	): Promise<void> {
		const usageMode = resolveStreamUsage(input.streamUsage, this.profile.streamUsage);
		const firstBody = this.buildRequest(input);
		const state = createStreamState(this.profile.reasoning?.outputStyle ?? 'summary');
		try {
			await this.streamOnce(firstBody, state, sink, signal);
		} catch (error) {
			// Some OpenAI-compatible gateways reject stream_options. In auto mode,
			// retry once only before any text/reasoning/tool event was emitted.
			if (
				usageMode === 'auto' &&
				!state.sawBusinessEvent &&
				isUnknownStreamUsageError(error) &&
				!signal?.aborted
			) {
				const retryBody = { ...firstBody };
				delete retryBody.stream_options;
				const retryState = createStreamState(this.profile.reasoning?.outputStyle ?? 'summary');
				await this.streamOnce(retryBody, retryState, sink, signal);
				return;
			}
			throw error;
		}
	}

	/** Compatibility spelling for providers that historically exposed this name. */
	streamChatCompletion(
		input: ChatRequestInput,
		sink: UnifiedStreamSink,
		signal?: AbortSignal,
	): Promise<void> {
		return this.stream(input, sink, signal);
	}

	private async streamOnce(
		body: Record<string, unknown>,
		state: StreamState,
		sink: UnifiedStreamSink,
		signal: AbortSignal | undefined,
	): Promise<void> {
		const response = await this.client.stream('/chat/completions', body, signal);
		if (!response.body) {
			throw new NewApiError({
				code: 'empty_stream_body',
				message: 'Chat Completions response body is empty',
				path: '/chat/completions',
			});
		}

		let sawFrame = false;
		for await (const event of decodeSseStream(response.body, signal)) {
			sawFrame = true;
			if (event.done) {
				flushToolCalls(state, sink);
				complete(state, sink);
				return;
			}
			if (event.jsonParseError) {
				throw new NewApiError({
					code: 'invalid_sse_json',
					message: `Invalid Chat Completions SSE JSON: ${event.jsonParseError.message}`,
					path: '/chat/completions',
					cause: event.jsonParseError,
				});
			}
			if (event.data.trim().length === 0) {
				continue;
			}
			const payload = event.json;
			if (isSseErrorPayload(payload)) {
				throw protocolErrorFromPayload(payload, '/chat/completions');
			}
			processChunk(payload, state, sink);
		}

		if (!sawFrame) {
			throw new NewApiError({
				code: 'empty_stream_body',
				message: 'Chat Completions stream contained no SSE events',
				path: '/chat/completions',
			});
		}
		// EOF without [DONE] is accepted after flushing all complete SSE frames.
		flushToolCalls(state, sink);
		complete(state, sink);
	}
}

function createStreamState(reasoningStyle: 'summary' | 'raw' | 'none'): StreamState {
	return {
		pending: new Map(),
		reasoningStyle,
		sawBusinessEvent: false,
		completed: false,
	};
}

function processChunk(value: unknown, state: StreamState, sink: UnifiedStreamSink): void {
	if (!isRecord(value)) {
		throw new NewApiError({
			code: 'protocol',
			message: 'Chat Completions SSE payload is not an object',
			path: '/chat/completions',
		});
	}
	if (typeof value.id === 'string') {
		state.responseId = value.id;
	}
	if (typeof value.model === 'string') {
		state.model = value.model;
	}
	if (value.usage !== undefined && value.usage !== null) {
		state.latestUsage = normalizeUsage(value.usage);
	}

	if (!Array.isArray(value.choices)) {
		// Usage-only chunks are valid. Other object-shaped metadata is ignored.
		return;
	}
	for (const choiceValue of value.choices) {
		if (!isRecord(choiceValue)) {
			continue;
		}
		const choiceIndex = finiteIndex(choiceValue.index) ?? 0;
		const delta = isRecord(choiceValue.delta) ? choiceValue.delta : undefined;
		if (delta) {
			const content = extractText(delta.content);
			if (content) {
				state.sawBusinessEvent = true;
				sink.text(content);
			}
			const reasoning = extractReasoning(delta, state.reasoningStyle);
			if (reasoning && reasoning.text && reasoning.kind !== 'none') {
				state.sawBusinessEvent = true;
				sink.reasoning(reasoning.text, reasoning.kind);
			}
			const toolCalls = parseToolCallDeltas(delta.tool_calls);
			if (toolCalls.length > 0) {
				state.sawBusinessEvent = true;
				for (const toolCall of toolCalls) {
					appendToolCall(state, choiceIndex, toolCall);
				}
			}
		}
		const finishReason = stringAt(choiceValue, 'finish_reason');
		if (finishReason) {
			state.finishReason = finishReason;
			if (finishReason === 'tool_calls' || finishReason === 'stop' || finishReason === 'length') {
				// A few gateways omit [DONE]; flush at finish as a safe fallback.
				flushToolCalls(state, sink);
			}
		}
	}
}

function appendToolCall(state: StreamState, choiceIndex: number, delta: ToolCallDelta): void {
	const key = `${choiceIndex}:${delta.index}`;
	let pending = state.pending.get(key);
	if (!pending) {
		pending = {
			choiceIndex,
			toolIndex: delta.index,
			name: '',
			arguments: '',
			emitted: false,
		};
		state.pending.set(key, pending);
	}
	if (delta.id) {
		pending.id = delta.id;
	}
	if (delta.name) {
		pending.name += delta.name;
	}
	if (delta.arguments) {
		pending.arguments += delta.arguments;
	}
}

function flushToolCalls(state: StreamState, sink: UnifiedStreamSink): void {
	for (const pending of state.pending.values()) {
		if (pending.emitted) {
			continue;
		}
		if (!pending.id || !pending.name) {
			throw new NewApiError({
				code: 'protocol',
				message: 'Chat tool call is missing id or function name',
				path: '/chat/completions',
			});
		}
		const call: UnifiedToolCall = {
			id: pending.id,
			name: pending.name,
			arguments: pending.arguments,
		};
		pending.emitted = true;
		sink.toolCall(call);
	}
}

function complete(state: StreamState, sink: UnifiedStreamSink): void {
	if (state.completed) {
		return;
	}
	state.completed = true;
	if (state.latestUsage) {
		sink.usage(state.latestUsage);
	}
	const metadata: CompletionMetadata = {
		finishReason: state.finishReason,
		responseId: state.responseId,
		model: state.model,
	};
	sink.completed(metadata);
}

function toWireMessage(message: ChatMessage, profile: ChatModelProfile): Record<string, unknown> {
	if (!isValidRole(message.role)) {
		throw new NewApiError({
			code: 'protocol',
			message: `Unsupported chat message role: ${String(message.role)}`,
		});
	}
	const result: Record<string, unknown> = {
		role: message.role,
		content: message.content ?? null,
	};
	if (message.name) {
		result.name = message.name;
	}
	if (message.toolCallId) {
		result.tool_call_id = message.toolCallId;
	}
	if (message.toolCalls && message.toolCalls.length > 0) {
		result.tool_calls = message.toolCalls.map(toWireToolCall);
	}
	if (message.reasoningContent && profile.reasoning?.includeReasoningContent === true) {
		result.reasoning_content = message.reasoningContent;
	}
	return result;
}

function toWireToolCall(call: ChatToolCall): Record<string, unknown> {
	if (!call.id || !call.function?.name) {
		throw new NewApiError({
			code: 'protocol',
			message: 'Assistant tool call is missing id or function name',
		});
	}
	return {
		id: call.id,
		type: call.type ?? 'function',
		function: {
			name: call.function.name,
			arguments: call.function.arguments ?? '',
		},
	};
}

function getTools(
	tools: readonly ChatTool[] | undefined,
	profile: ChatModelProfile,
): readonly ChatTool[] | undefined {
	if (!tools || tools.length === 0 || profile.supportsTools === false) {
		return undefined;
	}
	return tools;
}

function toWireTool(tool: ChatTool, strict: boolean): Record<string, unknown> {
	const fn: Record<string, unknown> = {
		name: tool.function.name,
		...(tool.function.description ? { description: tool.function.description } : {}),
		...(tool.function.parameters ? { parameters: tool.function.parameters } : {}),
	};
	if (strict || tool.function.strict === true) {
		fn.strict = true;
	}
	return { type: tool.type, function: fn };
}

function applyReasoning(
	body: Record<string, unknown>,
	input: ChatRequestInput,
	profile: ChatModelProfile,
): void {
	const reasoning = profile.reasoning;
	if (!reasoning || reasoning.requestField === 'none') {
		return;
	}
	const effort = normalizeEffort(input.reasoningEffort);
	// `none` is the provider-neutral disable sentinel.  A false thinking toggle
	// carries the same intent for callers that use the boolean form.  Disable
	// wins over a stale/non-matching effort so a helper request cannot
	// accidentally re-enable upstream reasoning.
	const disabled = effort === 'none' || input.thinking === false;
	if (reasoning.requestField === 'reasoning_effort') {
		if (disabled) {
			const mappedDisabled = mapReasoningEffort('none', reasoning);
			if (mappedDisabled) {
				body.reasoning_effort = mappedDisabled;
			}
			return;
		}
		if (effort) {
			const mappedEffort = mapReasoningEffort(effort, reasoning);
			if (mappedEffort) {
				body.reasoning_effort = mappedEffort;
			}
		}
		return;
	}
	if (reasoning.requestField === 'thinking') {
		if (input.thinking !== undefined) {
			body.thinking = { type: input.thinking && !disabled ? 'enabled' : 'disabled' };
		} else if (effort) {
			body.thinking = { type: disabled ? 'disabled' : 'enabled' };
		}
		if (disabled) return;
		const mappedEffort = effort ? mapReasoningEffort(effort, reasoning) : undefined;
		if (
			effort &&
			mappedEffort &&
			reasoning.includeEffortWithThinking === true &&
			isSupportedEffort(effort, mappedEffort, reasoning.supportedEfforts)
		) {
			body.reasoning_effort = mappedEffort;
		}
	}
}

/**
 * Map a UI/canonical effort to the value accepted by the selected gateway.
 * `supportedEfforts` may contain either canonical values or wire values, so
 * validate both sides of an effortMap entry.  The special `none` value is
 * accepted only when the profile explicitly advertises disable support (or
 * supplies a dedicated `effortMap.none` entry).
 */
function mapReasoningEffort(
	effort: string,
	profile: NonNullable<ChatModelProfile['reasoning']>,
): string | undefined {
	const mapped = profile.effortMap?.[effort] ?? effort;
	if (!mapped.trim()) return undefined;
	if (effort === 'none') {
		const hasExplicitDisableMapping = Object.hasOwn(profile.effortMap ?? {}, 'none');
		if (
			profile.canDisable === false ||
			(!hasExplicitDisableMapping &&
				profile.canDisable !== true &&
				profile.supportedEfforts !== undefined &&
				!profile.supportedEfforts.includes('none') &&
				!profile.supportedEfforts.includes(mapped))
		) {
			return undefined;
		}
		return mapped;
	}
	if (isSupportedEffort(effort, mapped, profile.supportedEfforts)) return mapped;
	return undefined;
}

function isSupportedEffort(
	effort: string,
	mapped: string,
	supported: readonly string[] | undefined,
): boolean {
	return !supported || supported.includes(effort) || supported.includes(mapped);
}

function normalizeEffort(value: string | undefined): string | undefined {
	if (typeof value !== 'string') return undefined;
	const normalized = value.trim();
	return normalized || undefined;
}

function resolveStreamUsage(
	requestMode: StreamUsageMode | undefined,
	profileMode: StreamUsageMode | undefined,
): StreamUsageMode {
	return requestMode ?? profileMode ?? 'auto';
}

interface ToolCallDelta {
	index: number;
	id?: string;
	name?: string;
	arguments?: string;
}

function parseToolCallDeltas(value: unknown): ToolCallDelta[] {
	if (!Array.isArray(value)) {
		return [];
	}
	const result: ToolCallDelta[] = [];
	for (const item of value) {
		if (!isRecord(item)) {
			continue;
		}
		const fn = isRecord(item.function) ? item.function : undefined;
		const index = finiteIndex(item.index) ?? result.length;
		result.push({
			index,
			id: typeof item.id === 'string' ? item.id : undefined,
			name: fn && typeof fn.name === 'string' ? fn.name : undefined,
			arguments: fn && typeof fn.arguments === 'string' ? fn.arguments : undefined,
		});
	}
	return result;
}

function extractText(value: unknown): string | undefined {
	if (typeof value === 'string') {
		return value;
	}
	if (!Array.isArray(value)) {
		return undefined;
	}
	let text = '';
	for (const part of value) {
		if (!isRecord(part)) {
			continue;
		}
		if (typeof part.text === 'string') {
			text += part.text;
		} else if (typeof part.content === 'string') {
			text += part.content;
		}
	}
	return text || undefined;
}

function extractReasoning(
	delta: Record<string, unknown>,
	style: 'summary' | 'raw' | 'none',
): { text?: string; kind: 'summary' | 'raw' | 'none' } {
	const value =
		extractText(delta.reasoning_content) ??
		extractText(delta.reasoning) ??
		extractText(delta.thinking);
	if (!value) {
		return { kind: 'none' };
	}
	if (style === 'none') {
		return { kind: 'none' };
	}
	return { text: value, kind: style };
}

function finiteIndex(value: unknown): number | undefined {
	return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

function isValidRole(value: unknown): value is ChatMessage['role'] {
	return (
		value === 'system' ||
		value === 'developer' ||
		value === 'user' ||
		value === 'assistant' ||
		value === 'tool'
	);
}

function isUnknownStreamUsageError(error: unknown): boolean {
	if (!(error instanceof NewApiError) || (error.status !== 400 && error.status !== 422)) {
		return false;
	}
	const text = `${error.message} ${error.responseBody ?? ''}`.toLowerCase();
	return (
		text.includes('stream_options') ||
		text.includes('include_usage') ||
		text.includes('unknown parameter') ||
		text.includes('unrecognized field')
	);
}

function protocolErrorFromPayload(value: Record<string, unknown>, path: string): NewApiError {
	const error = value.error;
	const message =
		typeof error === 'string'
			? error
			: isRecord(error) && typeof error.message === 'string'
				? error.message
				: 'Upstream API returned an error event';
	return new NewApiError({ code: 'upstream_error', message, path });
}
