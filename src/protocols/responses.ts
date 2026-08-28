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
	CompletionMetadata,
	NormalizedUsage,
	UnifiedStreamSink,
	UnifiedToolCall,
} from '../newapi/types';

export interface ResponsesRequestInput extends ChatRequestInput {
	/** Experimental server-side conversation state. Defaults to false/omitted. */
	store?: boolean;
	previousResponseId?: string;
	truncation?: 'auto' | 'disabled';
}

export interface ResponsesModelProfile extends ChatModelProfile {
	enabled?: boolean;
	strictTools?: boolean;
}

interface PendingFunctionCall {
	itemId?: string;
	callId?: string;
	name?: string;
	arguments: string;
	emitted: boolean;
}

interface ResponsesStreamState {
	pending: Map<string, PendingFunctionCall>;
	latestUsage?: NormalizedUsage;
	responseId?: string;
	model?: string;
	completed: boolean;
	sawBusinessEvent: boolean;
}

/**
 * Experimental OpenAI Responses adapter.
 *
 * It is intentionally opt-in (`profile.enabled`) and keeps the same unified
 * sink contract as ChatAdapter. Unknown response event types are ignored so a
 * newer gateway can add informational events without breaking text output.
 */
export class ResponsesAdapter {
	constructor(
		private readonly client: NewApiClient,
		private readonly profile: ResponsesModelProfile = {},
	) {}

	buildRequest(input: ResponsesRequestInput): Record<string, unknown> {
		if (this.profile.enabled !== true) {
			throw new NewApiError({
				code: 'configuration',
				message: 'Responses protocol is disabled for this model profile',
				path: '/responses',
			});
		}
		if (!input.model.trim()) {
			throw new NewApiError({ code: 'configuration', message: 'Responses model id is empty' });
		}

		const instructions: string[] = [];
		const items: Record<string, unknown>[] = [];
		for (const message of input.messages) {
			if (message.role === 'system' || message.role === 'developer') {
				const text = contentAsText(message.content);
				if (text) {
					instructions.push(text);
				}
				continue;
			}
			items.push(...toResponseInputItems(message));
		}

		const body: Record<string, unknown> = {
			...sanitizeExtraBody(this.profile.extraBody),
			...sanitizeExtraBody(input.extraBody),
			model: input.model.trim(),
			input: items,
			stream: true,
			store: input.store ?? false,
		};
		if (instructions.length > 0) {
			body.instructions = instructions.join('\n\n');
		}
		if (input.previousResponseId) {
			body.previous_response_id = input.previousResponseId;
		}
		if (input.truncation) {
			body.truncation = input.truncation;
		}
		if (input.maxTokens !== undefined) {
			body.max_output_tokens = input.maxTokens;
		}
		if (input.temperature !== undefined) {
			body.temperature = input.temperature;
		}
		if (input.topP !== undefined) {
			body.top_p = input.topP;
		}
		const tools = input.tools && this.profile.supportsTools !== false ? input.tools : undefined;
		if (tools && tools.length > 0) {
			body.tools = tools.map((tool) => toResponseTool(tool, this.profile.strictTools === true));
			if (input.toolChoice !== undefined) {
				body.tool_choice = input.toolChoice;
			}
			// Responses exposes the same opt-in parallel tool switch as Chat
			// Completions. Only forward it when the model profile has explicitly
			// confirmed support; sending it to conservative/unknown models can make
			// otherwise valid requests fail at the gateway.
			if (input.parallelToolCalls === true && this.profile.supportsParallelTools === true) {
				body.parallel_tool_calls = true;
			}
		}
		applyResponsesReasoning(body, input, this.profile.reasoning);
		return body;
	}

