const assert = require('node:assert/strict');
const test = require('node:test');

const {
	mergeModelReasoningMetadata,
	parseModelReasoningMetadata,
} = require('../out/protocols/model-metadata');
const { ChatAdapter } = require('../out/protocols/chat');
const { ResponsesAdapter } = require('../out/protocols/responses');
const { ProfileResolver } = require('../out/models/profile');
const { parseModelListEnvelope } = require('../out/newapi');
const { parseModelListEnvelope: parseCatalogModelListEnvelope } = require('../out/models/catalog');
const { toChatModelProfile } = require('../out/models/model-definition');

function remoteModel(overrides = {}) {
	return {
		id: 'upstream-reasoning-model',
		supported_endpoint_types: ['openai'],
		supports: {
			reasoning_efforts: ['none', 'low', 'medium', 'high', 'xhigh'],
			default_reasoning_effort: 'xhigh',
			reasoning_request_style: 'chat',
		},
		...overrides,
	};
}

function resolvedFromRemote(remote, options = {}) {
	const parsed = parseModelListEnvelope({ data: [remote] })[0];
	assert.ok(parsed, 'the model should be parsed from the gateway envelope');
	return new ProfileResolver(options).explain(parsed);
}

test('parses upstream reasoning efforts, default, disable support and request style', () => {
	const metadata = parseModelReasoningMetadata(remoteModel());
	assert.deepEqual(metadata, {
		supportedEfforts: ['low', 'medium', 'high', 'xhigh'],
		defaultEffort: 'xhigh',
		enabled: true,
		canDisable: true,
		requestStyle: 'chat-reasoning-effort',
	});
});

test('the ModelCatalog parser keeps the same upstream reasoning metadata', () => {
	const models = parseCatalogModelListEnvelope({ data: [remoteModel()] });
	assert.deepEqual(models[0].reasoning, {
		supportedEfforts: ['low', 'medium', 'high', 'xhigh'],
		defaultEffort: 'xhigh',
		enabled: true,
		canDisable: true,
		requestStyle: 'chat-reasoning-effort',
	});
});

test('keeps an upstream canonical-to-wire effort map', () => {
	const metadata = parseModelReasoningMetadata({
		id: 'mapped',
		supports: {
			reasoning_efforts: ['low', 'xhigh'],
			effort_mapping: { xhigh: 'max' },
		},
	});
	assert.deepEqual(metadata.effortMap, { xhigh: 'max' });
	const resolution = resolvedFromRemote({
		id: 'mapped',
		supported_endpoint_types: ['openai'],
		supports: {
			reasoning_efforts: ['low', 'xhigh'],
			effort_mapping: { xhigh: 'max' },
		},
	});
	assert.ok(resolution.model);
	assert.deepEqual(resolution.model.capabilities.reasoning.effortMap, { xhigh: 'max' });
});

test('parses nested capability aliases and normalizes none/off values', () => {
	const metadata = parseModelReasoningMetadata({
		id: 'nested',
		capabilities: {
			reasoning: {
				supported: ['low', 'MAX', 'off'],
				default: 'MAX',
				can_disable: true,
				protocol: 'responses',
			},
		},
	});
	assert.deepEqual(metadata, {
		supportedEfforts: ['low', 'max'],
		defaultEffort: 'max',
		enabled: true,
		canDisable: true,
		requestStyle: 'responses-object',
	});
});

