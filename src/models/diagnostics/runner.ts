import { ChatAdapter } from '../../protocols/chat';
import { ResponsesAdapter } from '../../protocols/responses';
import {
	decodeSseStream,
	isRecord,
	isSseErrorPayload,
	normalizeUsage,
	type ChatMessage,
	type ChatTool,
	type NormalizedUsage,
	type UnifiedToolCall,
	NewApiError,
	type ApiProtocol,
	type NewApiClient,
} from '../../newapi';
import { getRequestId, normalizeNewApiError } from '../../newapi/errors';
import type { ResolvedModel } from '../profile';
import { toChatModelProfile, toResponsesModelProfile } from '../model-definition';
import type {
	CompatibilityCheckId,
	CompatibilityCheckResult,
	CompatibilityDiagnosticOptions,
	CompatibilityDiagnosticReport,
} from './types';

const DEFAULT_TIMEOUT_MS = 30_000;
const PROBE_PROMPT = 'Reply with exactly OK.';
const TOOL_PROMPT = 'Call diagnostic_ping exactly once. Do not write any other text.';
// The visual probe must verify that the model actually read image content.
// A text-only acknowledgement is not sufficient: a text-only model can
// return the same fixed token while ignoring the image.  The previous probe
// used a tiny bitmap containing `V7Q2`; several otherwise capable upstream
// models consistently confused the low-resolution Q with 0, producing a
// false warning.  Two large, high-contrast shapes are much less ambiguous for
// the vision encoder and still keep the request bounded.
const VISION_PROMPT =
	'Look at the image. From left to right, report each object’s color and shape using exactly color-shape,color-shape, with no explanation.';
const VISION_EXPECTED_TEXT = 'red-circle,blue-square';
const LEGACY_VISION_EXPECTED_TEXT = 'v7q2';
const PROBE_IMAGE_DATA_URI =
	'data:image/png;base64,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';

interface ProbeContext {
	readonly client: NewApiClient;
	readonly model: ResolvedModel;
	readonly signal?: AbortSignal;
	readonly timeoutMs: number;
}

interface StreamObservation {
	readonly text: string;
	readonly toolCalls: readonly UnifiedToolCall[];
	readonly usage?: NormalizedUsage;
	readonly responseModel?: string;
	readonly firstTokenMs?: number;
	readonly frames: number;
	readonly finishReason?: string;
	readonly httpStatus?: number;
	readonly requestId?: string;
}

interface ResponsesStreamObservation {
	readonly text: string;
	readonly usage?: NormalizedUsage;
	readonly responseModel?: string;
	readonly firstTokenMs?: number;
	readonly frames: number;
	readonly httpStatus?: number;
	readonly requestId?: string;
}

/**
 * Run bounded, provider-neutral compatibility probes for one resolved model.
 *
 * Probes are deliberately sequential and small. No current Copilot messages
 * or real tools are sent; tool probes only ask the model to emit a synthetic
 * function call and never execute it. A failed optional probe does not hide a
 * model that passed the core text/stream checks.
 */
