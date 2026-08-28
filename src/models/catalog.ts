import { createHash, randomUUID } from 'node:crypto';
import { dirname } from 'node:path';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { NewApiError, redactExactSecret } from '../newapi/errors';
import {
	inferKnownContextWindowTokens,
	mergeModelReasoningMetadata,
	mergeModelVisionMetadata,
	parseModelReasoningMetadata,
	parseModelTokenLimits,
	parseModelVisionMetadata,
} from '../protocols/model-metadata';
import { ProfileResolver, type RemoteModel, type ResolvedModel } from './profile';

// Bumped when an empty catalog could be persisted after protocol resolution
// filtered every remote model, and again when built-in capability rules changed.
// Older records must be refreshed after upgrade instead of being treated as a
// valid, fresh model directory with stale Agent/tool/token-limit metadata. The
// current bump also invalidates the former 128K + 8K unknown-model fallback,
// which made every metadata-less model appear as 136K in VS Code. Bump again
// when built-in capability/context hints change so an installed extension does
// not keep advertising stale Agent/vision/reasoning metadata until the normal
// TTL elapses.
// Bump again when upstream reasoning-effort metadata is added to the resolved
// profile; old records otherwise keep the hard-coded family fallback forever.
// Bump again when an explicitly advertised `none`-only profile must stop
// inheriting invented low/medium/high levels from the unknown-model fallback,
// and when upstream effort maps are persisted in resolved profiles.
// Bump again when the explicit `requestStyle: none` Profile override becomes
// effective instead of being silently discarded during settings conversion.
// Bump again when gateway-only defaults/boolean reasoning declarations stop
// inheriting invented effort levels and optional diagnostics use adapter
// protocol mappings consistently.
// Bump again when the built-in Codex profile adds the xhigh/max effort levels;
// otherwise an installed extension can keep serving a cached four-level schema.
// Bump again when the mainstream model capability matrix is expanded; cached
// records otherwise keep the old conservative context/tool/vision metadata.
// Bump again when the mainstream matrix adds vendor-specific aliases and the
// non-chat filter learns additional generation/realtime model IDs.
// Version 19 also corrects legacy GPT/Mistral/Qwen context aliases and the
// versioned Wan image-generation filter. Version 20 adds long-lived Chinese
// provider aliases and generation-model exclusions.
export const MODEL_CACHE_SCHEMA_VERSION = 20;

export type ModelCatalogErrorCode =
	| 'models_http_error'
	| 'models_timeout'
	| 'models_network_error'
	| 'models_invalid_json'
	| 'invalid_models_body'
	| 'models_business_error'
	| 'invalid_models_data'
	| 'models_cancelled'
	| 'cache_invalid';

export class ModelCatalogError extends Error {
	readonly name = 'ModelCatalogError';

	constructor(
		readonly code: ModelCatalogErrorCode,
		message: string,
		readonly status?: number,
		cause?: unknown,
	) {
		super(message);
		if (cause !== undefined) {
			Object.defineProperty(this, 'cause', {
				configurable: true,
				enumerable: false,
				value: cause,
				writable: false,
			});
		}
	}
}

export interface ModelCacheRecord {
	readonly schemaVersion: number;
	readonly cacheKey: string;
	readonly fetchedAt: number;
	readonly models: readonly ResolvedModel[];
	readonly lastError?: {
		readonly at: number;
		readonly code: string;
		readonly message: string;
	};
}

/** A cache implementation can be backed by VS Code globalState or a file. */
export interface ModelCache {
	readonly key: string;
	load(): Promise<ModelCacheRecord | undefined>;
	save(record: ModelCacheRecord): Promise<void>;
}

/** Minimal client contract used by ModelCatalog; transport stays replaceable. */
export interface ModelListClient {
	listModels(signal?: AbortSignal): Promise<RemoteModel[]>;
}

export interface ModelCatalogGetOptions {
	force?: boolean;
	/** Return an expired cache while a refresh runs. Defaults to true. */
	allowStale?: boolean;
	signal?: AbortSignal;
}

export interface ModelCatalogOptions {
	cache: ModelCache;
	clientFactory: () => ModelListClient;
	resolver: ProfileResolver;
	ttlMs: number;
	/**
	 * Optional background refresh interval. When set, the catalog refreshes
	 * independently of VS Code asking for model information, so a host-side
	 * model-info cache cannot keep a removed/added New API model stale forever.
	 */
	autoRefreshMs?: number;
	now?: () => number;
	onCacheError?: (error: unknown) => void;
	/** Called after each successful remote refresh, including unchanged lists. */
	onRefresh?: (info: {
		readonly remoteCount: number;
		readonly resolvedCount: number;
		readonly fetchedAt: number;
		readonly changed: boolean;
	}) => void;
	/** Called when the gateway returned models but the resolver exposed none. */
	onEmptyResolution?: (info: { remoteCount: number; endpointTypes: readonly string[] }) => void;
}