test('upstream metadata overrides built-in reasoning while an exact user Profile remains authoritative', () => {
	const upstream = resolvedFromRemote(remoteModel({ id: 'gpt-5.6-luna' }));
	assert.ok(upstream.model);
	assert.deepEqual(upstream.model.capabilities.reasoning.efforts, [
		'low',
		'medium',
		'high',
		'xhigh',
	]);
	assert.equal(upstream.model.capabilities.reasoning.defaultEffort, 'xhigh');
	assert.equal(upstream.model.capabilities.reasoning.requestStyle, 'chat-reasoning-effort');

	const user = resolvedFromRemote(remoteModel({ id: 'gpt-5.6-luna' }), {
		exactProfiles: {
			'gpt-5.6-luna': {
				reasoning: {
					efforts: ['quick', 'deep'],
					defaultEffort: 'deep',
					canDisable: false,
					requestStyle: 'chat-reasoning-effort',
				},
			},
		},
	});
	assert.ok(user.model);
	assert.deepEqual(user.model.capabilities.reasoning.efforts, ['quick', 'deep']);
	assert.equal(user.model.capabilities.reasoning.defaultEffort, 'deep');
	assert.equal(user.model.capabilities.reasoning.canDisable, false);
	assert.equal(user.model.source.profileIds.includes('upstreamMetadata:reasoning'), true);
});

test('a user Profile can explicitly suppress the upstream reasoning wire field', () => {
	const resolution = resolvedFromRemote(remoteModel({ id: 'explicit-none-style' }), {
		exactProfiles: {
			'explicit-none-style': {
				reasoning: { enabled: true, requestStyle: 'none' },
			},
		},
	});
	assert.ok(resolution.model);
	assert.equal(resolution.model.capabilities.reasoning.requestStyle, 'none');
	assert.equal(toChatModelProfile(resolution.model).reasoning?.requestField, 'none');
});

test('merges duplicate model channels without dropping reasoning values', () => {
	const models = parseModelListEnvelope({
		data: [
			{
				id: 'same-model',
				supported_endpoint_types: ['openai'],
				reasoning: { supported_efforts: ['low', 'high'], default_effort: 'low' },
			},
			{
				id: 'same-model',
				supported_endpoint_types: ['openai-response'],
				reasoning: { supported_efforts: ['xhigh', 'none'], default_effort: 'xhigh' },
			},
		],
	})[0];
	assert.deepEqual(models.supportedEndpointTypes, ['openai', 'openai-response']);
	assert.deepEqual(models.reasoning, {
		supportedEfforts: ['low', 'high', 'xhigh'],
		defaultEffort: 'xhigh',
		enabled: true,
		canDisable: true,
		requestStyle: undefined,
	});
});

test('Chat Completions forwards selected effort, mapped effort and explicit none', () => {
	const adapter = new ChatAdapter({}, {
		reasoning: {
			requestField: 'reasoning_effort',
			supportedEfforts: ['low', 'high', 'xhigh'],
			effortMap: { xhigh: 'max' },
			canDisable: true,
		},
	});
	const base = { model: 'demo', messages: [{ role: 'user', content: 'OK' }] };
	assert.equal(adapter.buildRequest({ ...base, reasoningEffort: 'xhigh' }).reasoning_effort, 'max');
	assert.equal(adapter.buildRequest({ ...base, reasoningEffort: 'none' }).reasoning_effort, 'none');

	const cannotDisable = new ChatAdapter({}, {
		reasoning: {
			requestField: 'reasoning_effort',
			supportedEfforts: ['low', 'high'],
			canDisable: false,
		},
	});
	assert.equal(
		Object.hasOwn(cannotDisable.buildRequest({ ...base, reasoningEffort: 'none' }), 'reasoning_effort'),
		false,
	);
});

test('chat-thinking profiles use the disable toggle and keep enabled effort mapping opt-in', () => {
	const adapter = new ChatAdapter({}, {
		reasoning: {
			requestField: 'thinking',
			supportedEfforts: ['low', 'high'],
			canDisable: true,
		},
	});
	const base = { model: 'demo', messages: [{ role: 'user', content: 'OK' }] };
	assert.deepEqual(adapter.buildRequest({ ...base, reasoningEffort: 'none' }).thinking, {
		type: 'disabled',
	});
	assert.equal(
		Object.hasOwn(adapter.buildRequest({ ...base, reasoningEffort: 'high' }), 'reasoning_effort'),
		false,
	);
});

