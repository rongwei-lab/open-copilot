import { finiteNumber, isRecord } from './guards';
import type { NormalizedUsage } from './types';

/** Read a finite number from a possibly nested provider response. */
export function numberAt(value: unknown, ...keys: string[]): number | undefined {
	let current: unknown = value;
	for (const key of keys) {
		if (!isRecord(current)) {
			return undefined;
		}
		current = current[key];
	}
	return finiteNumber(current);
}

/**
 * Normalize Chat Completions and Responses usage shapes into one contract.
 * Unknown/malformed fields become zero; callers can inspect `raw` when they
 * need provider-specific diagnostics.
 */
export function normalizeUsage(raw: unknown): NormalizedUsage {
	const input =
		numberAt(raw, 'input_tokens') ??
		numberAt(raw, 'prompt_tokens') ??
		numberAt(raw, 'inputTokens') ??
		0;
	const output =
		numberAt(raw, 'output_tokens') ??
		numberAt(raw, 'completion_tokens') ??
		numberAt(raw, 'outputTokens') ??
		0;
	const explicitTotal = numberAt(raw, 'total_tokens') ?? numberAt(raw, 'totalTokens') ?? undefined;
	const cached =
		numberAt(raw, 'input_tokens_details', 'cached_tokens') ??
		numberAt(raw, 'prompt_tokens_details', 'cached_tokens') ??
		numberAt(raw, 'prompt_cache_hit_tokens') ??
		numberAt(raw, 'cachedInputTokens') ??
		0;
	const reasoning =
		numberAt(raw, 'output_tokens_details', 'reasoning_tokens') ??
		numberAt(raw, 'completion_tokens_details', 'reasoning_tokens') ??
		numberAt(raw, 'reasoning_tokens') ??
		numberAt(raw, 'reasoningTokens') ??
		0;

	return {
		inputTokens: nonNegative(input),
		outputTokens: nonNegative(output),
		totalTokens: nonNegative(explicitTotal ?? input + output),
		cachedInputTokens: nonNegative(cached),
		reasoningTokens: nonNegative(reasoning),
		raw,
	};
}

function nonNegative(value: number): number {
	return value >= 0 ? value : 0;
}