export async function runCompatibilityDiagnostics(
	options: CompatibilityDiagnosticOptions,
): Promise<CompatibilityDiagnosticReport> {
	const startedAt = Date.now();
	const model = options.model;
	const context: ProbeContext = {
		client: options.client,
		model,
		signal: options.signal,
		timeoutMs: normalizeTimeout(options.timeoutMs),
	};
	const checks: CompatibilityCheckResult[] = [];
	ensureNotAborted(options.signal);

	if (model.selectedProtocol === 'responses') {
		const responsesResult = await runResponsesCoreProbe(context);
		checks.push(responsesResult.check);
		checks.push({
			id: 'usage',
			...(responsesResult.check.status === 'pass'
				? usageResult(responsesResult.usage, responsesResult.check.protocol, responsesResult.check)
				: {
						status: 'skip',
						protocol: responsesResult.check.protocol,
						message: 'Usage was not evaluated because the Responses probe failed.',
					}),
		});
		checks.push(await runResponsesStreamProbe(context));
		ensureNotAborted(options.signal);
	} else {
		const chatResult = await runChatProbe(context);
		ensureNotAborted(options.signal);
		checks.push(chatResult.check);
		checks.push({
			id: 'usage',
			...(chatResult.check.status === 'pass'
				? usageResult(chatResult.usage, chatResult.check.protocol, chatResult.check)
				: {
						status: 'skip',
						protocol: chatResult.check.protocol,
						message: 'Usage was not evaluated because the chat probe failed.',
					}),
		});
		checks.push(await runChatStreamProbe(context));
		ensureNotAborted(options.signal);
	}

	// A single synthetic function call is part of the core Agent compatibility
	// check. It is skipped automatically when the profile explicitly disables
	// tools; parallel/reasoning probes remain opt-in because they vary more by
	// provider and consume an additional request each.
	if (model.selectedProtocol === 'chat-completions') {
		checks.push(await runToolProbe(context, false));
		ensureNotAborted(options.signal);
	}

	if (options.includeOptional && model.selectedProtocol === 'chat-completions') {
		checks.push(await runToolProbe(context, true));
		checks.push(await runReasoningProbe(context));
		ensureNotAborted(options.signal);
		checks.push({
			id: 'responses',
			status: 'skip',
			protocol: 'responses',
			message: model.protocols.includes('responses')
				? 'Responses is advertised but not selected for this model.'
				: 'Responses endpoint is not advertised for this model.',
		});
	} else {
		if (model.selectedProtocol === 'responses') {
			checks.push({
				id: 'tools',
				status: 'skip',
				protocol: 'responses',
				message: 'Tool probe for Responses is not enabled yet.',
			});
		}
		checks.push({
			id: 'parallel-tools',
			status: 'skip',
			message: options.includeOptional
				? 'Parallel tool probe is not available for the selected protocol.'
				: 'Optional parallel-tool probe not selected.',
		});
		checks.push(
			options.includeOptional && model.selectedProtocol === 'responses'
				? await runResponsesReasoningProbe(context)
				: {
						id: 'reasoning',
						status: 'skip',
						message: options.includeOptional
							? 'Reasoning probe is not available for the selected protocol.'
							: 'Optional reasoning probe not selected.',
					},
		);
		if (model.selectedProtocol !== 'responses') {
			checks.push({
				id: 'responses',
				status: 'skip',
				protocol: 'responses',
				message: 'Optional protocol probe not selected.',
			});
		}
	}

	if (options.includeVision) {
		checks.push(await runVisionProbe(context));
		ensureNotAborted(options.signal);
	} else {
		checks.push({
			id: 'vision',
			status: 'skip',
			message: 'Vision probe requires explicit confirmation.',
		});
	}

	const completedAt = Date.now();
	return {
		modelId: model.id,
		apiModelId: model.apiModelId,
		protocol: model.selectedProtocol,
		startedAt,
		completedAt,
		checks,
		passed: checks
			.filter((check) => check.status !== 'skip')
			.every((check) => check.status !== 'fail'),
		optionalIncluded: options.includeOptional === true,
		visionIncluded: options.includeVision === true,
	};
}

/**
 * Run only the bounded native-vision probe for background model discovery.
 *
 * The full compatibility report intentionally contains several text/tool
 * requests and is appropriate for an explicit user action. Automatic model
 * discovery needs a single, narrowly scoped image request so adding one model
 * does not unexpectedly multiply upstream traffic.
 */
export async function runVisionCompatibilityProbe(
	options: CompatibilityDiagnosticOptions,
): Promise<CompatibilityCheckResult> {
	const context: ProbeContext = {
		client: options.client,
		model: options.model,
		signal: options.signal,
		timeoutMs: normalizeTimeout(options.timeoutMs),
	};
	ensureNotAborted(options.signal);
	const result = await runVisionProbe(context);
	ensureNotAborted(options.signal);
	return result;
}

interface ChatProbeResult {
	check: CompatibilityCheckResult;
	usage?: NormalizedUsage;
}

async function runChatProbe(context: ProbeContext): Promise<ChatProbeResult> {
	const startedAt = Date.now();
	try {
		const body = buildChatBody(context.model, {
			messages: [{ role: 'user', content: PROBE_PROMPT }],
			stream: false,
		});
		const opened = await openProbeRequest(context, '/chat/completions', body);
		const response = opened.response;
		let responseBody: unknown;
		try {
			responseBody = await readJson(response, '/chat/completions');
		} finally {
			opened.dispose();
		}
		const text = extractChatText(responseBody);
		const usage = extractUsage(responseBody);
		if (!text.trim()) {
			return {
				check: result('chat', 'fail', startedAt, {
					protocol: 'chat-completions',
					httpStatus: response.status,
					requestId: getRequestId(response.headers),
					message: 'Chat response contained no assistant text.',
				}),
				usage,
			};
		}
		return {
			check: result('chat', 'pass', startedAt, {
				protocol: 'chat-completions',
				httpStatus: response.status,
				requestId: getRequestId(response.headers),
				responseModel: getResponseModel(responseBody),
				message: 'Non-streaming chat response is valid.',
				details: { responseChars: text.length },
			}),
			usage,
		};
	} catch (error) {
		return { check: errorResult('chat', startedAt, error, 'chat-completions') };
	}
}

interface ResponsesProbeResult {
	check: CompatibilityCheckResult;
	usage?: NormalizedUsage;
}

