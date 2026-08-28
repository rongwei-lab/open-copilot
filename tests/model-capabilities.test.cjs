const assert = require('node:assert/strict');
const test = require('node:test');

const { toModelDefinition } = require('../out/models/model-definition');
const { toModelDefinition: toProfileModelDefinition } = require('../out/models/profile');
const { ProfileResolver } = require('../out/models/profile');
const { createBuiltInModelRules, createCodexReasoningRules } = require('../out/models');
const {
	inferKnownContextWindowTokens,
	parseModelReasoningMetadata,
	parseModelVisionMetadata,
} = require('../out/protocols/model-metadata');

function resolvedModel(imageMode) {
	return {
		id: 'demo',
		apiModelId: 'demo',
		displayName: 'Demo',
		family: 'demo',
		version: '1',
		maxInputTokens: 1000,
		maxOutputTokens: 100,
		protocols: ['chat-completions'],
		selectedProtocol: 'chat-completions',
		capabilities: {
			toolCalling: false,
			parallelToolCalls: false,
			imageMode,
			reasoning: {
				enabled: false,
				efforts: [],
				canDisable: true,
				outputStyle: 'none',
			},
		},
		profile: {},
		source: {
			endpointTypes: ['openai'],
			profileIds: [],
			metadataIncomplete: false,
			fromStaleCache: false,
		},
	};
}

test('only native image mode is exposed as VS Code image input', () => {
	for (const imageMode of ['proxy', 'auto', 'none']) {
		const definition = toModelDefinition(resolvedModel(imageMode));
		const profileDefinition = toProfileModelDefinition(resolvedModel(imageMode));
		assert.equal(definition.capabilities.imageInput, false, imageMode);
		assert.equal(definition.capabilities.nativeImageInput, false, imageMode);
		assert.equal(profileDefinition.capabilities.imageInput, false, imageMode);
		assert.equal(profileDefinition.capabilities.nativeImageInput, false, imageMode);
	}

	const nativeDefinition = toModelDefinition(resolvedModel('native'));
	assert.equal(nativeDefinition.capabilities.imageInput, true);
	assert.equal(nativeDefinition.capabilities.nativeImageInput, true);
});

test('configured reasoning profiles reach the Copilot model definition', () => {
	const model = resolvedModel('none');
	model.capabilities.reasoning = {
		enabled: true,
		efforts: ['low', 'medium', 'high'],
		defaultEffort: 'medium',
		canDisable: true,
		requestStyle: 'responses-object',
		outputStyle: 'summary',
	};
	const definition = toModelDefinition(model);
	assert.deepEqual(definition.capabilities.thinking, {
		supportedEfforts: ['low', 'medium', 'high'],
		defaultEffort: 'medium',
		canDisable: true,
	});
	assert.equal(definition.reasoningRequestStyle, 'responses-object');
});

test('Codex-compatible New API aliases expose the complete built-in effort ladder', () => {
	const resolver = new ProfileResolver({ builtInRules: createCodexReasoningRules() });
	const result = resolver.explain({
		id: 'gpt-5.6-sol',
		supportedEndpointTypes: ['openai'],
		metadataIncomplete: false,
	});
	assert.ok(result.model);
	assert.deepEqual(result.model.capabilities.reasoning.efforts, [
		'low',
		'medium',
		'high',
		'xhigh',
		'max',
	]);
	assert.equal(result.model.capabilities.reasoning.defaultEffort, 'medium');
	assert.equal(result.model.capabilities.reasoning.canDisable, true);
	const definition = toModelDefinition(result.model);
	assert.deepEqual(definition.capabilities.thinking?.supportedEfforts, [
		'low',
		'medium',
		'high',
		'xhigh',
		'max',
	]);
});

test('built-in fallback does not advertise max for older Codex aliases', () => {
	const resolver = new ProfileResolver({ builtInRules: createCodexReasoningRules() });
	const result = resolver.explain({
		id: 'gpt-5.5',
		supportedEndpointTypes: ['openai'],
		metadataIncomplete: false,
	});
	assert.ok(result.model);
	assert.deepEqual(result.model.capabilities.reasoning.efforts, ['low', 'medium', 'high', 'xhigh']);
});

