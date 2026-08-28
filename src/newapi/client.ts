import {
	getRequestId,
	NewApiError,
	normalizeNewApiError,
	redactExactSecret,
	truncateBody,
} from './errors';
import { finiteNumber, isRecord, nonEmptyString } from './guards';
import {
	inferKnownContextWindowTokens,
	mergeModelReasoningMetadata,
	mergeModelVisionMetadata,
	parseModelReasoningMetadata,
	parseModelTokenLimits,
	parseModelVisionMetadata,
} from '../protocols/model-metadata';
import type { NewApiClientOptions, RemoteModel, StreamRequestOptions } from './types';

const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_MAX_ERROR_BODY_BYTES = 8 * 1024;

/**
 * Minimal, provider-neutral client for a New API OpenAI-compatible endpoint.
 *
 * `apiBase` may be either a server root (`https://host`) or a versioned root
 * (`https://host/v1`). Paths passed to this class are always relative to that
 * root and are normalized to avoid accidental `//` or missing `/v1` errors.
 */
export class NewApiClient {
	private readonly apiBase: string;
	private readonly token: string;
	private readonly timeoutMs: number;
	private readonly allowNonSse: boolean;
	private readonly maxErrorBodyBytes: number;
	private readonly defaultHeaders: Record<string, string>;
	private readonly fetchImpl: typeof fetch;

	constructor(apiBase: string, token: string, options: NewApiClientOptions = {}) {
		this.apiBase = normalizeApiBase(apiBase, options.appendV1ForRoot !== false);
		this.token = token.trim();
		this.timeoutMs = normalizeTimeout(options.timeoutMs);
		this.allowNonSse = options.allowNonSse === true;
		this.maxErrorBodyBytes = normalizeBodyLimit(options.maxErrorBodyBytes);
		this.defaultHeaders = { ...options.headers };
		this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
		if (typeof this.fetchImpl !== 'function') {
			throw new NewApiError({
				code: 'configuration',
				message: 'The current runtime does not provide fetch',
			});
		}
	}

	get baseUrl(): string {
		return this.apiBase;
	}

	/** Fetch and validate New API's `/v1/models` envelope. */
	async listModels(signal?: AbortSignal): Promise<RemoteModel[]> {
		const response = await this.request('/models', {
			method: 'GET',
			// A force refresh must not be served by an intermediary cache after a
			// model/channel was added in New API.
			headers: {
				Accept: 'application/json',
				'Cache-Control': 'no-cache',
				Pragma: 'no-cache',
			},
			signal,
		});
		let body: unknown;
		try {
			body = await response.json();
		} catch (error) {
			if (signal?.aborted) {
				throw normalizeNewApiError(error, { path: '/models', signal });
			}
			throw new NewApiError({
				code: 'invalid_json',
				message: 'New API returned invalid JSON from /models',
				path: '/models',
				cause: error,
			});
		}
		try {
			return parseModelListEnvelope(body);
		} catch (error) {
			// A gateway can return HTTP 200 with `success:false` and may echo the
			// Authorization token in its business-error message. Keep the pure
			// envelope parser reusable, but redact at the boundary that owns the
			// configured token before the error reaches logs or the model cache.
			if (error instanceof NewApiError) {
				throw redactNewApiError(error, this.token);
			}
			throw error;
		}
	}

	/**
	 * Start a streaming protocol request. The caller owns consumption of the
	 * response body and should pass its cancellation signal to the SSE decoder.
	 */
	async stream(
		path: '/chat/completions' | '/responses',
		body: unknown,
		signal?: AbortSignal,
		options: StreamRequestOptions = {},
	): Promise<Response> {
		const response = await this.request(path, {
			method: 'POST',
			headers: {
				Accept: 'text/event-stream',
				'Content-Type': 'application/json',
			},
			body: JSON.stringify(body),
			signal,
		});
		if (!response.body) {
			throw new NewApiError({
				code: 'empty_stream_body',
				message: 'New API returned an empty streaming response body',
				path,
				status: response.status,
				requestId: getRequestId(response.headers),
			});
		}

		const allowNonSse = options.allowNonSse ?? this.allowNonSse;
		if (!allowNonSse && !isEventStreamContentType(response.headers.get('content-type'))) {
			throw new NewApiError({
				code: 'invalid_content_type',
				message: `Expected text/event-stream from ${path}`,
				path,
				status: response.status,
				requestId: getRequestId(response.headers),
			});
		}
		return response;
	}