	async stream(
		input: ResponsesRequestInput,
		sink: UnifiedStreamSink,
		signal?: AbortSignal,
	): Promise<void> {
		const body = this.buildRequest(input);
		const state: ResponsesStreamState = {
			pending: new Map(),
			completed: false,
			sawBusinessEvent: false,
		};
		const response = await this.client.stream('/responses', body, signal);
		if (!response.body) {
			throw new NewApiError({
				code: 'empty_stream_body',
				message: 'Responses response body is empty',
				path: '/responses',
			});
		}

		let sawFrame = false;
		for await (const event of decodeSseStream(response.body, signal)) {
			sawFrame = true;
			if (event.done) {
				flushFunctionCalls(state, sink);
				complete(state, sink);
				return;
			}
			if (event.jsonParseError) {
				throw new NewApiError({
					code: 'invalid_sse_json',
					message: `Invalid Responses SSE JSON: ${event.jsonParseError.message}`,
					path: '/responses',
					cause: event.jsonParseError,
				});
			}
			if (!event.data.trim()) {
				continue;
			}
			const payload = event.json;
			if (isSseErrorPayload(payload)) {
				throw responsesError(payload);
			}
			processResponseEvent(event.type, payload, state, sink, this.profile);
			// `response.completed`/`response.done` are terminal. Some gateways
			// append a transport-level [DONE] or heartbeat afterwards; do not let
			// a late informational/error frame mutate an already completed turn.
			if (state.completed) return;
		}
		if (!sawFrame) {
			throw new NewApiError({
				code: 'empty_stream_body',
				message: 'Responses stream contained no SSE events',
				path: '/responses',
			});
		}
		flushFunctionCalls(state, sink);
		complete(state, sink);
	}

	streamResponses(
		input: ResponsesRequestInput,
		sink: UnifiedStreamSink,
		signal?: AbortSignal,
	): Promise<void> {
		return this.stream(input, sink, signal);
	}
}

/**
 * Encode the provider-neutral reasoning selection in the Responses contract.
 * Unlike Chat Completions, Responses has no separate `thinking` toggle, so a
 * disable request is represented by the upstream effort value (`none` by
 * default, or `effortMap.none` for gateways using another spelling).
 */
function applyResponsesReasoning(
	body: Record<string, unknown>,
	input: ResponsesRequestInput,
	reasoning: ChatModelProfile['reasoning'],
): void {
	if (!reasoning || reasoning.requestField === 'none') return;
	// Responses profiles normally use `reasoning_effort`; accepting the
	// thinking style here as well makes a manually configured profile behave
	// predictably when the gateway exposes one shared adapter contract.
	if (reasoning.requestField !== 'reasoning_effort' && reasoning.requestField !== 'thinking') {
		return;
	}
	const effort = normalizeEffort(input.reasoningEffort);
	const disabled = effort === 'none' || input.thinking === false;
	if (disabled) {
		const mappedDisabled = mapReasoningEffort('none', reasoning);
		if (mappedDisabled) {
			body.reasoning = createReasoningObject(mappedDisabled, true);
		}
		return;
	}
	if (!effort) return;
	const mappedEffort = mapReasoningEffort(effort, reasoning);
	if (mappedEffort) {
		body.reasoning = createReasoningObject(mappedEffort, false);
	}
}

function createReasoningObject(effort: string, disabled: boolean): Record<string, unknown> {
	// A disabled Responses request should not ask the gateway to generate a
	// summary; several OpenAI-compatible implementations reject `summary:auto`
	// together with `effort:none`.
	return disabled ? { effort } : { effort, summary: 'auto' };
}

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
	if (
		!profile.supportedEfforts ||
		profile.supportedEfforts.includes(effort) ||
		profile.supportedEfforts.includes(mapped)
	) {
		return mapped;
	}
	return undefined;
}

function normalizeEffort(value: string | undefined): string | undefined {
	if (typeof value !== 'string') return undefined;
	const normalized = value.trim();
	return normalized || undefined;
}