export interface ModelCatalogDisposable {
	dispose(): void;
}

export type ModelCatalogListener = () => void;

/**
 * Dynamic model catalog with stale-while-revalidate and single-flight refresh.
 * A caller's AbortSignal only cancels that caller's wait when a refresh is
 * already shared; the first caller's signal also aborts the underlying HTTP
 * request. `invalidate` always aborts the active refresh.
 */
export class ModelCatalog {
	private readonly cache: ModelCache;
	private readonly clientFactory: () => ModelListClient;
	private readonly resolver: ProfileResolver;
	private readonly ttlMs: number;
	private readonly autoRefreshMs: number;
	private readonly now: () => number;
	private readonly onCacheError?: (error: unknown) => void;
	private readonly onRefresh?: ModelCatalogOptions['onRefresh'];
	private readonly onEmptyResolution?: ModelCatalogOptions['onEmptyResolution'];
	private readonly listeners = new Set<ModelCatalogListener>();
	private current?: ModelCacheRecord;
	private cacheLoaded = false;
	private cacheLoadFlight?: Promise<void>;
	private inFlight?: InFlightRefresh;
	private generation = 0;
	private autoRefreshTimer?: ReturnType<typeof setInterval>;

	constructor(options: ModelCatalogOptions);
	constructor(
		cache: ModelCache,
		clientFactory: () => ModelListClient,
		resolver: ProfileResolver,
		ttlMs: number,
	);
	constructor(
		optionsOrCache: ModelCatalogOptions | ModelCache,
		legacyClientFactory?: () => ModelListClient,
		legacyResolver?: ProfileResolver,
		legacyTtlMs?: number,
	) {
		const options: ModelCatalogOptions = isCatalogOptions(optionsOrCache)
			? optionsOrCache
			: {
					cache: optionsOrCache,
					clientFactory: legacyClientFactory as () => ModelListClient,
					resolver: legacyResolver as ProfileResolver,
					ttlMs: legacyTtlMs ?? 15 * 60_000,
				};
		if (!Number.isFinite(options.ttlMs) || options.ttlMs < 0) {
			throw new RangeError('ModelCatalog ttlMs must be a non-negative finite number');
		}
		const autoRefreshMs = options.autoRefreshMs ?? 0;
		if (!Number.isFinite(autoRefreshMs) || autoRefreshMs < 0) {
			throw new RangeError('ModelCatalog autoRefreshMs must be a non-negative finite number');
		}
		this.cache = options.cache;
		this.clientFactory = options.clientFactory;
		this.resolver = options.resolver;
		this.ttlMs = options.ttlMs;
		this.autoRefreshMs = autoRefreshMs;
		this.now = options.now ?? Date.now;
		this.onCacheError = options.onCacheError;
		this.onRefresh = options.onRefresh;
		this.onEmptyResolution = options.onEmptyResolution;
		if (this.autoRefreshMs > 0) {
			this.autoRefreshTimer = setInterval(() => {
				// Do not block the extension host or surface an unhandled rejection.
				// A failed refresh keeps the last good catalog in place; the next tick
				// retries automatically.
				void this.refresh({ allowStale: true }).catch((error) => this.reportCacheError(error));
			}, this.autoRefreshMs);
		}
	}

	/** Register a listener compatible with vscode.Event's Disposable shape. */
	onDidChange(listener: ModelCatalogListener): ModelCatalogDisposable {
		this.listeners.add(listener);
		return {
			dispose: () => this.listeners.delete(listener),
		};
	}

	/** Read cache metadata without exposing the cached model objects. */
	getSnapshotInfo(): {
		fetchedAt?: number;
		stale: boolean;
		lastError?: { readonly code: string; readonly message: string };
	} {
		const current = this.current;
		return {
			fetchedAt: current?.fetchedAt,
			stale: current ? !this.isFresh(current) : false,
			lastError: current?.lastError
				? { code: current.lastError.code, message: current.lastError.message }
				: undefined,
		};
	}