	/** Low-level request helper for adapters that need a JSON endpoint. */
	async request(path: string, init: RequestInit): Promise<Response> {
		const normalizedPath = normalizePath(path);
		if (!this.token) {
			throw new NewApiError({
				code: 'configuration',
				message: 'A New API bearer token is required',
				path: normalizedPath,
			});
		}

		const timeoutController = new AbortController();
		let timedOut = false;
		const timer =
			this.timeoutMs > 0
				? setTimeout(() => {
						timedOut = true;
						timeoutController.abort(new Error('request_timeout'));
					}, this.timeoutMs)
				: undefined;
		const callerSignal = init.signal ?? undefined;
		const merged = mergeAbortSignals(callerSignal, timeoutController.signal);
		try {
			const headers = {
				...this.defaultHeaders,
				...toHeaderRecord(init.headers),
			};
			// Authorization is owned by the client token. Remove case variants so
			// Fetch cannot serialize two competing auth headers for a gateway.
			for (const key of Object.keys(headers)) {
				if (key.toLowerCase() === 'authorization') delete headers[key];
			}
			headers.Authorization = `Bearer ${this.token}`;
			const response = await this.fetchImpl(joinUrl(this.apiBase, normalizedPath), {
				...init,
				signal: merged.signal,
				headers,
			});
			if (response.ok) {
				return response;
			}
			const responseBody = redactToken(
				await readResponseBody(response, this.maxErrorBodyBytes),
				this.token,
			);
			throw NewApiError.fromResponse(response, {
				path: normalizedPath,
				body: responseBody,
				maxBodyBytes: this.maxErrorBodyBytes,
			});
		} catch (error) {
			if (error instanceof NewApiError) {
				throw error;
			}
			throw normalizeNewApiError(error, {
				path: normalizedPath,
				timeout: timedOut,
				signal: callerSignal,
			});
		} finally {
			if (timer !== undefined) {
				clearTimeout(timer);
			}
			merged.dispose();
		}
	}
}

export function parseModelListEnvelope(input: unknown): RemoteModel[] {
	if (!isRecord(input)) {
		throw new NewApiError({
			code: 'invalid_models_body',
			message: 'New API /models response is not a JSON object',
			path: '/models',
		});
	}
	if (input.success === false) {
		const message =
			extractMessageFromValue(input.message) ??
			extractMessageFromValue(input.error) ??
			'New API rejected the model list request';
		throw new NewApiError({
			code: 'models_business_error',
			message,
			path: '/models',
		});
	}
	if (!Array.isArray(input.data)) {
		throw new NewApiError({
			code: 'invalid_models_data',
			message: 'New API /models response has no data array',
			path: '/models',
		});
	}

	const modelsById = new Map<string, RemoteModel>();
	for (const item of input.data) {
		const parsed = parseRemoteModel(item);
		if (!parsed) continue;
		const previous = modelsById.get(parsed.id);
		if (!previous) {
			modelsById.set(parsed.id, parsed);
			continue;
		}

		// A model can be exposed by more than one channel.  Merge endpoint
		// metadata instead of letting the last duplicate erase a capability.
		const endpointTypes = [
			...new Set([...previous.supportedEndpointTypes, ...parsed.supportedEndpointTypes]),
		];
		const ownedBy = previous.ownedBy ?? parsed.ownedBy;
		modelsById.set(parsed.id, {
			...previous,
			supportedEndpointTypes: endpointTypes,
			metadataIncomplete: previous.metadataIncomplete || parsed.metadataIncomplete,
			ownedBy,
			contextWindowTokens: previous.contextWindowTokens ?? parsed.contextWindowTokens,
			maxInputTokens: previous.maxInputTokens ?? parsed.maxInputTokens,
			maxOutputTokens: previous.maxOutputTokens ?? parsed.maxOutputTokens,
			reasoning: mergeModelReasoningMetadata(previous.reasoning, parsed.reasoning),
			vision: mergeModelVisionMetadata(previous.vision, parsed.vision),
		});
	}
	if (modelsById.size === 0) {
		throw new NewApiError({
			code: 'invalid_models_data',
			message: 'New API /models data contains no valid model IDs',
			path: '/models',
		});
	}
	return [...modelsById.values()].map((model) => ({
		...model,
		contextWindowTokens: model.contextWindowTokens ?? inferKnownContextWindowTokens(model.id),
	}));
}