test('recognizes documented native-vision families without enabling unknown aliases', () => {
	const resolver = new ProfileResolver();
	const resolveImageMode = (id) => {
		const result = resolver.explain({
			id,
			supportedEndpointTypes: ['openai'],
			metadataIncomplete: false,
		});
		assert.ok(result.model, `${id} should resolve`);
		return result.model.capabilities.imageMode;
	};

	for (const id of [
		'claude-opus-4-6-thinking',
		'claude-sonnet-4-6',
		'grok-4.5',
		'grok-4.6',
		'gemini-3.7-flash-high',
		'deepseek-v4-flash-vision-exp',
	]) {
		assert.equal(resolveImageMode(id), 'native', id);
	}
	for (const id of [
		'deepseek-v4-flash-0731',
		'deepseek-v4-pro-0813',
		'hy3-free',
		'laguna-s-2.1-free',
	]) {
		assert.equal(resolveImageMode(id), 'proxy', id);
	}
});

test('explicit text-only modality metadata overrides a vision-name heuristic', () => {
	const resolver = new ProfileResolver();
	const result = resolver.explain({
		id: 'gemini-3-text-only',
		supportedEndpointTypes: ['openai'],
		metadataIncomplete: false,
		raw: { modalities: ['text'] },
	});
	assert.ok(result.model);
	assert.equal(result.model.capabilities.imageMode, 'proxy');

	const nested = resolver.explain({
		id: 'claude-sonnet-4-text-only',
		supportedEndpointTypes: ['openai'],
		metadataIncomplete: false,
		raw: { capabilities: { vision: false } },
	});
	assert.ok(nested.model);
	assert.equal(nested.model.capabilities.imageMode, 'proxy');
});

function resolveBuiltIn(id, extra = {}) {
	const resolver = new ProfileResolver({ builtInRules: createBuiltInModelRules() });
	const result = resolver.explain({
		id,
		supportedEndpointTypes: ['openai'],
		metadataIncomplete: false,
		...extra,
	});
	assert.ok(result.model, `${id} should resolve`);
	return result.model;
}

test('mainstream built-in rules expose conservative tools, vision, context and reasoning', () => {
	const claude = resolveBuiltIn('claude-haiku-4-5');
	assert.equal(claude.capabilities.toolCalling, true);
	assert.equal(claude.capabilities.imageMode, 'native');
	assert.deepEqual(claude.capabilities.reasoning.efforts, ['low', 'medium', 'high']);
	assert.equal(claude.maxInputTokens + claude.maxOutputTokens, 200_000);

	const gemini = resolveBuiltIn('gemini-2.5-pro');
	assert.equal(gemini.capabilities.imageMode, 'native');
	assert.deepEqual(gemini.capabilities.reasoning.efforts, ['low', 'medium', 'high']);
	assert.equal(gemini.maxInputTokens + gemini.maxOutputTokens, 1_048_576);

	const openai = resolveBuiltIn('o3-mini');
	assert.equal(openai.capabilities.toolCalling, true);
	assert.equal(openai.capabilities.imageMode, 'proxy');
	assert.deepEqual(openai.capabilities.reasoning.efforts, ['low', 'medium', 'high']);

	const codex = resolveBuiltIn('gpt-5.6');
	assert.deepEqual(codex.capabilities.reasoning.efforts, ['low', 'medium', 'high', 'xhigh', 'max']);
	assert.equal(codex.maxInputTokens, 922_000);
	assert.equal(codex.maxOutputTokens, 128_000);
});