async function runResponsesCoreProbe(context: ProbeContext): Promise<ResponsesProbeResult> {
	const startedAt = Date.now();
	try {
		const body = {
			model: context.model.apiModelId,
			input: PROBE_PROMPT,
			max_output_tokens: 4,
			stream: false,
			store: false,
		};
		const opened = await openProbeRequest(context, '/responses', body);
		const response = opened.response;
		let value: unknown;
		try {
			value = await readJson(response, '/responses');
		} finally {
			opened.dispose();
		}
		const text = extractResponsesText(value);
		const usage = extractUsage(value);
		const base = {
			protocol: 'responses' as const,
			httpStatus: response.status,
			requestId: getRequestId(response.headers),
			responseModel: getResponseModel(value),
			usage,
		};
		return {
			check: result('responses', text.trim() ? 'pass' : 'fail', startedAt, {
				...base,
				message: text.trim()
					? 'Responses response is valid.'
					: 'Responses response contained no text.',
				details: { responseChars: text.length },
			}),
			usage,
		};
	} catch (error) {
		return { check: errorResult('responses', startedAt, error, 'responses') };
	}
}

async function runResponsesStreamProbe(context: ProbeContext): Promise<CompatibilityCheckResult> {
	const startedAt = Date.now();
	try {
		const body = {
			model: context.model.apiModelId,
			input: PROBE_PROMPT,
			max_output_tokens: 4,
			stream: true,
			store: false,
		};
		const observation = await readResponsesStream(context, body, startedAt);
		if (!observation.text.trim()) {
			return result('stream', 'fail', startedAt, {
				protocol: 'responses',
				firstTokenMs: observation.firstTokenMs,
				httpStatus: observation.httpStatus,
				requestId: observation.requestId,
				responseModel: observation.responseModel,
				message: 'Responses stream ended without a text delta.',
				details: responsesStreamDetails(observation, startedAt),
			});
		}
		return result('stream', 'pass', startedAt, {
			protocol: 'responses',
			firstTokenMs: observation.firstTokenMs,
			httpStatus: observation.httpStatus,
			requestId: observation.requestId,
			responseModel: observation.responseModel,
			message: 'Responses SSE stream and text deltas are valid.',
			details: responsesStreamDetails(observation, startedAt),
		});
	} catch (error) {
		return errorResult('stream', startedAt, error, 'responses');
	}
}

async function runChatStreamProbe(context: ProbeContext): Promise<CompatibilityCheckResult> {
	const startedAt = Date.now();
	try {
		const body = buildChatBody(context.model, {
			messages: [{ role: 'user', content: PROBE_PROMPT }],
			stream: true,
		});
		const observation = await readChatStream(context, body, startedAt);
		if (!observation.text.trim()) {
			return result('stream', 'fail', startedAt, {
				protocol: 'chat-completions',
				firstTokenMs: observation.firstTokenMs,
				httpStatus: observation.httpStatus,
				requestId: observation.requestId,
				responseModel: observation.responseModel,
				message: 'Stream ended without a text delta.',
				details: streamDetails(observation, startedAt),
			});
		}
		return result('stream', 'pass', startedAt, {
			protocol: 'chat-completions',
			firstTokenMs: observation.firstTokenMs,
			httpStatus: observation.httpStatus,
			requestId: observation.requestId,
			responseModel: observation.responseModel,
			message: 'SSE stream and text deltas are valid.',
			details: streamDetails(observation, startedAt),
		});
	} catch (error) {
		return errorResult('stream', startedAt, error, 'chat-completions');
	}
}

async function runToolProbe(
	context: ProbeContext,
	parallel: boolean,
): Promise<CompatibilityCheckResult> {
	const id: CompatibilityCheckId = parallel ? 'parallel-tools' : 'tools';
	const startedAt = Date.now();
	if (context.model.capabilities.toolCalling === false) {
		return result(id, 'skip', startedAt, {
			message: 'Tool calling is disabled by the model profile.',
		});
	}
	try {
		const tools = [createDiagnosticTool('diagnostic_ping')];
		if (parallel) tools.push(createDiagnosticTool('diagnostic_pong'));
		const body = buildChatBody(context.model, {
			messages: [{ role: 'user', content: TOOL_PROMPT }],
			stream: true,
			tools,
			tool_choice: parallel ? 'required' : forcedToolChoice('diagnostic_ping'),
			...(parallel ? { parallel_tool_calls: true } : {}),
		});
		const observation = await readChatStream(context, body, startedAt);
		const required = parallel ? 2 : 1;
		const validCalls = observation.toolCalls.filter(
			(call) => call.name.startsWith('diagnostic_') && isJsonObjectOrEmpty(call.arguments),
		);
		if (validCalls.length >= required) {
			return result(id, 'pass', startedAt, {
				protocol: 'chat-completions',
				firstTokenMs: observation.firstTokenMs,
				httpStatus: observation.httpStatus,
				requestId: observation.requestId,
				responseModel: observation.responseModel,
				message: parallel
					? 'The model emitted two independent tool calls.'
					: 'The model emitted a valid synthetic tool call.',
				details: {
					...streamDetails(observation, startedAt),
					toolCalls: validCalls.length,
				},
			});
		}
		if (observation.toolCalls.length > 0) {
			return result(id, 'warn', startedAt, {
				protocol: 'chat-completions',
				firstTokenMs: observation.firstTokenMs,
				httpStatus: observation.httpStatus,
				requestId: observation.requestId,
				message: parallel
					? `The request was accepted but only ${validCalls.length} valid tool call(s) were emitted.`
					: 'The request was accepted but the tool-call payload was incomplete.',
				details: {
					...streamDetails(observation, startedAt),
					toolCalls: observation.toolCalls.length,
				},
			});
		}
		return result(id, 'fail', startedAt, {
			protocol: 'chat-completions',
			httpStatus: observation.httpStatus,
			requestId: observation.requestId,
			message: parallel
				? 'No parallel tool calls were emitted.'
				: 'No tool call was emitted after a forced tool choice.',
		});
	} catch (error) {
		return errorResult(id, startedAt, error, 'chat-completions');
	}
}