export function parseRemoteModel(input: unknown): RemoteModel | undefined {
	if (!isRecord(input) || typeof input.id !== 'string') {
		return undefined;
	}
	const id = input.id.trim();
	if (!id || id.length > 256 || hasControlCharacter(id)) {
		return undefined;
	}
	const rawEndpointTypes = input.supported_endpoint_types;
	const endpointTypes = Array.isArray(rawEndpointTypes)
		? [
				...new Set(
					rawEndpointTypes
						.filter((value): value is string => typeof value === 'string')
						.map((value) => value.trim())
						.filter(Boolean),
				),
			]
		: [];
	const tokenLimits = parseModelTokenLimits(input);
	const reasoning = parseModelReasoningMetadata(input);
	const vision = parseModelVisionMetadata(input);
	return {
		id,
		object: typeof input.object === 'string' ? input.object : undefined,
		created: finiteNumber(input.created),
		ownedBy:
			typeof input.owned_by === 'string'
				? input.owned_by.trim() || undefined
				: typeof input.ownedBy === 'string'
					? input.ownedBy.trim() || undefined
					: undefined,
		supportedEndpointTypes: endpointTypes,
		metadataIncomplete:
			!Array.isArray(rawEndpointTypes) ||
			rawEndpointTypes.length === 0 ||
			rawEndpointTypes.some((value) => typeof value !== 'string') ||
			endpointTypes.length === 0,
		contextWindowTokens: tokenLimits.contextWindowTokens,
		maxInputTokens: tokenLimits.maxInputTokens,
		maxOutputTokens: tokenLimits.maxOutputTokens,
		reasoning,
		vision,
		raw: input,
	};
}

export function normalizeApiBase(value: string, appendV1ForRoot = true): string {
	const trimmed = value.trim();
	if (!trimmed) {
		throw new NewApiError({ code: 'configuration', message: 'New API base URL is empty' });
	}
	let url: URL;
	try {
		url = new URL(trimmed);
	} catch (error) {
		throw new NewApiError({
			code: 'configuration',
			message: 'New API base URL is invalid',
			cause: error,
		});
	}
	if (url.protocol !== 'http:' && url.protocol !== 'https:') {
		throw new NewApiError({
			code: 'configuration',
			message: 'New API base URL must use http or https',
		});
	}
	url.search = '';
	url.hash = '';
	// New API follows the OpenAI-compatible `/v1/*` layout. Accepting a server
	// root here avoids the common misconfiguration where requests go to `/models`
	// instead of `/v1/models`; an explicitly versioned/custom path is retained.
	if (appendV1ForRoot && (url.pathname === '' || url.pathname === '/')) {
		url.pathname = '/v1';
	}
	return url.toString().replace(/\/+$/u, '');
}

export function joinUrl(base: string, path: string): string {
	return `${base.replace(/\/+$/u, '')}/${normalizePath(path).slice(1)}`;
}

export function normalizePath(path: string): string {
	const value = path.trim();
	if (!value || !value.startsWith('/')) {
		return `/${value}`;
	}
	return value;
}

function normalizeTimeout(value: number | undefined): number {
	if (value === undefined) {
		return DEFAULT_TIMEOUT_MS;
	}
	return Number.isFinite(value) && value >= 0 ? Math.floor(value) : DEFAULT_TIMEOUT_MS;
}

function normalizeBodyLimit(value: number | undefined): number {
	return value !== undefined && Number.isFinite(value) && value > 0
		? Math.floor(value)
		: DEFAULT_MAX_ERROR_BODY_BYTES;
}