test('covers current mainstream aliases and avoids substring capability leaks', () => {
	const claude5 = resolveBuiltIn('claude-opus-5');
	assert.equal(claude5.capabilities.imageMode, 'native');
	assert.equal(claude5.capabilities.reasoning.enabled, true);

	const gpt52Chat = resolveBuiltIn('gpt-5.2-chat-latest');
	assert.equal(gpt52Chat.capabilities.reasoning.enabled, true);
	assert.equal(gpt52Chat.maxInputTokens + gpt52Chat.maxOutputTokens, 128_000);
	const gpt53Chat = resolveBuiltIn('gpt-5.3-chat-latest');
	assert.equal(gpt53Chat.capabilities.reasoning.enabled, false);
	const gpt54Mini = resolveBuiltIn('gpt-5.4-mini');
	assert.equal(gpt54Mini.maxInputTokens + gpt54Mini.maxOutputTokens, 400_000);

	const qwenVl = resolveBuiltIn('qwen3-vl-235b-a22b');
	assert.equal(qwenVl.capabilities.imageMode, 'native');
	assert.equal(qwenVl.capabilities.toolCalling, true);
	const kimiCoding = resolveBuiltIn('kimi-for-coding');
	assert.equal(kimiCoding.capabilities.imageMode, 'native');
	assert.equal(kimiCoding.maxInputTokens + kimiCoding.maxOutputTokens, 262_144);

	const glmVision = resolveBuiltIn('glm-4.6v');
	assert.equal(glmVision.capabilities.imageMode, 'native');
	const mistral = resolveBuiltIn('mistral-large-latest');
	assert.equal(mistral.capabilities.imageMode, 'native');
	assert.equal(mistral.capabilities.toolCalling, true);

	// The old `*o4*` glob would classify an unrelated `solar-pro4` ID as an
	// OpenAI o4 model (and incorrectly expose native vision).
	const solar = resolveBuiltIn('solar-pro4');
	assert.equal(solar.capabilities.imageMode, 'proxy');
	assert.equal(solar.capabilities.reasoning.enabled, true);

	const imageGeneration = new ProfileResolver({ builtInRules: createBuiltInModelRules() }).explain({
		id: 'gpt-image-1',
		supportedEndpointTypes: ['openai'],
		metadataIncomplete: false,
	});
	assert.equal(imageGeneration.model, undefined);
});

test('covers legacy OpenAI, hosted VL aliases and newer Codex names', () => {
	const gpt35 = resolveBuiltIn('gpt-3.5-turbo-0125');
	assert.equal(gpt35.capabilities.toolCalling, true);
	assert.equal(gpt35.maxInputTokens + gpt35.maxOutputTokens, 16_384);

	const gptVision = resolveBuiltIn('gpt-4-vision-preview');
	assert.equal(gptVision.capabilities.imageMode, 'native');

	const codexPro = resolveBuiltIn('gpt-5.5-pro');
	assert.deepEqual(codexPro.capabilities.reasoning.efforts, [
		'low',
		'medium',
		'high',
		'xhigh',
	]);

	const codex53 = resolveBuiltIn('gpt-5.3-codex');
	assert.deepEqual(codex53.capabilities.reasoning.efforts, [
		'low',
		'medium',
		'high',
		'xhigh',
	]);

	const qwenVl = resolveBuiltIn('qwen2-5-vl-72b-instruct');
	assert.equal(qwenVl.capabilities.imageMode, 'native');
	assert.equal(qwenVl.maxInputTokens + qwenVl.maxOutputTokens, 131_072);

	const ring = resolveBuiltIn('Ring-1T');
	assert.equal(ring.capabilities.reasoning.enabled, true);
});

test('filters versioned image-generation aliases before built-in capabilities', () => {
	const resolver = new ProfileResolver({ builtInRules: createBuiltInModelRules() });
	for (const id of [
		'wan2.7-image',
		'wan2.7-image-pro',
		'grok-imagine-video-1.5',
		'doubao-seedance-2-0-260128',
		'kling-v2.1',
	]) {
		const result = resolver.explain({
			id,
			supportedEndpointTypes: ['openai'],
			metadataIncomplete: false,
		});
		assert.equal(result.model, undefined, id);
		assert.match(result.reason, /non-chat model name heuristic/iu);
	}
});

test('recognizes long-lived Chinese provider aliases conservatively', () => {
	const yi = resolveBuiltIn('yi-vision');
	assert.equal(yi.capabilities.imageMode, 'native');
	assert.equal(yi.maxInputTokens + yi.maxOutputTokens, 32_768);

	const ernie = resolveBuiltIn('ernie-4.0-turbo-128k');
	assert.equal(ernie.capabilities.imageMode, 'proxy');
	assert.equal(ernie.maxInputTokens + ernie.maxOutputTokens, 131_072);

	const doubao = resolveBuiltIn('doubao-seed-1-6-thinking-250715');
	assert.equal(doubao.capabilities.reasoning.enabled, true);
	assert.equal(doubao.capabilities.reasoning.efforts.length, 0);

	const abab = resolveBuiltIn('abab6.5-chat');
	assert.equal(abab.maxInputTokens + abab.maxOutputTokens, 32_768);
});