	/**
	 * Load a cached list and, when stale, refresh it in the background.  A
	 * force refresh or a cache miss waits for the network result.
	 */
	async getModels(options: ModelCatalogGetOptions = {}): Promise<ResolvedModel[]> {
		if (options.signal?.aborted) {
			throw cancellationError(options.signal.reason);
		}
		// A cancelled picker/request must not wait behind a slow persistent-state
		// read. The read itself is intentionally shared and continues for the next
		// caller; only this caller's wait is cancelled.
		await waitForSignal(this.ensureCacheLoaded(), options.signal);

		const current = this.current;
		// An empty resolved list is not a usable model directory. It can be
		// produced when a gateway returns valid models but an older resolver
		// rejects their advertised protocol. Always retry it after an upgrade or
		// configuration change instead of serving the empty result for the TTL.
		const fresh = current !== undefined && current.models.length > 0 && this.isFresh(current);
		if (!options.force && fresh) {
			return cloneModels(current.models, false);
		}

		if (current && current.models.length > 0 && !options.force && options.allowStale !== false) {
			// Trigger refresh once but do not make model picker startup wait for it.
			// Keep the in-memory view marked stale so a successful background
			// refresh emits a change event even when the model IDs are unchanged.
			this.current = {
				...current,
				models: cloneModels(current.models, true),
			};
			void this.startRefresh(options.signal).catch(() => undefined);
			return cloneModels(this.current.models, true);
		}

		const refresh = this.startRefresh(options.signal);
		return waitForSignal(refresh, options.signal);
	}

	/** Resolve one model by its picker ID or API model ID. */
	async getModel(
		id: string,
		options: ModelCatalogGetOptions = {},
	): Promise<ResolvedModel | undefined> {
		const normalizedId = id.trim();
		if (!normalizedId) return undefined;
		const models = await this.getModels(options);
		return models.find((model) => model.id === normalizedId || model.apiModelId === normalizedId);
	}

	/** Force a network refresh, retaining the previous list if the request fails. */
	refresh(options: Omit<ModelCatalogGetOptions, 'force'> = {}): Promise<ResolvedModel[]> {
		return this.getModels({ ...options, force: true });
	}

	/**
	 * Drop the active view and abort an old request.  The cache record itself is
	 * kept on disk so a future catalog instance can still use it for fallback.
	 */
	invalidate(_reason: 'token' | 'baseUrl' | 'config' | 'manual'): void {
		this.generation += 1;
		this.inFlight?.controller.abort();
		this.inFlight = undefined;
		this.current = undefined;
		this.cacheLoaded = false;
		this.emitChange();
	}

	/** Abort future work and release listeners. */
	dispose(): void {
		this.generation += 1;
		this.inFlight?.controller.abort();
		this.inFlight = undefined;
		if (this.autoRefreshTimer !== undefined) {
			clearInterval(this.autoRefreshTimer);
			this.autoRefreshTimer = undefined;
		}
		this.listeners.clear();
	}

	private async ensureCacheLoaded(): Promise<void> {
		if (this.cacheLoaded) return;
		if (!this.cacheLoadFlight) {
			this.cacheLoadFlight = this.loadCache().finally(() => {
				this.cacheLoadFlight = undefined;
			});
		}
		await this.cacheLoadFlight;
	}

	private async loadCache(): Promise<void> {
		try {
			const record = await this.cache.load();
			if (record && isUsableCacheRecord(record, this.cache.key)) {
				this.current = cloneCacheRecord(record);
			}
		} catch (error) {
			this.reportCacheError(error);
		}
		this.cacheLoaded = true;
	}

	private isFresh(record: ModelCacheRecord): boolean {
		return this.now() - record.fetchedAt < this.ttlMs;
	}

	private startRefresh(signal?: AbortSignal): Promise<ResolvedModel[]> {
		if (this.inFlight) {
			return waitForSignal(this.inFlight.promise, signal);
		}

		const controller = new AbortController();
		const unlink = linkAbortSignal(signal, controller);
		const generation = this.generation;
		const promise = this.refreshRemote(controller.signal, generation)
			.catch(async (error: unknown) => {
				if (isAbortError(error) && signal?.aborted) {
					throw cancellationError(signal.reason);
				}
				const stale = this.current;
				if (stale && stale.cacheKey === this.cache.key) {
					const fallback = withCacheError(stale, error, this.now());
					this.current = fallback;
					if (!modelsEqual(stale.models, fallback.models)) {
						this.emitChange();
					}
					try {
						await this.cache.save(fallback);
					} catch (cacheError) {
						this.reportCacheError(cacheError);
					}
					return cloneModels(fallback.models, true);
				}
				throw normalizeCatalogError(error);
			})
			.finally(() => {
				unlink();
				if (this.inFlight?.promise === promise) {
					this.inFlight = undefined;
				}
			});
		this.inFlight = { promise, controller };
		return promise;
	}