async function runReasoningProbe(context: ProbeContext): Promise<CompatibilityCheckResult> {
	const startedAt = Date.now();
	const reasoning = context.model.capabilities.reasoning;
	if (
		!reasoning.enabled ||
		!reasoning.requestStyle ||
		reasoning.requestStyle === 'none' ||
		reasoning.requestStyle === 'responses-object'
	) {
		return result('reasoning', 'skip', startedAt, {
			message: 'Reasoning is not enabled in the model profile.',
		});
	}
	try {
		const effort = reasoning.defaultEffort ?? reasoning.efforts[0];
		if (!effort || effort.toLowerCase() === 'none') {
			return result('reasoning', 'skip', startedAt, {
				protocol: 'chat-completions',
				message: 'The profile does not advertise an enabled reasoning effort.',
			});
		}
		const extra: {
			reasoning_effort?: string;
			thinking?: boolean;
		} = {};
		if (reasoning.requestStyle === 'chat-thinking') {
			// Pass provider-neutral fields through buildChatBody so ChatAdapter is
			// the only code that decides whether an effort map is valid alongside
			// a vendor thinking toggle.
			extra.thinking = true;
		}
		const body = buildChatBody(context.model, {
			messages: [{ role: 'user', content: 'What is 2 + 2? Reply with the number 4.' }],
			stream: true,
			reasoning_effort: effort,
			...extra,
		});
		const observation = await readChatStream(context, body, startedAt);
		if (observation.text.includes('4') || observation.firstTokenMs !== undefined) {
			return result('reasoning', 'pass', startedAt, {
				protocol: 'chat-completions',
				firstTokenMs: observation.firstTokenMs,
				httpStatus: observation.httpStatus,
				requestId: observation.requestId,
				message: 'Reasoning request was accepted.',
				details: { reasoningTextObserved: observation.text.length > 0 },
			});
		}
		return result('reasoning', 'warn', startedAt, {
			protocol: 'chat-completions',
			message: 'Request was accepted, but no reasoning/text delta was observed.',
		});
	} catch (error) {
		return errorResult('reasoning', startedAt, error, 'chat-completions');
	}
}

async function runResponsesReasoningProbe(
	context: ProbeContext,
): Promise<CompatibilityCheckResult> {
	const startedAt = Date.now();
	const reasoning = context.model.capabilities.reasoning;
	if (
		!reasoning.enabled ||
		!reasoning.requestStyle ||
		(reasoning.requestStyle !== 'responses-object' &&
			reasoning.requestStyle !== 'chat-reasoning-effort')
	) {
		return result('reasoning', 'skip', startedAt, {
			protocol: 'responses',
			message: 'Responses reasoning is not enabled in the model profile.',
		});
	}
	const effort = reasoning.defaultEffort ?? reasoning.efforts[0];
	if (!effort || effort.toLowerCase() === 'none') {
		return result('reasoning', 'skip', startedAt, {
			protocol: 'responses',
			message: 'The profile does not advertise an enabled reasoning effort.',
		});
	}
	try {
		const body = buildResponsesBody(context.model, {
			messages: [{ role: 'user', content: 'What is 2 + 2? Reply with the number 4.' }],
			stream: true,
			reasoning_effort: effort,
		});
		const observation = await readResponsesStream(context, body, startedAt);
		if (observation.text.includes('4') || observation.firstTokenMs !== undefined) {
			return result('reasoning', 'pass', startedAt, {
				protocol: 'responses',
				firstTokenMs: observation.firstTokenMs,
				httpStatus: observation.httpStatus,
				requestId: observation.requestId,
				message: 'Responses reasoning request was accepted.',
				details: { reasoningTextObserved: observation.text.length > 0 },
			});
		}
		return result('reasoning', 'warn', startedAt, {
			protocol: 'responses',
			httpStatus: observation.httpStatus,
			requestId: observation.requestId,
			message: 'Request was accepted, but no reasoning/text delta was observed.',
		});
	} catch (error) {
		return errorResult('reasoning', startedAt, error, 'responses');
	}
}