test('chat-thinking upstream mappings are forwarded when the gateway declares a wire map', () => {
	const resolution = resolvedFromRemote({
		id: 'thinking-map',
		supported_endpoint_types: ['openai'],
		reasoning: {
			enabled: true,
			supported_efforts: ['low', 'high'],
			effort_map: { high: 'budget-high' },
			request_style: 'thinking',
		},
	});
	assert.ok(resolution.model);
	const profile = toChatModelProfile(resolution.model);
	assert.equal(profile.reasoning?.requestField, 'thinking');
	assert.equal(profile.reasoning?.includeEffortWithThinking, true);
	const adapter = new ChatAdapter({}, profile);
	const body = adapter.buildRequest({
		model: 'thinking-map',
		messages: [{ role: 'user', content: 'OK' }],
		reasoningEffort: 'high',
	});
	assert.deepEqual(body.thinking, { type: 'enabled' });
	assert.equal(body.reasoning_effort, 'budget-high');
});

test('Responses profiles encode effort and none as the reasoning object', () => {
	const adapter = new ResponsesAdapter({}, {
		enabled: true,
		reasoning: {
			requestField: 'reasoning_effort',
			supportedEfforts: ['low', 'medium', 'high', 'xhigh'],
			canDisable: true,
		},
	});
	const base = { model: 'demo', messages: [{ role: 'user', content: 'OK' }] };
	assert.deepEqual(adapter.buildRequest({ ...base, reasoningEffort: 'xhigh' }).reasoning, {
		effort: 'xhigh',
		summary: 'auto',
	});
	assert.deepEqual(adapter.buildRequest({ ...base, reasoningEffort: 'none' }).reasoning, {
		effort: 'none',
	});
});

test('resolved upstream reasoning metadata reaches the Chat adapter profile', () => {
	const resolution = resolvedFromRemote(remoteModel());
	assert.ok(resolution.model);
	const profile = toChatModelProfile(resolution.model);
	assert.deepEqual(profile.reasoning, {
		requestField: 'reasoning_effort',
		outputStyle: 'summary',
		supportedEfforts: ['low', 'medium', 'high', 'xhigh'],
		effortMap: undefined,
		canDisable: true,
		includeReasoningContent: false,
		includeEffortWithThinking: false,
	});
});

test('does not invent effort levels when the gateway explicitly exposes only none', () => {
	const resolution = resolvedFromRemote({
		id: 'disabled-only',
		supported_endpoint_types: ['openai'],
		reasoning: { enabled: true, supported_efforts: ['none'], default_effort: 'none' },
	});
	assert.ok(resolution.model);
	assert.deepEqual(resolution.model.capabilities.reasoning.efforts, []);
	assert.equal(resolution.model.capabilities.reasoning.defaultEffort, 'none');
	assert.equal(resolution.model.capabilities.reasoning.canDisable, true);
	assert.deepEqual(toChatModelProfile(resolution.model).reasoning?.supportedEfforts, []);
});

test('preserves a gateway-only default effort instead of falling back to medium', () => {
	const metadata = parseModelReasoningMetadata({
		id: 'default-only',
		supports: { reasoning_enabled: true, default_reasoning_effort: 'xhigh' },
	});
	assert.deepEqual(metadata, {
		supportedEfforts: ['xhigh'],
		defaultEffort: 'xhigh',
		enabled: true,
		canDisable: undefined,
		requestStyle: undefined,
	});
	const resolution = resolvedFromRemote({
		id: 'default-only',
		supported_endpoint_types: ['openai'],
		supports: { reasoning_enabled: true, default_reasoning_effort: 'xhigh' },
	});
	assert.ok(resolution.model);
	assert.deepEqual(resolution.model.capabilities.reasoning.efforts, ['xhigh']);
	assert.equal(resolution.model.capabilities.reasoning.defaultEffort, 'xhigh');
});