	private async refreshRemote(signal: AbortSignal, generation: number): Promise<ResolvedModel[]> {
		if (signal.aborted) throw cancellationError(signal.reason);
		let remote: RemoteModel[];
		try {
			remote = await this.clientFactory().listModels(signal);
		} catch (error) {
			if (isAbortError(error) || signal.aborted) throw cancellationError(signal.reason);
			throw normalizeCatalogError(error);
		}
		if (generation !== this.generation) {
			throw cancellationError('catalog invalidated');
		}
		const models = this.resolver.resolveAll(remote);
		if (remote.length > 0 && models.length === 0) {
			try {
				this.onEmptyResolution?.({
					remoteCount: remote.length,
					endpointTypes: [
						...new Set(
							remote.flatMap((model) =>
								model.supportedEndpointTypes.map((type) => type.trim()).filter(Boolean),
							),
						),
					],
				});
			} catch {
				// Diagnostics must never prevent a valid refresh from completing.
			}
		}
		const previous = this.current;
		const changed = !previous || !modelsEqual(previous.models, models);
		const record: ModelCacheRecord = {
			schemaVersion: MODEL_CACHE_SCHEMA_VERSION,
			cacheKey: this.cache.key,
			fetchedAt: this.now(),
			models: cloneModels(models, false),
		};
		try {
			await this.cache.save(record);
		} catch (error) {
			// A cache write failure must not discard a valid live response.
			this.reportCacheError(error);
		}
		if (generation !== this.generation) {
			throw cancellationError('catalog invalidated');
		}
		this.current = record;
		if (changed) {
			this.emitChange();
		}
		try {
			this.onRefresh?.({
				remoteCount: remote.length,
				resolvedCount: models.length,
				fetchedAt: record.fetchedAt,
				changed,
			});
		} catch {
			// Observability callbacks must never make a successful refresh fail.
		}
		return cloneModels(record.models, false);
	}

	private reportCacheError(error: unknown): void {
		try {
			this.onCacheError?.(error);
		} catch {
			// Diagnostics callbacks must never break catalog operation.
		}
	}

	private emitChange(): void {
		for (const listener of this.listeners) {
			try {
				listener();
			} catch {
				// One listener must not prevent the others from receiving updates.
			}
		}
	}
}

interface InFlightRefresh {
	promise: Promise<ResolvedModel[]>;
	controller: AbortController;
}

/**
 * Parse a New API `/models` envelope.  HTTP status handling belongs to
 * fetchModelList; this function also rejects a 200 response with
 * `{success:false}` so callers cannot mistake a business error for an empty
 * model list.
 */
export function parseModelListEnvelope(input: unknown): RemoteModel[] {
	if (!isRecord(input)) {
		throw new ModelCatalogError('invalid_models_body', 'New API /models response is not an object');
	}
	if (input.success === false) {
		throw new ModelCatalogError(
			'models_business_error',
			`New API rejected /models: ${safeMessage(input.message ?? input.error)}`,
		);
	}
	if (!Array.isArray(input.data)) {
		throw new ModelCatalogError(
			'invalid_models_data',
			'New API /models response has no data array',
		);
	}

	const byId = new Map<string, RemoteModel>();
	for (const item of input.data) {
		const parsed = parseRemoteModel(item);
		if (!parsed) continue;
		const previous = byId.get(parsed.id);
		if (!previous) {
			byId.set(parsed.id, parsed);
			continue;
		}
		// Duplicate IDs can occur when channels expose the same model.  Union
		// endpoint metadata while retaining the first stable display metadata.
		const endpointTypes = [
			...new Set([...previous.supportedEndpointTypes, ...parsed.supportedEndpointTypes]),
		];
		const unknownTypes = [
			...new Set([
				...(previous.unknownEndpointTypes ?? []),
				...(parsed.unknownEndpointTypes ?? []),
			]),
		];
		byId.set(parsed.id, {
			...previous,
			ownedBy: previous.ownedBy ?? parsed.ownedBy,
			supportedEndpointTypes: endpointTypes,
			unknownEndpointTypes: unknownTypes.length ? unknownTypes : undefined,
			metadataIncomplete: previous.metadataIncomplete || parsed.metadataIncomplete,
			contextWindowTokens: previous.contextWindowTokens ?? parsed.contextWindowTokens,
			maxInputTokens: previous.maxInputTokens ?? parsed.maxInputTokens,
			maxOutputTokens: previous.maxOutputTokens ?? parsed.maxOutputTokens,
			reasoning: mergeModelReasoningMetadata(previous.reasoning, parsed.reasoning),
			vision: mergeModelVisionMetadata(previous.vision, parsed.vision),
		});
	}
	if (byId.size === 0) {
		throw new ModelCatalogError(
			'invalid_models_data',
			'New API /models data contains no valid model IDs',
		);
	}
	return [...byId.values()].map((model) => ({
		...model,
		contextWindowTokens: model.contextWindowTokens ?? inferKnownContextWindowTokens(model.id),
	}));
}