test('returns independent built-in rule profiles', () => {
	const first = createBuiltInModelRules();
	const second = createBuiltInModelRules();
	const firstReasoning = first.find((rule) => rule.id.includes('claude-reasoning'));
	const secondReasoning = second.find((rule) => rule.id.includes('claude-reasoning'));
	assert.ok(firstReasoning && secondReasoning);
	firstReasoning.profile.reasoning.efforts.push('test-only');
	assert.equal(secondReasoning.profile.reasoning.efforts.includes('test-only'), false);
});

test('built-in rules do not label text-only model families as native vision', () => {
	assert.equal(resolveBuiltIn('deepseek-v3').capabilities.imageMode, 'proxy');
	assert.equal(resolveBuiltIn('deepseek-r1').capabilities.imageMode, 'proxy');
	assert.equal(resolveBuiltIn('qwen3-235b-a22b').capabilities.imageMode, 'proxy');
	assert.equal(resolveBuiltIn('grok-3-mini').capabilities.imageMode, 'proxy');
	assert.equal(resolveBuiltIn('qwen2.5-vl-72b').capabilities.imageMode, 'native');
});

test('user and explicit upstream vision metadata override built-in hints', () => {
	const resolver = new ProfileResolver({
		builtInRules: createBuiltInModelRules(),
		exactProfiles: {
			'gpt-4o': { imageMode: 'proxy', nativeImageInput: false },
		},
	});
	const user = resolver.explain({
		id: 'gpt-4o',
		supportedEndpointTypes: ['openai'],
		metadataIncomplete: false,
	});
	assert.equal(user.model.capabilities.imageMode, 'proxy');

	const upstreamResolver = new ProfileResolver({ builtInRules: createBuiltInModelRules() });
	const upstream = upstreamResolver.explain({
		id: 'gpt-4o',
		supportedEndpointTypes: ['openai'],
		metadataIncomplete: false,
		vision: { nativeImageInput: false },
		contextWindowTokens: 65_536,
		maxOutputTokens: 4_096,
	});
	assert.equal(upstream.model.capabilities.imageMode, 'proxy');
	assert.equal(upstream.model.maxInputTokens + upstream.model.maxOutputTokens, 65_536);
	assert.equal(upstream.model.maxOutputTokens, 4_096);
	assert.deepEqual(parseModelVisionMetadata({ modalities: ['text'] }), {
		nativeImageInput: false,
	});
	assert.deepEqual(parseModelVisionMetadata({ tags: 'Reasoning,Tools,Vision,1M' }), {
		nativeImageInput: true,
	});
	assert.deepEqual(parseModelVisionMetadata({ tags: 'Reasoning,Tools,Text-only,128K' }), {
		nativeImageInput: false,
	});
	assert.equal(parseModelReasoningMetadata({ tags: 'Reasoning,Tools,Vision,1M' }).enabled, true);
});

test('context inference covers mainstream aliases without changing unknown defaults', () => {
	assert.equal(inferKnownContextWindowTokens('openai/gpt-4.1-mini'), 1_047_576);
	assert.equal(inferKnownContextWindowTokens('claude-sonnet-4-6'), 1_000_000);
	assert.equal(inferKnownContextWindowTokens('gemini-3.7-flash'), 1_048_576);
	assert.equal(inferKnownContextWindowTokens('deepseek-r1'), 128_000);
	assert.equal(inferKnownContextWindowTokens('qwen3-vl-235b-a22b'), 131_072);
	assert.equal(inferKnownContextWindowTokens('k3-256k'), 262_144);
	assert.equal(inferKnownContextWindowTokens('gpt-5.4-mini'), 400_000);
	assert.equal(inferKnownContextWindowTokens('gpt-3.5-turbo-0125'), 16_384);
	assert.equal(inferKnownContextWindowTokens('qwen2-5-vl-72b-instruct'), 131_072);
	assert.equal(inferKnownContextWindowTokens('grok-build-0.1'), 262_144);
	assert.equal(inferKnownContextWindowTokens('mistral-large-2411'), 131_072);
	assert.equal(inferKnownContextWindowTokens('mimo-v2-flash'), 262_144);
	assert.equal(inferKnownContextWindowTokens('nova-2-pro-v1'), 1_000_000);
	assert.equal(inferKnownContextWindowTokens('vendor/custom-chat'), undefined);
});