async function runVisionProbe(context: ProbeContext): Promise<CompatibilityCheckResult> {
	const startedAt = Date.now();
	if (context.model.selectedProtocol !== 'chat-completions') {
		return result('vision', 'skip', startedAt, {
			protocol: context.model.selectedProtocol,
			message: 'Vision probe currently targets Chat Completions models.',
		});
	}
	if (context.model.capabilities.imageMode === 'none') {
		return result('vision', 'skip', startedAt, { message: 'Vision is disabled for this model.' });
	}
	try {
		const body = buildChatBody(context.model, {
			messages: [
				{
					role: 'user',
					content: [
						{ type: 'text', text: VISION_PROMPT },
						{ type: 'image_url', image_url: { url: PROBE_IMAGE_DATA_URI, detail: 'high' } },
					],
				},
			],
			stream: false,
		});
		// Four output tokens were enough for the old fixed code, but capable
		// models may prepend a short sentence or a reasoning marker. Keep the
		// probe bounded while leaving room for a concise explanatory response.
		const maxTokensField = context.model.profile.maxTokensField ?? 'max_tokens';
		body[maxTokensField] = 32;
		const opened = await openProbeRequest(context, '/chat/completions', body);
		const response = opened.response;
		let value: unknown;
		try {
			value = await readJson(response, '/chat/completions');
		} finally {
			opened.dispose();
		}
		const text = extractChatText(value);
		const verified = matchesVisionProbeAnswer(text);
		return result('vision', verified ? 'pass' : 'warn', startedAt, {
			protocol: 'chat-completions',
			httpStatus: response.status,
			requestId: getRequestId(response.headers),
			responseModel: getResponseModel(value),
			message: verified
				? 'The model read the probe image and returned the expected visual description.'
				: text.trim()
					? 'The image request was accepted, but the probe code could not be verified.'
					: 'The image request was accepted but returned no text.',
			details: {
				visualContentVerified: verified,
				responseChars: text.length,
			},
		});
	} catch (error) {
		return errorResult('vision', startedAt, error, 'chat-completions');
	}
}

function normalizeVisionProbeText(value: string): string {
	return value
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/gu, ' ')
		.trim();
}

/**
 * Accept a concise visual description even when the model adds punctuation or
 * a short sentence. The legacy code is retained as a compatibility fallback
 * for cached test fixtures from pre-0.10.7 builds; arbitrary near-matches such
 * as `V702` are intentionally rejected.
 */
function matchesVisionProbeAnswer(value: string): boolean {
	const normalized = normalizeVisionProbeText(value);
	if (!normalized) return false;
	const expected = normalizeVisionProbeText(VISION_EXPECTED_TEXT);
	if (normalized === expected || normalized.includes(expected)) return true;
	if (normalized === LEGACY_VISION_EXPECTED_TEXT) return true;
	return /\bred\b[\s,-]+(?:circle|round)\b[\s\S]*\bblue\b[\s,-]+square\b/iu.test(value);
}

async function readResponsesStream(
	context: ProbeContext,
	body: Record<string, unknown>,
	startedAt: number,
): Promise<ResponsesStreamObservation> {
	const opened = await openProbeRequest(context, '/responses', body, true);
	const response = opened.response;
	let text = '';
	let usage: NormalizedUsage | undefined;
	let responseModel: string | undefined;
	let firstTokenMs: number | undefined;
	let frames = 0;
	try {
		if (!response.body)
			throw new NewApiError({ code: 'empty_stream_body', message: 'Stream body is empty' });
		for await (const event of decodeSseStream(response.body, opened.signal)) {
			frames += 1;
			if (event.done) break;
			if (event.jsonParseError) {
				throw new NewApiError({
					code: 'invalid_sse_json',
					message: `Invalid Responses SSE JSON: ${event.jsonParseError.message}`,
				});
			}
			if (!event.data.trim()) continue;
			if (isSseErrorPayload(event.json)) {
				throw new NewApiError({ code: 'upstream_error', message: extractErrorMessage(event.json) });
			}
			const payload = event.json;
			if (!isRecord(payload)) continue;
			if (isRecord(payload.response)) {
				if (typeof payload.response.model === 'string') responseModel = payload.response.model;
				if (payload.response.usage !== undefined) usage = normalizeUsage(payload.response.usage);
			}
			if (typeof payload.model === 'string') responseModel = payload.model;
			if (payload.usage !== undefined) usage = normalizeUsage(payload.usage);
			const eventType = event.type ?? (typeof payload.type === 'string' ? payload.type : undefined);
			if (eventType === 'response.output_text.delta' && typeof payload.delta === 'string') {
				text += payload.delta;
				firstTokenMs ??= Date.now() - startedAt;
			}
			if (
				eventType === 'response.completed' ||
				eventType === 'response.done' ||
				eventType === 'response.failed' ||
				eventType === 'response.error'
			) {
				if (eventType === 'response.failed' || eventType === 'response.error') {
					throw new NewApiError({ code: 'upstream_error', message: extractErrorMessage(payload) });
				}
				break;
			}
		}
	} finally {
		opened.dispose();
	}
	return {
		text,
		usage,
		responseModel,
		firstTokenMs,
		frames,
		httpStatus: response.status,
		requestId: getRequestId(response.headers),
	};
}