/** Parse and validate one model item; invalid items are ignored by design. */
export function parseRemoteModel(input: unknown): RemoteModel | undefined {
	if (!isRecord(input) || typeof input.id !== 'string') return undefined;
	const id = input.id.trim();
	if (!id || id.length > 256 || hasControlCharacter(id)) return undefined;

	const endpointValue = input.supported_endpoint_types;
	const metadataIncomplete =
		!Array.isArray(endpointValue) ||
		endpointValue.length === 0 ||
		endpointValue.some((value) => typeof value !== 'string');
	const endpointTypes = Array.isArray(endpointValue)
		? [
				...new Set(
					endpointValue
						.filter((value): value is string => typeof value === 'string')
						.map((value) => value.trim())
						.filter(Boolean),
				),
			]
		: [];
	const knownTypes = new Set(['openai', 'openai-response', 'openai-response-compact']);
	const unknownEndpointTypes = endpointTypes.filter((type) => !knownTypes.has(type.toLowerCase()));
	const tokenLimits = parseModelTokenLimits(input);
	const reasoning = parseModelReasoningMetadata(input);
	const vision = parseModelVisionMetadata(input);
	return {
		id,
		object: typeof input.object === 'string' ? input.object : undefined,
		created:
			typeof input.created === 'number' && Number.isFinite(input.created)
				? input.created
				: undefined,
		ownedBy:
			typeof input.owned_by === 'string'
				? input.owned_by.trim() || undefined
				: typeof input.ownedBy === 'string'
					? input.ownedBy.trim() || undefined
					: undefined,
		supportedEndpointTypes: endpointTypes,
		metadataIncomplete,
		unknownEndpointTypes: unknownEndpointTypes.length ? unknownEndpointTypes : undefined,
		contextWindowTokens: tokenLimits.contextWindowTokens,
		maxInputTokens: tokenLimits.maxInputTokens,
		maxOutputTokens: tokenLimits.maxOutputTokens,
		reasoning,
		vision,
		raw: input,
	};
}

export interface FetchModelListOptions {
	signal?: AbortSignal;
	timeoutMs?: number;
	fetchImpl?: FetchLike;
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/** Fetch `/models` with only the headers needed by New API. */
export async function fetchModelList(
	baseUrl: string,
	token: string,
	options: FetchModelListOptions = {},
): Promise<RemoteModel[]> {
	const normalizedToken = token.trim();
	const normalizedBaseUrl = normalizeApiBaseUrl(baseUrl);
	if (!normalizedBaseUrl) {
		throw new ModelCatalogError('models_network_error', 'New API base URL is empty');
	}
	if (!normalizedToken) {
		throw new ModelCatalogError('models_network_error', 'New API token is empty');
	}
	const controller = new AbortController();
	const unlink = linkAbortSignal(options.signal, controller);
	const timeoutMs = options.timeoutMs;
	let timedOut = false;
	const timeout =
		timeoutMs !== undefined && timeoutMs > 0
			? setTimeout(() => {
					timedOut = true;
					controller.abort();
				}, timeoutMs)
			: undefined;
	try {
		const fetchImpl = options.fetchImpl ?? ((input, init) => fetch(input, init));
		let response: Response;
		try {
			response = await fetchImpl(`${normalizedBaseUrl}/models`, {
				method: 'GET',
				headers: {
					Accept: 'application/json',
					Authorization: `Bearer ${normalizedToken}`,
					'Cache-Control': 'no-cache',
					Pragma: 'no-cache',
				},
				signal: controller.signal,
			});
		} catch (error) {
			if (timedOut) {
				throw new ModelCatalogError(
					'models_timeout',
					'New API /models request timed out',
					undefined,
					error,
				);
			}
			if (controller.signal.aborted) {
				throw cancellationError(options.signal?.reason);
			}
			throw new ModelCatalogError(
				'models_network_error',
				'New API /models request failed',
				undefined,
				error,
			);
		}
		if (!response.ok) {
			const message = redactToken(await readResponseMessage(response), normalizedToken);
			throw new ModelCatalogError(
				'models_http_error',
				`New API /models returned HTTP ${response.status}${message ? `: ${message}` : ''}`,
				response.status,
			);
		}
		const contentType = response.headers.get('content-type');
		if (contentType && !/\bjson\b/iu.test(contentType)) {
			throw new ModelCatalogError(
				'models_invalid_json',
				`New API /models returned unexpected content type ${contentType}`,
			);
		}
		let body: unknown;
		try {
			body = await response.json();
		} catch (error) {
			if (options.signal?.aborted) {
				throw cancellationError(options.signal.reason);
			}
			throw new ModelCatalogError(
				'models_invalid_json',
				'New API /models returned invalid JSON',
				undefined,
				error,
			);
		}
		try {
			return parseModelListEnvelope(body);
		} catch (error) {
			// New API may encode an authorization/business failure in a 200
			// envelope. Redact the exact configured token before ModelCatalog stores
			// the diagnostic as a stale-cache error.
			if (error instanceof ModelCatalogError) {
				throw redactCatalogError(error, normalizedToken);
			}
			throw error;
		}
	} finally {
		if (timeout !== undefined) clearTimeout(timeout);
		unlink();
	}
}

/** Adapter that lets ModelCatalog use the built-in fetch implementation. */
export class NewApiModelClient implements ModelListClient {
	constructor(
		private readonly baseUrl: string,
		private readonly token: string,
		private readonly options: Omit<FetchModelListOptions, 'signal'> = {},
	) {}

