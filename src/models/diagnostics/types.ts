import type { ApiProtocol, NormalizedUsage, NewApiClient } from '../../newapi';
import type { ResolvedModel } from '../profile';

/** The checks exposed by the model manager compatibility report. */
export type CompatibilityCheckId =
	| 'chat'
	| 'stream'
	| 'usage'
	| 'tools'
	| 'parallel-tools'
	| 'reasoning'
	| 'responses'
	| 'vision';

export type CompatibilityCheckStatus = 'pass' | 'fail' | 'warn' | 'skip';

/** A JSON-safe result for one probe. Secrets and request bodies are excluded. */
export interface CompatibilityCheckResult {
	readonly id: CompatibilityCheckId;
	readonly status: CompatibilityCheckStatus;
	readonly latencyMs?: number;
	readonly firstTokenMs?: number;
	readonly httpStatus?: number;
	readonly requestId?: string;
	readonly protocol?: ApiProtocol;
	readonly responseModel?: string;
	readonly message?: string;
	readonly details?: Readonly<Record<string, string | number | boolean | undefined>>;
	readonly usage?: NormalizedUsage;
}

export interface CompatibilityDiagnosticReport {
	readonly modelId: string;
	readonly apiModelId: string;
	readonly protocol: ApiProtocol;
	readonly startedAt: number;
	readonly completedAt: number;
	readonly checks: readonly CompatibilityCheckResult[];
	readonly passed: boolean;
	readonly optionalIncluded: boolean;
	readonly visionIncluded: boolean;
}

export interface CompatibilityDiagnosticOptions {
	readonly client: NewApiClient;
	readonly model: ResolvedModel;
	readonly signal?: AbortSignal;
	/** Run reasoning/parallel and protocol-specific optional probes. */
	readonly includeOptional?: boolean;
	/** Send a tiny data URI image. This can consume tokens and must be explicit. */
	readonly includeVision?: boolean;
	readonly timeoutMs?: number;
}
