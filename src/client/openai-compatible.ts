import type vscode from 'vscode';
import { NewApiClient } from '../newapi';
import { isOfficialDeepSeekBaseUrl } from '../endpoint';
import { ChatAdapter } from '../protocols/chat';
import { ResponsesAdapter, type ResponsesRequestInput } from '../protocols/responses';
import type {
	ChatMessage,
	ChatModelProfile,
	ChatRequestInput,
	ChatTool,
	NewApiClientOptions,
} from '../newapi';
import type { DeepSeekRequest, DeepSeekToolCall, DeepSeekUsage, StreamCallbacks } from '../types';

/**
 * Compatibility facade used by the existing provider stream layer.
 *
 * The provider still reports DeepSeek-shaped callbacks to preserve replay and
 * diagnostics behavior, while the wire request is handled by the generic
 * NewApiClient + ChatAdapter pair.
 */
export class OpenAICompatibleClient {
	private readonly client: NewApiClient;
	private readonly profile: ChatModelProfile;

	constructor(
		baseUrl: string,
		token: string,
		profile: ChatModelProfile = {},
		options: Pick<NewApiClientOptions, 'timeoutMs' | 'allowNonSse' | 'headers' | 'fetchImpl'> = {},
	) {
		this.client = new NewApiClient(baseUrl, token, {
			...options,
			appendV1ForRoot: !isOfficialDeepSeekBaseUrl(baseUrl),
		});
		this.profile = profile;
	}

	async streamChatCompletion(
		request: DeepSeekRequest,
		callbacks: StreamCallbacks,
		cancellationToken?: vscode.CancellationToken,
	): Promise<void> {
		const controller = new AbortController();
		const cancelListener = cancellationToken?.onCancellationRequested(() => controller.abort());
		if (cancellationToken?.isCancellationRequested) controller.abort();

		const adapter = new ChatAdapter(this.client, this.profile);
		const input = toChatRequestInput(request);
		try {
			await adapter.stream(
				input,
				{
					text: (delta) => callbacks.onContent(delta),
					reasoning: (delta) => callbacks.onThinking(delta),
					toolCall: (call) => callbacks.onToolCall(toDeepSeekToolCall(call)),
					usage: (usage) => callbacks.onUsage?.(toDeepSeekUsage(usage)),
					completed: () => callbacks.onDone(),
				},
				controller.signal,
			);
		} catch (error) {
			if (cancellationToken?.isCancellationRequested || controller.signal.aborted) return;
			// Keep the legacy callback contract: the provider owns user-facing
			// formatting (including action links), while this transport only
			// normalizes non-Error rejection values.
			callbacks.onError(error instanceof Error ? error : new Error(String(error)));
		} finally {
			cancelListener?.dispose();
		}
	}

	/** Stream the experimental Responses protocol through the same callback facade. */
	async streamResponses(
		request: DeepSeekRequest,
		callbacks: StreamCallbacks,
		cancellationToken?: vscode.CancellationToken,
		options: Pick<ResponsesRequestInput, 'store' | 'previousResponseId' | 'truncation'> & {
			allowProtocolFallback?: boolean;
		} = {},
	): Promise<void> {
		const controller = new AbortController();
		const cancelListener = cancellationToken?.onCancellationRequested(() => controller.abort());
		if (cancellationToken?.isCancellationRequested) controller.abort();
		const adapter = new ResponsesAdapter(this.client, {
			...this.profile,
			enabled: true,
		});
		const { allowProtocolFallback, ...responseOptions } = options;
		const input = { ...toChatRequestInput(request), ...responseOptions } as ResponsesRequestInput;
		let sawBusinessEvent = false;
		const sink = {
			text: (delta: string) => {
				if (delta) sawBusinessEvent = true;
				callbacks.onContent(delta);
			},
			reasoning: (delta: string) => {
				if (delta) sawBusinessEvent = true;
				callbacks.onThinking(delta);
			},
			toolCall: (call: { id: string; name: string; arguments: string }) => {
				sawBusinessEvent = true;
				callbacks.onToolCall(toDeepSeekToolCall(call));
			},
			usage: (usage: import('../newapi').NormalizedUsage) =>
				callbacks.onUsage?.(toDeepSeekUsage(usage)),
			completed: () => {
				sawBusinessEvent = true;
				callbacks.onDone();
			},
		};
		try {
			await adapter.stream(input, sink, controller.signal);
		} catch (error) {
			if (cancellationToken?.isCancellationRequested || controller.signal.aborted) return;
			if (allowProtocolFallback === true && !sawBusinessEvent && isProtocolFallbackError(error)) {
				try {
					const chatAdapter = new ChatAdapter(this.client, this.profile);
					await chatAdapter.stream(
						toChatRequestInput(request),
						{
							text: (delta) => callbacks.onContent(delta),
							reasoning: (delta) => callbacks.onThinking(delta),
							toolCall: (call) => callbacks.onToolCall(toDeepSeekToolCall(call)),
							usage: (usage) => callbacks.onUsage?.(toDeepSeekUsage(usage)),
							completed: () => callbacks.onDone(),
						},
						controller.signal,
					);
					return;
				} catch (fallbackError) {
					if (cancellationToken?.isCancellationRequested || controller.signal.aborted) return;
					callbacks.onError(
						fallbackError instanceof Error ? fallbackError : new Error(String(fallbackError)),
					);
					return;
				}
			}
			callbacks.onError(error instanceof Error ? error : new Error(String(error)));
		} finally {
			cancelListener?.dispose();
		}
	}
}