	listModels(signal?: AbortSignal): Promise<RemoteModel[]> {
		return fetchModelList(this.baseUrl, this.token, { ...this.options, signal });
	}
}

/** In-memory cache is useful for tests and hosts that already persist state. */
export class MemoryModelCache implements ModelCache {
	private record?: ModelCacheRecord;

	constructor(
		readonly key: string,
		initial?: ModelCacheRecord,
	) {
		this.record = initial;
	}

	async load(): Promise<ModelCacheRecord | undefined> {
		return this.record ? cloneCacheRecord(this.record) : undefined;
	}

	async save(record: ModelCacheRecord): Promise<void> {
		this.record = cloneCacheRecord(record);
	}
}

/**
 * Optional file-backed cache.  Writes use a sibling temporary file followed by
 * rename so a process crash cannot leave a half-written JSON record.
 */
export class JsonModelCache implements ModelCache {
	constructor(
		readonly key: string,
		private readonly filePath: string,
	) {}

	async load(): Promise<ModelCacheRecord | undefined> {
		try {
			const text = await readFile(this.filePath, 'utf8');
			const value: unknown = JSON.parse(text);
			return isUsableCacheRecord(value, this.key) ? cloneCacheRecord(value) : undefined;
		} catch (error) {
			if (isNotFoundError(error)) return undefined;
			throw new ModelCatalogError('cache_invalid', 'Unable to read model cache', undefined, error);
		}
	}