async function readChatStream(
	context: ProbeContext,
	body: Record<string, unknown>,
	startedAt: number,
): Promise<StreamObservation> {
	const opened = await openProbeRequest(context, '/chat/completions', body, true);
	const response = opened.response;
	let text = '';
	let frames = 0;
	let firstTokenMs: number | undefined;
	let responseModel: string | undefined;
	let usage: NormalizedUsage | undefined;
	let finishReason: string | undefined;
	const toolMap = new Map<string, { id: string; name: string; arguments: string }>();
	try {
		if (!response.body)
			throw new NewApiError({ code: 'empty_stream_body', message: 'Stream body is empty' });
		for await (const event of decodeSseStream(response.body, opened.signal)) {
			frames += 1;
			if (event.done) break;
			if (event.jsonParseError) {
				throw new NewApiError({
					code: 'invalid_sse_json',
					message: `Invalid SSE JSON: ${event.jsonParseError.message}`,
				});
			}
			if (!event.data.trim()) continue;
			if (isSseErrorPayload(event.json)) {
				throw new NewApiError({ code: 'upstream_error', message: extractErrorMessage(event.json) });
			}
			const payload = event.json;
			if (!isRecord(payload)) continue;
			if (typeof payload.model === 'string') responseModel = payload.model;
			if (payload.usage !== undefined) usage = normalizeUsage(payload.usage);
			if (!Array.isArray(payload.choices)) continue;
			for (const choice of payload.choices) {
				if (!isRecord(choice)) continue;
				const delta = isRecord(choice.delta) ? choice.delta : undefined;
				if (delta) {
					const deltaText = extractText(delta.content);
					if (deltaText) {
						text += deltaText;
						firstTokenMs ??= Date.now() - startedAt;
					}
					const reasoning = extractText(
						delta.reasoning_content ?? delta.reasoning ?? delta.thinking,
					);
					if (reasoning) firstTokenMs ??= Date.now() - startedAt;
					if (Array.isArray(delta.tool_calls)) {
						for (const tool of delta.tool_calls) {
							if (!isRecord(tool)) continue;
							const index = String(typeof tool.index === 'number' ? tool.index : 0);
							const fn = isRecord(tool.function) ? tool.function : undefined;
							const current = toolMap.get(index) ?? { id: '', name: '', arguments: '' };
							if (typeof tool.id === 'string') current.id += tool.id;
							if (typeof fn?.name === 'string') current.name += fn.name;
							if (typeof fn?.arguments === 'string') current.arguments += fn.arguments;
							toolMap.set(index, current);
							firstTokenMs ??= Date.now() - startedAt;
						}
					}
				}
				if (typeof choice.finish_reason === 'string') finishReason = choice.finish_reason;
			}
		}
	} finally {
		opened.dispose();
	}
	const toolCalls = [...toolMap.values()]
		.filter((call) => call.id || call.name)
		.map((call) => ({ id: call.id, name: call.name, arguments: call.arguments }));
	return {
		text,
		toolCalls,
		usage,
		responseModel,
		firstTokenMs,
		frames,
		finishReason,
		httpStatus: response.status,
		requestId: getRequestId(response.headers),
	};
}

function streamDetails(
	observation: StreamObservation,
	startedAt: number,
): Record<string, string | number | boolean | undefined> {
	const elapsedMs = Math.max(1, Date.now() - startedAt);
	const details: Record<string, string | number | boolean | undefined> = {
		frames: observation.frames,
		responseChars: observation.text.length,
		usageReported: observation.usage !== undefined,
	};
	if (observation.usage && observation.usage.outputTokens > 0) {
		const generationMs = Math.max(1, elapsedMs - (observation.firstTokenMs ?? 0));
		details.outputTokens = observation.usage.outputTokens;
		details.tokensPerSecond = Number(
			((observation.usage.outputTokens * 1000) / generationMs).toFixed(2),
		);
	}
	return details;
}