function processResponseEvent(
	type: string | undefined,
	payload: unknown,
	state: ResponsesStreamState,
	sink: UnifiedStreamSink,
	profile: ResponsesModelProfile,
): void {
	if (!type || !isRecord(payload)) {
		return;
	}
	if (typeof payload.response === 'object' && payload.response !== null) {
		const response = payload.response;
		if (isRecord(response)) {
			if (typeof response.id === 'string') state.responseId = response.id;
			if (typeof response.model === 'string') state.model = response.model;
			if (response.usage !== undefined) state.latestUsage = normalizeUsage(response.usage);
		}
	}
	// Compatible gateways sometimes put metadata at the event root rather
	// than under `response`; accepting both keeps the parser forward-compatible.
	if (typeof payload.id === 'string' && !state.responseId) state.responseId = payload.id;
	if (typeof payload.model === 'string' && !state.model) state.model = payload.model;
	if (payload.usage !== undefined) state.latestUsage = normalizeUsage(payload.usage);

	switch (type) {
		case 'response.output_text.delta': {
			const delta = typeof payload.delta === 'string' ? payload.delta : undefined;
			if (delta) {
				state.sawBusinessEvent = true;
				sink.text(delta);
			}
			return;
		}
		case 'response.reasoning_summary_text.delta':
		case 'response.reasoning_text.delta': {
			const delta = typeof payload.delta === 'string' ? payload.delta : undefined;
			const style = profile.reasoning?.outputStyle ?? 'summary';
			if (delta && style !== 'none') {
				state.sawBusinessEvent = true;
				sink.reasoning(delta, style);
			}
			return;
		}
		case 'response.output_item.added':
		case 'response.output_item.created': {
			const item = isRecord(payload.item) ? payload.item : undefined;
			if (item && item.type === 'function_call') {
				addFunctionCall(state, item);
				state.sawBusinessEvent = true;
			}
			return;
		}
		case 'response.function_call_arguments.delta': {
			const itemId = stringAt(payload, 'item_id');
			if (!itemId || typeof payload.delta !== 'string') {
				throw new NewApiError({
					code: 'protocol',
					message: 'Responses function-call argument delta is missing item_id',
					path: '/responses',
				});
			}
			const pending = state.pending.get(itemId) ?? {
				itemId,
				arguments: '',
				emitted: false,
			};
			pending.arguments += payload.delta;
			state.pending.set(itemId, pending);
			state.sawBusinessEvent = true;
			return;
		}
		case 'response.function_call_arguments.done': {
			const itemId = stringAt(payload, 'item_id');
			if (itemId) {
				const pending = state.pending.get(itemId) ?? {
					itemId,
					arguments: '',
					emitted: false,
				};
				if (typeof payload.arguments === 'string') pending.arguments = payload.arguments;
				if (typeof payload.call_id === 'string') pending.callId = payload.call_id;
				if (typeof payload.name === 'string') pending.name = payload.name;
				state.pending.set(itemId, pending);
				// Some gateways omit output_item.added and provide the name/call_id
				// only on this terminal event. Defer emission until the fields are
				// complete; the stream-end flush will report a real protocol error if
				// they never arrive.
				flushFunctionCall(itemId, state, sink, false);
				state.sawBusinessEvent = true;
			}
			return;
		}
		case 'response.output_item.done': {
			const item = isRecord(payload.item) ? payload.item : undefined;
			if (item?.type === 'function_call') {
				addFunctionCall(state, item);
				const itemId = stringAt(item, 'id') ?? stringAt(item, 'item_id');
				if (itemId) flushFunctionCall(itemId, state, sink, false);
			}
			return;
		}
		case 'response.completed':
		case 'response.done':
			if (isRecord(payload.response)) {
				const usage = payload.response.usage;
				if (usage !== undefined) state.latestUsage = normalizeUsage(usage);
			}
			flushFunctionCalls(state, sink, true);
			complete(state, sink);
			return;
		case 'response.incomplete':
		case 'response.failed':
		case 'response.cancelled':
		case 'response.canceled':
		case 'response.error':
		case 'error':
			throw responsesError(payload);
		default:
			return;
	}
}

function addFunctionCall(state: ResponsesStreamState, item: Record<string, unknown>): void {
	const itemId = stringAt(item, 'id') ?? stringAt(item, 'item_id');
	if (!itemId) {
		throw new NewApiError({
			code: 'protocol',
			message: 'Responses function call is missing item_id',
			path: '/responses',
		});
	}
	const existing = state.pending.get(itemId);
	state.pending.set(itemId, {
		itemId,
		callId: stringAt(item, 'call_id') ?? existing?.callId,
		name: stringAt(item, 'name') ?? existing?.name,
		arguments: typeof item.arguments === 'string' ? item.arguments : (existing?.arguments ?? ''),
		emitted: existing?.emitted ?? false,
	});
}