	async save(record: ModelCacheRecord): Promise<void> {
		const temporaryPath = `${this.filePath}.${randomUUID()}.tmp`;
		try {
			await mkdir(dirname(this.filePath), { recursive: true });
			await writeFile(temporaryPath, JSON.stringify(record), 'utf8');
			await rename(temporaryPath, this.filePath);
		} catch (error) {
			try {
				await unlink(temporaryPath);
			} catch {
				// Best-effort cleanup; retain the original write error.
			}
			throw new ModelCatalogError('cache_invalid', 'Unable to write model cache', undefined, error);
		}
	}
}

/** Cache key contains no raw token: only a short token hash prefix is used. */
export function createModelCacheKey(baseUrl: string, token: string, variant = ''): string {
	const normalized = normalizeApiBaseUrl(baseUrl);
	const tokenHash = sha256(token.trim()).slice(0, 16);
	const suffix = variant.trim() ? `|${sha256(variant)}` : '';
	return sha256(`${normalized}|${tokenHash}${suffix}`);
}

export function normalizeApiBaseUrl(baseUrl: string): string {
	const trimmed = baseUrl.trim().replace(/\/+$/u, '');
	if (!trimmed) return '';
	try {
		const url = new URL(trimmed);
		url.hash = '';
		url.search = '';
		url.protocol = url.protocol.toLowerCase();
		url.hostname = url.hostname.toLowerCase();
		if (url.pathname === '' || url.pathname === '/') url.pathname = '/v1';
		return url.toString().replace(/\/+$/u, '');
	} catch {
		// Preserve a useful value for a validation error from fetch rather than
		// silently rewriting a malformed user setting.
		return trimmed;
	}
}

function isCatalogOptions(value: ModelCatalogOptions | ModelCache): value is ModelCatalogOptions {
	return 'clientFactory' in value && 'resolver' in value && 'ttlMs' in value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isUsableCacheRecord(value: unknown, expectedKey: string): value is ModelCacheRecord {
	if (!isRecord(value)) return false;
	return (
		value.schemaVersion === MODEL_CACHE_SCHEMA_VERSION &&
		value.cacheKey === expectedKey &&
		typeof value.fetchedAt === 'number' &&
		Number.isFinite(value.fetchedAt) &&
		Array.isArray(value.models) &&
		value.models.every(isResolvedModelRecord)
	);
}

/** Reject corrupted globalState/file cache entries before cloneModels touches them. */
function isResolvedModelRecord(value: unknown): boolean {
	if (!isRecord(value)) return false;
	const capabilities = value.capabilities;
	const reasoning = isRecord(capabilities) ? capabilities.reasoning : undefined;
	const source = value.source;
	return (
		typeof value.id === 'string' &&
		typeof value.apiModelId === 'string' &&
		typeof value.displayName === 'string' &&
		typeof value.family === 'string' &&
		typeof value.version === 'string' &&
		typeof value.maxInputTokens === 'number' &&
		Number.isFinite(value.maxInputTokens) &&
		typeof value.maxOutputTokens === 'number' &&
		Number.isFinite(value.maxOutputTokens) &&
		Array.isArray(value.protocols) &&
		value.protocols.every((item) => item === 'chat-completions' || item === 'responses') &&
		isRecord(capabilities) &&
		typeof capabilities.toolCalling === 'boolean' &&
		typeof capabilities.parallelToolCalls === 'boolean' &&
		isRecord(reasoning) &&
		typeof reasoning.enabled === 'boolean' &&
		Array.isArray(reasoning.efforts) &&
		typeof reasoning.canDisable === 'boolean' &&
		(reasoning.outputStyle === 'summary' ||
			reasoning.outputStyle === 'raw' ||
			reasoning.outputStyle === 'none') &&
		isRecord(source) &&
		Array.isArray(source.endpointTypes) &&
		Array.isArray(source.profileIds) &&
		typeof source.metadataIncomplete === 'boolean' &&
		typeof source.fromStaleCache === 'boolean' &&
		isRecord(value.profile)
	);
}

function cloneCacheRecord(record: ModelCacheRecord): ModelCacheRecord {
	return {
		...record,
		models: cloneModels(
			record.models,
			record.models.some((model) => model.source.fromStaleCache),
		),
		lastError: record.lastError ? { ...record.lastError } : undefined,
	};
}

function cloneModels(models: readonly ResolvedModel[], stale: boolean): ResolvedModel[] {
	return models.map((model) => ({
		...model,
		protocols: [...model.protocols],
		capabilities: {
			...model.capabilities,
			reasoning: {
				...model.capabilities.reasoning,
				efforts: [...model.capabilities.reasoning.efforts],
				effortMap: model.capabilities.reasoning.effortMap
					? { ...model.capabilities.reasoning.effortMap }
					: undefined,
			},
		},
		profile: {
			...model.profile,
			reasoning: model.profile.reasoning
				? {
						...model.profile.reasoning,
						efforts: model.profile.reasoning.efforts
							? [...model.profile.reasoning.efforts]
							: undefined,
						effortMap: model.profile.reasoning.effortMap
							? { ...model.profile.reasoning.effortMap }
							: undefined,
					}
				: undefined,
			extraRequestFields: model.profile.extraRequestFields
				? { ...model.profile.extraRequestFields }
				: undefined,
		},
		source: {
			...model.source,
			endpointTypes: [...model.source.endpointTypes],
			profileIds: [...model.source.profileIds],
			fromStaleCache: stale,
		},
	}));
}

function withCacheError(record: ModelCacheRecord, error: unknown, now: number): ModelCacheRecord {
	const normalized = normalizeCatalogError(error);
	return {
		...record,
		lastError: {
			at: now,
			code: normalized.code,
			message: sanitizeCatalogMessage(normalized.message),
		},
		models: cloneModels(record.models, true),
	};
}

function sanitizeCatalogMessage(value: string): string {
	return value
		.replace(/bearer\s+[a-z0-9._~-]+/giu, 'Bearer <redacted>')
		.replace(/\bsk-[a-z0-9._~-]+/giu, 'sk-<redacted>')
		.replace(/\s+/gu, ' ')
		.trim()
		.slice(0, 512);
}

/** Remove an echoed token even when it does not use a common `sk-` prefix. */
function redactToken(value: string, token: string): string {
	if (!value) return value;
	const exact = redactExactSecret(value, token, '<redacted-token>');
	return exact
		.replace(/bearer\s+[a-z0-9._~-]+/giu, 'Bearer <redacted>')
		.replace(/\bsk-[a-z0-9._~-]+/giu, 'sk-<redacted>');
}

function redactCatalogError(error: ModelCatalogError, token: string): ModelCatalogError {
	const message = redactToken(error.message, token);
	if (message === error.message) return error;
	return new ModelCatalogError(error.code, message, error.status, error);
}

function modelsEqual(a: readonly ResolvedModel[], b: readonly ResolvedModel[]): boolean {
	if (a.length !== b.length) return false;
	return a.every((model, index) => stableModelKey(model) === stableModelKey(b[index]));
}

function stableModelKey(model: ResolvedModel): string {
	return JSON.stringify({
		id: model.id,
		apiModelId: model.apiModelId,
		displayName: model.displayName,
		family: model.family,
		version: model.version,
		maxInputTokens: model.maxInputTokens,
		maxOutputTokens: model.maxOutputTokens,
		protocols: model.protocols,
		selectedProtocol: model.selectedProtocol,
		capabilities: model.capabilities,
		profile: model.profile,
		endpointTypes: model.source.endpointTypes,
		profileIds: model.source.profileIds,
		fromStaleCache: model.source.fromStaleCache,
	});
}

function sha256(value: string): string {
	return createHash('sha256').update(value, 'utf8').digest('hex');
}

function safeMessage(value: unknown): string {
	if (typeof value === 'string') return value.trim().slice(0, 512);
	if (isRecord(value) && typeof value.message === 'string')
		return value.message.trim().slice(0, 512);
	return 'unknown business error';
}

async function readResponseMessage(response: Response): Promise<string> {
	try {
		const contentType = response.headers.get('content-type') ?? '';
		if (/\bjson\b/iu.test(contentType)) {
			const body: unknown = await response.json();
			if (isRecord(body)) return safeMessage(body.message ?? body.error);
			return '';
		}
		if (typeof response.text === 'function') return (await response.text()).trim().slice(0, 512);
	} catch {
		// HTTP status remains the actionable part when the error body is unreadable.
	}
	return '';
}

function normalizeCatalogError(error: unknown): ModelCatalogError {
	if (error instanceof ModelCatalogError) return error;
	if (error instanceof NewApiError) {
		return new ModelCatalogError(mapNewApiErrorCode(error), error.message, error.status, error);
	}
	if (error instanceof Error) {
		return new ModelCatalogError('models_network_error', error.message, undefined, error);
	}
	return new ModelCatalogError('models_network_error', String(error));
}

function mapNewApiErrorCode(error: NewApiError): ModelCatalogErrorCode {
	if (error.code === 'aborted') return 'models_cancelled';
	if (error.code === 'timeout') return 'models_timeout';
	if (error.code === 'invalid_json') return 'models_invalid_json';
	if (error.code === 'invalid_models_body') return 'invalid_models_body';
	if (error.code === 'invalid_models_data') return 'invalid_models_data';
	if (error.code === 'models_business_error') return 'models_business_error';
	if (error.code === 'http') return 'models_http_error';
	return 'models_network_error';
}

function cancellationError(reason: unknown): ModelCatalogError {
	return new ModelCatalogError(
		'models_cancelled',
		reason instanceof Error ? reason.message : 'Model catalog refresh was cancelled',
	);
}

function isAbortError(error: unknown): boolean {
	return (
		(error instanceof ModelCatalogError && error.code === 'models_cancelled') ||
		(error instanceof Error && error.name === 'AbortError')
	);
}

function linkAbortSignal(source: AbortSignal | undefined, target: AbortController): () => void {
	if (!source) return () => undefined;
	const onAbort = (): void => target.abort(source.reason);
	if (source.aborted) {
		onAbort();
		return () => undefined;
	}
	source.addEventListener('abort', onAbort, { once: true });
	return () => source.removeEventListener('abort', onAbort);
}

async function waitForSignal<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
	if (!signal) return promise;
	if (signal.aborted) throw cancellationError(signal.reason);
	return new Promise<T>((resolve, reject) => {
		const onAbort = (): void => {
			signal.removeEventListener('abort', onAbort);
			reject(cancellationError(signal.reason));
		};
		signal.addEventListener('abort', onAbort, { once: true });
		promise.then(
			(value) => {
				signal.removeEventListener('abort', onAbort);
				resolve(value);
			},
			(error: unknown) => {
				signal.removeEventListener('abort', onAbort);
				reject(error);
			},
		);
	});
}

function isNotFoundError(error: unknown): boolean {
	return isRecord(error) && error.code === 'ENOENT';
}

function hasControlCharacter(value: string): boolean {
	for (const character of value) {
		const codePoint = character.codePointAt(0);
		if (codePoint !== undefined && (codePoint < 0x20 || codePoint === 0x7f)) return true;
	}
	return false;
}
