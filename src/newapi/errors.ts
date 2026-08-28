import { isRecord, nonEmptyString, stringAt } from './guards';

export type NewApiErrorCode =
	| 'configuration'
	| 'http'
	| 'timeout'
	| 'aborted'
	| 'network'
	| 'invalid_json'
	| 'invalid_models_body'
	| 'invalid_models_data'
	| 'models_business_error'
	| 'empty_stream_body'
	| 'invalid_content_type'
	| 'invalid_sse_json'
	| 'protocol'
	| 'upstream_error';

export interface NewApiErrorOptions {
	code: NewApiErrorCode;
	message: string;
	status?: number;
	statusText?: string;
	path?: string;
	requestId?: string;
	retryAfterMs?: number;
	body?: string;
	cause?: unknown;
}

/**
 * Error shared by model discovery and protocol adapters.
 * It deliberately contains no token or request-body fields.
 */
export class NewApiError extends Error {
	readonly code: NewApiErrorCode;
	readonly status?: number;
	readonly statusText?: string;
	readonly path?: string;
	readonly requestId?: string;
	readonly retryAfterMs?: number;
	readonly responseBody?: string;

	constructor(options: NewApiErrorOptions) {
		super(options.message, { cause: options.cause });
		this.name = 'NewApiError';
		this.code = options.code;
		this.status = options.status;
		this.statusText = options.statusText;
		this.path = options.path;
		this.requestId = options.requestId;
		this.retryAfterMs = options.retryAfterMs;
		this.responseBody = options.body;
	}

	static fromResponse(
		response: Response,
		options: { path?: string; body?: string; maxBodyBytes?: number } = {},
	): NewApiError {
		const body = options.body
			? sanitizeSensitiveText(truncateBody(options.body, options.maxBodyBytes))
			: undefined;
		const serverMessage = extractMessage(body);
		const statusText = response.statusText || undefined;
		const requestId = getRequestId(response.headers);
		const retryAfterMs = parseRetryAfter(response.headers.get('retry-after'));
		const detail = serverMessage ? `: ${serverMessage}` : '';
		return new NewApiError({
			code: 'http',
			message: `New API request failed with HTTP ${response.status}${detail}`,
			status: response.status,
			statusText,
			path: options.path,
			requestId,
			retryAfterMs,
			body,
		});
	}
}

export function normalizeNewApiError(
	error: unknown,
	context: { path?: string; timeout?: boolean; signal?: AbortSignal } = {},
): NewApiError {
	if (error instanceof NewApiError) {
		return error;
	}
	if (context.timeout) {
		return new NewApiError({
			code: 'timeout',
			message: 'New API request timed out',
			path: context.path,
			cause: error,
		});
	}
	if (context.signal?.aborted || isAbortLike(error)) {
		return new NewApiError({
			code: 'aborted',
			message: 'New API request was cancelled',
			path: context.path,
			cause: error,
		});
	}
	if (error instanceof Error) {
		return new NewApiError({
			code: 'network',
			message: error.message || 'New API network request failed',
			path: context.path,
			cause: error,
		});
	}
	return new NewApiError({
		code: 'network',
		message: String(error),
		path: context.path,
		cause: error,
	});
}

export function truncateBody(value: string, maxBytes = 8192): string {
	const limit = Number.isFinite(maxBytes) && maxBytes > 0 ? Math.floor(maxBytes) : 8192;
	if (Buffer.byteLength(value, 'utf8') <= limit) {
		return value;
	}
	// Slice by characters, then back off until the UTF-8 representation fits.
	let result = value.slice(0, limit);
	while (result.length > 0 && Buffer.byteLength(result, 'utf8') > limit) {
		result = result.slice(0, -1);
	}
	return `${result}…`;
}

export function extractMessage(body: string | undefined): string | undefined {
	if (!body) {
		return undefined;
	}
	const trimmed = body.trim();
	if (!trimmed) {
		return undefined;
	}
	try {
		const parsed: unknown = JSON.parse(trimmed);
		if (typeof parsed === 'string') {
			return sanitizeSensitiveText(parsed);
		}
		if (isRecord(parsed)) {
			const nested = parsed.error;
			const message =
				nonEmptyString(stringAt(nested, 'message')) ??
				nonEmptyString(stringAt(parsed, 'message')) ??
				(typeof nested === 'string' ? nested : undefined);
			return message ? sanitizeSensitiveText(message) : undefined;
		}
	} catch {
		// Plain-text gateway errors are common; use a bounded one-line summary.
	}
	return sanitizeSensitiveText(trimmed.replace(/\s+/gu, ' ').slice(0, 512));
}

/** Keep upstream error diagnostics useful without persisting echoed secrets. */
function sanitizeSensitiveText(value: string): string {
	return value
		.replace(/bearer\s+[a-z0-9._~-]+/giu, 'Bearer <redacted>')
		.replace(/\bsk-[a-z0-9._~-]+/giu, 'sk-<redacted>');
}

export function getRequestId(headers: Headers): string | undefined {
	return (
		nonEmptyString(headers.get('x-request-id')) ??
		nonEmptyString(headers.get('request-id')) ??
		nonEmptyString(headers.get('cf-ray'))
	);
}

/**
 * Replace an exact secret without corrupting ordinary words that merely
 * contain a short token as a substring (for example, `tok` in `token`).
 * Credentials are usually long random strings, but tests and local gateways
 * often use short values; keeping the boundary check here makes diagnostics
 * both safer and more readable in those environments.
 */
export function redactExactSecret(
	value: string,
	secret: string,
	replacement = '<redacted>',
): string {
	const normalized = secret.trim();
	if (!value || !normalized) return value;
	const startsWord = isSecretWordCharacter(normalized[0]);
	const endsWord = isSecretWordCharacter(normalized[normalized.length - 1]);
	let cursor = 0;
	let result = '';
	while (cursor < value.length) {
		const index = value.indexOf(normalized, cursor);
		if (index < 0) {
			result += value.slice(cursor);
			break;
		}
		const before = index > 0 ? value[index - 1] : undefined;
		const afterIndex = index + normalized.length;
		const after = afterIndex < value.length ? value[afterIndex] : undefined;
		const embedded =
			(startsWord && isSecretWordCharacter(before)) || (endsWord && isSecretWordCharacter(after));
		result += value.slice(cursor, index);
		if (embedded) {
			result += normalized;
		} else {
			result += replacement;
		}
		cursor = afterIndex;
	}
	return result;
}

export function parseRetryAfter(value: string | null): number | undefined {
	if (!value) {
		return undefined;
	}
	const seconds = Number(value);
	if (Number.isFinite(seconds) && seconds >= 0) {
		return Math.round(seconds * 1000);
	}
	const timestamp = Date.parse(value);
	if (!Number.isNaN(timestamp)) {
		return Math.max(0, timestamp - Date.now());
	}
	return undefined;
}

function isAbortLike(error: unknown): boolean {
	return error instanceof Error && error.name === 'AbortError';
}

function isSecretWordCharacter(value: string | undefined): boolean {
	return value !== undefined && /[A-Za-z0-9_-]/u.test(value);
}
