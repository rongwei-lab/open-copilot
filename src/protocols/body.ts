/**
 * Merge user/profile extension fields without allowing them to replace the
 * protocol envelope or authentication-related fields. Provider-specific
 * knobs (for example `top_k` or `enable_thinking`) remain pass-through.
 */
const PROTECTED_BODY_KEYS = new Set([
	'authorization',
	'api_key',
	'model',
	'messages',
	'input',
	'instructions',
	'stream',
	'stream_options',
	'tools',
	'tool_choice',
	'parallel_tool_calls',
	'store',
	'previous_response_id',
	'truncation',
	'max_tokens',
	'max_completion_tokens',
	'max_output_tokens',
]);

export function sanitizeExtraBody(
	value: Readonly<Record<string, unknown>> | undefined,
): Record<string, unknown> {
	if (!value) return {};
	const result: Record<string, unknown> = {};
	for (const [key, entry] of Object.entries(value)) {
		if (!PROTECTED_BODY_KEYS.has(key.toLowerCase())) result[key] = entry;
	}
	return result;
}