function flushFunctionCalls(
	state: ResponsesStreamState,
	sink: UnifiedStreamSink,
	strict = true,
): void {
	for (const itemId of state.pending.keys()) {
		flushFunctionCall(itemId, state, sink, strict);
	}
}

function flushFunctionCall(
	itemId: string,
	state: ResponsesStreamState,
	sink: UnifiedStreamSink,
	strict: boolean,
): void {
	const pending = state.pending.get(itemId);
	if (!pending || pending.emitted) return;
	const id = pending.callId ?? pending.itemId;
	if (!id || !pending.name) {
		if (!strict) return;
		throw new NewApiError({
			code: 'protocol',
			message: 'Responses function call is missing call_id or name',
			path: '/responses',
		});
	}
	const call: UnifiedToolCall = { id, name: pending.name, arguments: pending.arguments };
	pending.emitted = true;
	sink.toolCall(call);
}

function complete(state: ResponsesStreamState, sink: UnifiedStreamSink): void {
	if (state.completed) return;
	state.completed = true;
	if (state.latestUsage) sink.usage(state.latestUsage);
	const metadata: CompletionMetadata = {
		responseId: state.responseId,
		model: state.model,
	};
	sink.completed(metadata);
}

function toResponseInputItems(message: ChatMessage): Record<string, unknown>[] {
	if (message.role === 'tool') {
		if (!message.toolCallId) {
			throw new NewApiError({
				code: 'protocol',
				message: 'Responses tool result is missing toolCallId',
				path: '/responses',
			});
		}
		return [
			{
				type: 'function_call_output',
				call_id: message.toolCallId,
				output: contentAsText(message.content),
			},
		];
	}
	const content = message.content;
	const parts =
		typeof content === 'string'
			? [{ type: message.role === 'assistant' ? 'output_text' : 'input_text', text: content }]
			: (content ?? []).map((part) =>
					part.type === 'text'
						? {
								type: message.role === 'assistant' ? 'output_text' : 'input_text',
								text: part.text,
							}
						: { type: 'input_image', image_url: part.image_url.url },
				);
	const items: Record<string, unknown>[] = [];
	if (parts.length > 0) {
		items.push({ type: 'message', role: message.role, content: parts });
	}
	if (message.role === 'assistant' && message.toolCalls) {
		for (const call of message.toolCalls) {
			if (!call.id || !call.function?.name) {
				throw new NewApiError({
					code: 'protocol',
					message: 'Responses assistant function call is missing id or name',
					path: '/responses',
				});
			}
			items.push({
				type: 'function_call',
				id: call.id,
				call_id: call.id,
				name: call.function.name,
				arguments: call.function.arguments ?? '',
			});
		}
	}
	return items;
}

function toResponseTool(tool: ChatTool, strict: boolean): Record<string, unknown> {
	return {
		type: 'function',
		name: tool.function.name,
		description: tool.function.description,
		parameters: tool.function.parameters ?? {},
		...(strict || tool.function.strict === true ? { strict: true } : {}),
	};
}

function contentAsText(content: ChatMessage['content']): string {
	if (typeof content === 'string') return content;
	if (!content) return '';
	return content
		.map((part) => (part.type === 'text' ? part.text : `[image: ${part.image_url.url}]`))
		.join('\n');
}

function responsesError(payload: Record<string, unknown>): NewApiError {
	const error = payload.error ?? (isRecord(payload.response) ? payload.response.error : undefined);
	const message =
		typeof error === 'string'
			? error
			: isRecord(error) && typeof error.message === 'string'
				? error.message
				: typeof payload.message === 'string'
					? payload.message
					: isRecord(payload.response) && typeof payload.response.status === 'string'
						? `Responses request ended with status ${payload.response.status}`
						: 'Responses API returned an error event';
	return new NewApiError({ code: 'upstream_error', message, path: '/responses' });
}