function isProtocolFallbackError(error: unknown): boolean {
	if (!(error instanceof Error)) return false;
	const candidate = error as Error & { status?: number; responseBody?: string; code?: string };
	if (candidate.status === 404 || candidate.status === 405) return true;
	const text = `${candidate.message} ${candidate.responseBody ?? ''}`.toLowerCase();
	return (
		text.includes('endpoint unsupported') ||
		text.includes('unsupported endpoint') ||
		text.includes('responses api is not supported') ||
		text.includes('method not allowed')
	);
}

function toChatRequestInput(request: DeepSeekRequest): ChatRequestInput {
	return {
		model: request.model,
		messages: request.messages.map(toChatMessage),
		maxTokens: request.max_tokens ?? request.max_completion_tokens,
		temperature: request.temperature,
		topP: request.top_p,
		tools: request.tools?.map(toChatTool),
		toolChoice: request.tool_choice,
		parallelToolCalls: request.parallel_tool_calls,
		reasoningEffort: request.reasoning_effort,
		// Preserve an omitted thinking object as `undefined`.  Collapsing it to
		// `false` makes reasoning-effort profiles look explicitly disabled and
		// prevents the protocol adapter from forwarding the selected effort.
		thinking: request.thinking ? request.thinking.type === 'enabled' : undefined,
		streamUsage: request.stream_options
			? request.stream_options.include_usage
				? 'always'
				: 'never'
			: undefined,
		extraBody: request.extraBody,
	};
}

function toChatMessage(message: DeepSeekRequest['messages'][number]): ChatMessage {
	return {
		role: message.role,
		content: message.content,
		name: undefined,
		toolCallId: message.tool_call_id,
		toolCalls: message.tool_calls?.map((call) => ({
			id: call.id,
			type: call.type,
			function: {
				name: call.function.name,
				arguments: call.function.arguments,
			},
		})),
		reasoningContent: message.reasoning_content,
	};
}

function toChatTool(tool: NonNullable<DeepSeekRequest['tools']>[number]): ChatTool {
	return {
		type: tool.type,
		function: {
			name: tool.function.name,
			description: tool.function.description,
			parameters: tool.function.parameters,
		},
	};
}

function toDeepSeekToolCall(call: {
	id: string;
	name: string;
	arguments: string;
}): DeepSeekToolCall {
	return {
		id: call.id,
		type: 'function',
		function: { name: call.name, arguments: call.arguments },
	};
}

function toDeepSeekUsage(usage: import('../newapi').NormalizedUsage): DeepSeekUsage {
	return {
		prompt_tokens: usage.inputTokens,
		completion_tokens: usage.outputTokens,
		total_tokens: usage.totalTokens,
		prompt_cache_hit_tokens: usage.cachedInputTokens,
	};
}
