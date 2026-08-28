/** Small runtime guards shared by the transport and protocol adapters. */

export function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function stringAt(value: unknown, key: string): string | undefined {
	if (!isRecord(value)) {
		return undefined;
	}
	const candidate = value[key];
	return typeof candidate === 'string' ? candidate : undefined;
}

export function finiteNumber(value: unknown): number | undefined {
	return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

export function nonEmptyString(value: unknown): string | undefined {
	if (typeof value !== 'string') {
		return undefined;
	}
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : undefined;
}