function responsesStreamDetails(
	observation: ResponsesStreamObservation,
	startedAt: number,
): Record<string, string | number | boolean | undefined> {
	const elapsedMs = Math.max(1, Date.now() - startedAt);
	const details: Record<string, string | number | boolean | undefined> = {
		frames: observation.frames,
		responseChars: observation.text.length,
		usageReported: observation.usage !== undefined,
	};
	if (observation.usage && observation.usage.outputTokens > 0) {
		const generationMs = Math.max(1, elapsedMs - (observation.firstTokenMs ?? 0));
		details.outputTokens = observation.usage.outputTokens;
		details.tokensPerSecond = Number(
			((observation.usage.outputTokens * 1000) / generationMs).toFixed(2),
		);
	}
	return details;
}

function buildResponsesBody(
	model: ResolvedModel,
	input: {
		messages: readonly ChatMessage[];
		stream: boolean;
		reasoning_effort?: string;
		thinking?: boolean;
	},
): Record<string, unknown> {
	const profile = {
		...toResponsesModelProfile(model, 'never'),
		extraBody: undefined,
		enabled: true,
	};
	const adapter = new ResponsesAdapter(undefined as never, profile);
	const body = adapter.buildRequest({
		model: model.apiModelId,
		messages: input.messages,
		maxTokens: 4,
		streamUsage: 'never',
		reasoningEffort: input.reasoning_effort,
		thinking: input.thinking,
		store: false,
	});
	body.stream = input.stream;
	return body;
}

function buildChatBody(
	model: ResolvedModel,
	input: {
		messages: readonly ChatMessage[];
		stream: boolean;
		tools?: readonly ChatTool[];
		tool_choice?: unknown;
		parallel_tool_calls?: boolean;
		reasoning_effort?: string;
		thinking?: boolean;
		[key: string]: unknown;
	},
): Record<string, unknown> {
	// Keep diagnostics minimal and deterministic. User-defined extra request
	// fields may contain provider-specific data or secrets, so they are not
	// replayed by a probe; the normal chat path still applies them.
	const profile = { ...toChatModelProfile(model, 'never'), extraBody: undefined };
	const adapter = new ChatAdapter(undefined as never, profile);
	// The adapter's body builder is the single source of truth for profile field
	// mappings. It always sets stream=true, so override it for the non-stream
	// compatibility probe after building the otherwise identical payload.
	const body = adapter.buildRequest({
		model: model.apiModelId,
		messages: input.messages,
		maxTokens: 4,
		tools: input.tools,
		toolChoice: input.tool_choice as never,
		parallelToolCalls: input.parallel_tool_calls,
		reasoningEffort: input.reasoning_effort,
		thinking: input.thinking,
		streamUsage: 'never',
		extraBody: Object.fromEntries(
			Object.entries(input).filter(
				([key]) =>
					![
						'messages',
						'stream',
						'tools',
						'tool_choice',
						'parallel_tool_calls',
						'reasoning_effort',
						'thinking',
					].includes(key),
			),
		),
	});
	body.stream = input.stream;
	if (input.tool_choice !== undefined) body.tool_choice = input.tool_choice;
	if (input.parallel_tool_calls !== undefined) body.parallel_tool_calls = input.parallel_tool_calls;
	return body;
}

function createDiagnosticTool(name: string): ChatTool {
	return {
		type: 'function',
		function: {
			name,
			description: 'Compatibility diagnostic only. Never execute this function.',
			parameters: {
				type: 'object',
				properties: {},
				additionalProperties: false,
			},
		},
	};
}

function forcedToolChoice(name: string): Record<string, unknown> {
	return { type: 'function', function: { name } };
}

interface OpenProbeResponse {
	readonly response: Response;
	readonly signal: AbortSignal;
	readonly dispose: () => void;
}

async function openProbeRequest(
	context: ProbeContext,
	path: '/chat/completions' | '/responses',
	body: Record<string, unknown>,
	stream = false,
): Promise<OpenProbeResponse> {
	const controller = new AbortController();
	let timedOut = false;
	const timer = setTimeout(() => {
		timedOut = true;
		controller.abort(new Error('diagnostic_timeout'));
	}, context.timeoutMs);
	let abortParent: (() => void) | undefined;
	if (context.signal) {
		abortParent = () => controller.abort(context.signal?.reason);
		if (context.signal.aborted) abortParent();
		else context.signal.addEventListener('abort', abortParent, { once: true });
	}
	const dispose = (): void => {
		clearTimeout(timer);
		if (context.signal && abortParent) context.signal.removeEventListener('abort', abortParent);
	};
	try {
		const response = stream
			? await context.client.stream(path, body, controller.signal)
			: await context.client.request(path, {
					method: 'POST',
					headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
					body: JSON.stringify(body),
					signal: controller.signal,
				});
		return { response, signal: controller.signal, dispose };
	} catch (error) {
		dispose();
		if (timedOut && !context.signal?.aborted) {
			throw new NewApiError({ code: 'timeout', message: 'Compatibility probe timed out', path });
		}
		throw normalizeNewApiError(error, { path, signal: context.signal });
	}
}