function isEventStreamContentType(value: string | null): boolean {
	return value?.toLowerCase().split(';', 1)[0].trim() === 'text/event-stream';
}

async function readResponseBody(response: Response, maxBytes: number): Promise<string> {
	try {
		if (!response.body) {
			return '';
		}
		const reader = response.body.getReader();
		const decoder = new TextDecoder();
		let bytes = 0;
		let result = '';
		let truncated = false;
		try {
			while (bytes < maxBytes) {
				const { done, value } = await reader.read();
				if (done) {
					result += decoder.decode();
					break;
				}
				const remaining = maxBytes - bytes;
				const slice = value.byteLength > remaining ? value.slice(0, remaining) : value;
				bytes += slice.byteLength;
				result += decoder.decode(slice, { stream: bytes < maxBytes });
				if (slice.byteLength < value.byteLength) {
					truncated = true;
					await reader.cancel();
					break;
				}
			}
		} finally {
			reader.releaseLock();
		}
		return truncated ? `${truncateBody(result, maxBytes)}…` : truncateBody(result, maxBytes);
	} catch {
		return '';
	}
}

function extractMessageFromValue(value: unknown): string | undefined {
	if (typeof value === 'string' && value.trim()) {
		return value.trim();
	}
	if (isRecord(value)) {
		return nonEmptyString(value.message);
	}
	return undefined;
}

function hasControlCharacter(value: string): boolean {
	for (const character of value) {
		const codePoint = character.codePointAt(0);
		if (codePoint !== undefined && codePoint < 0x20) {
			return true;
		}
	}
	return false;
}

/** Redact the exact configured token even when it uses a non-standard prefix. */
function redactToken(value: string, token: string): string {
	if (!value) return value;
	const exact = redactExactSecret(value, token, '<redacted-token>');
	return exact
		.replace(/bearer\s+[a-z0-9._~-]+/giu, 'Bearer <redacted>')
		.replace(/\bsk-[a-z0-9._~-]+/giu, 'sk-<redacted>');
}

function redactNewApiError(error: NewApiError, token: string): NewApiError {
	const message = redactToken(error.message, token);
	const body = error.responseBody ? redactToken(error.responseBody, token) : undefined;
	if (message === error.message && body === error.responseBody) return error;
	return new NewApiError({
		code: error.code,
		message,
		status: error.status,
		statusText: error.statusText,
		path: error.path,
		requestId: error.requestId,
		retryAfterMs: error.retryAfterMs,
		body,
		cause: error,
	});
}

function toHeaderRecord(
	headers: RequestInit['headers'] | null | undefined,
): Record<string, string> {
	if (!headers) {
		return {};
	}
	if (headers instanceof Headers) {
		return Object.fromEntries(headers.entries());
	}
	if (Array.isArray(headers)) {
		return Object.fromEntries(headers);
	}
	return Object.fromEntries(
		Object.entries(headers).filter(
			(entry): entry is [string, string] => typeof entry[1] === 'string',
		),
	);
}

interface MergedSignal {
	signal: AbortSignal;
	dispose: () => void;
}

function mergeAbortSignals(...signals: (AbortSignal | undefined)[]): MergedSignal {
	const available = signals.filter((signal): signal is AbortSignal => signal !== undefined);
	if (available.length === 0) {
		return { signal: new AbortController().signal, dispose: () => undefined };
	}
	if (available.length === 1) {
		return { signal: available[0], dispose: () => undefined };
	}
	const controller = new AbortController();
	const listeners = new Map<AbortSignal, () => void>();
	const onAbort = (source: AbortSignal): void => {
		if (!controller.signal.aborted) {
			controller.abort(source.reason);
		}
	};
	for (const signal of available) {
		if (signal.aborted) {
			onAbort(signal);
		} else {
			const listener = (): void => onAbort(signal);
			listeners.set(signal, listener);
			signal.addEventListener('abort', listener, { once: true });
		}
	}
	return {
		signal: controller.signal,
		dispose: () => {
			for (const [signal, listener] of listeners) {
				signal.removeEventListener('abort', listener);
			}
			listeners.clear();
		},
	};
}