test('normalizes a wire-form default through the upstream effort map', () => {
	const metadata = parseModelReasoningMetadata({
		id: 'mapped-default',
		supports: {
			reasoning_efforts: ['xhigh'],
			default_reasoning_effort: 'MAX',
			effort_map: { xhigh: 'max' },
		},
	});
	assert.equal(metadata?.defaultEffort, 'xhigh');
});

test('does not guess a reasoning wire field from a boolean-only capability flag', () => {
	const resolution = resolvedFromRemote({
		id: 'boolean-only',
		supported_endpoint_types: ['openai'],
		supports: { reasoning: true },
	});
	assert.ok(resolution.model);
	assert.equal(resolution.model.capabilities.reasoning.enabled, true);
	assert.deepEqual(resolution.model.capabilities.reasoning.efforts, []);
	assert.equal(resolution.model.capabilities.reasoning.requestStyle, 'none');
	assert.equal(toChatModelProfile(resolution.model).reasoning?.requestField, 'none');
});

test('does not treat an opaque reasoning type as a wire protocol', () => {
	const metadata = parseModelReasoningMetadata({
		id: 'opaque-style',
		reasoning: { enabled: true, type: 'reasoning' },
	});
	assert.equal(metadata?.requestStyle, undefined);
	assert.deepEqual(metadata?.supportedEfforts, []);
});

test('a disable-only channel clears reasoning levels merged from another channel', () => {
	const models = parseModelListEnvelope({
		data: [
			{
				id: 'same-disable-model',
				supported_endpoint_types: ['openai'],
				reasoning: { supported_efforts: ['low', 'high'], default_effort: 'high' },
			},
			{
				id: 'same-disable-model',
				supported_endpoint_types: ['openai-response'],
				reasoning: { supported_efforts: ['none'], default_effort: 'none' },
			},
		],
	})[0];
	assert.deepEqual(models.reasoning?.supportedEfforts, []);
	assert.equal(models.reasoning?.canDisable, true);
});

test('a boolean-only channel does not inherit another channel\'s effort list', () => {
	const models = parseModelListEnvelope({
		data: [
			{
				id: 'same-boolean-model',
				supported_endpoint_types: ['openai'],
				reasoning: { supported_efforts: ['low', 'high'], default_effort: 'high' },
			},
			{
				id: 'same-boolean-model',
				supported_endpoint_types: ['openai-response'],
				supports_reasoning: true,
			},
		],
	})[0];
	assert.deepEqual(models.reasoning?.supportedEfforts, []);
});

test('conflicting channel request styles fall back to the selected protocol', () => {
	const models = parseModelListEnvelope({
		data: [
			{
				id: 'style-conflict-model',
				supported_endpoint_types: ['openai'],
				reasoning: {
					supported_efforts: ['low', 'high'],
					request_style: 'chat-thinking',
				},
			},
			{
				id: 'style-conflict-model',
				supported_endpoint_types: ['openai-response'],
				reasoning: {
					supported_efforts: ['low', 'high'],
					request_style: 'responses-object',
				},
			},
		],
	})[0];
	assert.equal(models.reasoning?.requestStyle, undefined);
	const resolution = new ProfileResolver({ responsesEnabled: true }).explain(models);
	assert.ok(resolution.model);
	assert.equal(resolution.model.selectedProtocol, 'chat-completions');
	assert.equal(resolution.model.capabilities.reasoning.requestStyle, 'chat-reasoning-effort');
});

test('standalone metadata merge keeps the first values when the next channel is incomplete', () => {
	assert.deepEqual(
		mergeModelReasoningMetadata(
			{ supportedEfforts: ['low'], defaultEffort: 'low', enabled: true, canDisable: true },
			{ supportedEfforts: [], enabled: undefined },
		),
		{
			supportedEfforts: ['low'],
			defaultEffort: 'low',
			enabled: true,
			canDisable: true,
			requestStyle: undefined,
		},
	);
});