async function readJson(response: Response, path: string): Promise<unknown> {
	const text = await response.text();
	if (text.length > 256 * 1024) {
		throw new NewApiError({
			code: 'invalid_json',
			message: 'Diagnostic response is too large',
			path,
		});
	}
	try {
		return JSON.parse(text);
	} catch (error) {
		throw new NewApiError({
			code: 'invalid_json',
			message: 'Diagnostic response is not valid JSON',
			path,
			cause: error,
		});
	}
}

function result(
	id: CompatibilityCheckId,
	status: CompatibilityCheckResult['status'],
	startedAt: number,
	fields: Omit<CompatibilityCheckResult, 'id' | 'status' | 'latencyMs'>,
): CompatibilityCheckResult {
	return { id, status, latencyMs: Math.max(0, Date.now() - startedAt), ...fields };
}

function errorResult(
	id: CompatibilityCheckId,
	startedAt: number,
	error: unknown,
	protocol: ApiProtocol,
): CompatibilityCheckResult {
	const candidate = error as Partial<NewApiError>;
	return result(id, 'fail', startedAt, {
		protocol,
		httpStatus: typeof candidate.status === 'number' ? candidate.status : undefined,
		requestId: typeof candidate.requestId === 'string' ? candidate.requestId : undefined,
		message: error instanceof Error ? error.message : String(error),
	});
}

function usageResult(
	usage: NormalizedUsage | undefined,
	protocol: ApiProtocol | undefined,
	base: CompatibilityCheckResult,
): Omit<CompatibilityCheckResult, 'id'> {
	if (!usage) {
		return {
			status: 'warn',
			latencyMs: base.latencyMs,
			protocol,
			httpStatus: base.httpStatus,
			requestId: base.requestId,
			message: 'The response was valid but did not include usage.',
		};
	}
	return {
		status: 'pass',
		latencyMs: base.latencyMs,
		protocol,
		httpStatus: base.httpStatus,
		requestId: base.requestId,
		message: 'Usage fields were returned.',
		usage,
	};
}

function extractUsage(value: unknown): NormalizedUsage | undefined {
	if (!isRecord(value) || value.usage === undefined || value.usage === null) return undefined;
	return normalizeUsage(value.usage);
}

function extractChatText(value: unknown): string {
	if (!isRecord(value) || !Array.isArray(value.choices)) return '';
	const first = value.choices[0];
	if (!isRecord(first)) return '';
	const message = isRecord(first.message) ? first.message : undefined;
	return extractText(message?.content);
}

function extractResponsesText(value: unknown): string {
	if (!isRecord(value)) return '';
	if (typeof value.output_text === 'string') return value.output_text;
	if (Array.isArray(value.output)) {
		return value.output
			.map((item) => (isRecord(item) && Array.isArray(item.content) ? item.content : []))
			.flat()
			.map((part) => (isRecord(part) && typeof part.text === 'string' ? part.text : ''))
			.join('');
	}
	return '';
}

function extractText(value: unknown): string {
	if (typeof value === 'string') return value;
	if (!Array.isArray(value)) return '';
	return value
		.map((part) => {
			if (typeof part === 'string') return part;
			if (isRecord(part) && typeof part.text === 'string') return part.text;
			return '';
		})
		.join('');
}

function getResponseModel(value: unknown): string | undefined {
	if (!isRecord(value)) return undefined;
	if (typeof value.model === 'string' && value.model.trim()) return value.model.trim();
	if (isRecord(value.response) && typeof value.response.model === 'string') {
		return value.response.model.trim() || undefined;
	}
	return undefined;
}

function isJsonObjectOrEmpty(value: string): boolean {
	if (!value.trim()) return true;
	try {
		const parsed: unknown = JSON.parse(value);
		return isRecord(parsed);
	} catch {
		return false;
	}
}

function extractErrorMessage(value: unknown): string {
	if (!isRecord(value)) return 'Upstream returned an error payload.';
	const error = value.error;
	if (isRecord(error)) {
		if (typeof error.message === 'string') return error.message;
		return 'Upstream returned an error payload.';
	}
	return 'Upstream returned an error payload.';
}

function normalizeTimeout(value: number | undefined): number {
	return Number.isFinite(value) && value !== undefined && value > 0
		? Math.min(Math.floor(value), 120_000)
		: DEFAULT_TIMEOUT_MS;
}

function ensureNotAborted(signal: AbortSignal | undefined): void {
	if (!signal?.aborted) return;
	throw (
		signal.reason ?? new DOMException('The compatibility diagnostic was cancelled.', 'AbortError')
	);
}
