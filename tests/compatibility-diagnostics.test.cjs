const assert = require('node:assert/strict');
const test = require('node:test');

const { NewApiClient } = require('../out/newapi');
const {
	runCompatibilityDiagnostics,
	runVisionCompatibilityProbe,
} = require('../out/models/diagnostics');
const { ResponsesAdapter } = require('../out/protocols/responses');

function model(overrides = {}) {
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
			toolCalling: true,
			parallelToolCalls: true,
			imageMode: 'none',
			reasoning: { enabled: false, efforts: [], canDisable: true, outputStyle: 'none' },
		},
		profile: { maxTokensField: 'max_tokens' },
		source: {
			endpointTypes: ['openai'],
			profileIds: [],
			metadataIncomplete: false,
			fromStaleCache: false,
		},
		...overrides,
	};
}

function streamResponse(events, status = 200) {
	const body = events
		.map((event) => (event === '[DONE]' ? 'data: [DONE]\n\n' : `data: ${JSON.stringify(event)}\n\n`))
		.join('');
	return new Response(body, {
		status,
		headers: { 'content-type': 'text/event-stream', 'x-request-id': 'diagnostic-test' },
	});
}

function clientFor(fetchImpl) {
	return new NewApiClient('https://example.test/v1', 'test-token', {
		fetchImpl,
		appendV1ForRoot: false,
		timeoutMs: 2000,
	});
}

test('runs core chat, stream, usage, and tool probes without executing tools', async () => {
	let toolRequests = 0;
	const fetchImpl = async (_url, init = {}) => {
		const body = JSON.parse(init.body || '{}');
		if (body.stream) {
			if (body.tools) {
				toolRequests += 1;
				const calls = body.tools.map((tool, index) => ({
					index,
					id: `call-${index}`,
					type: 'function',
					function: { name: tool.function.name, arguments: '{}' },
				}));
				return streamResponse([
					{ id: 'tool', model: 'demo', choices: [{ index: 0, delta: { tool_calls: calls } }] },
					'[DONE]',
				]);
			}
			return streamResponse([
				{ id: 'stream', model: 'demo', choices: [{ index: 0, delta: { content: 'OK' } }] },
				{ choices: [], usage: { prompt_tokens: 2, completion_tokens: 1, total_tokens: 3 } },
				'[DONE]',
			]);
		}
		return new Response(
			JSON.stringify({
				id: 'chat',
				model: 'demo',
				choices: [{ message: { role: 'assistant', content: 'OK' } }],
				usage: { prompt_tokens: 2, completion_tokens: 1, total_tokens: 3 },
			}),
			{ status: 200, headers: { 'content-type': 'application/json', 'x-request-id': 'diagnostic-test' } },
		);
	};

	const report = await runCompatibilityDiagnostics({
		client: clientFor(fetchImpl),
		model: model(),
	});

	assert.equal(report.passed, true);
	assert.equal(report.checks.find((check) => check.id === 'chat').status, 'pass');
	assert.equal(report.checks.find((check) => check.id === 'stream').status, 'pass');
	assert.equal(report.checks.find((check) => check.id === 'usage').status, 'pass');
	assert.equal(report.checks.find((check) => check.id === 'tools').status, 'pass');
	assert.equal(toolRequests, 1);
});

test('does not replay profile extra request fields into diagnostic probes', async () => {
	const requestBodies = [];
	const fetchImpl = async (_url, init = {}) => {
		const body = JSON.parse(init.body || '{}');
		requestBodies.push(body);
		if (body.stream) {
			if (body.tools) {
				return streamResponse([
					{
						choices: [
							{
								delta: {
									tool_calls: [
										{
											index: 0,
												id: 'call-0',
												function: { name: 'diagnostic_ping', arguments: '{}' },
											},
									],
								},
							},
						],
					},
					'[DONE]',
				]);
			}
			return streamResponse([{ choices: [{ delta: { content: 'OK' } }] }, '[DONE]']);
		}
		return new Response(JSON.stringify({ choices: [{ message: { content: 'OK' } }] }), {
			status: 200,
			headers: { 'content-type': 'application/json' },
		});
	};
	const report = await runCompatibilityDiagnostics({
		client: clientFor(fetchImpl),
		model: model({
			profile: {
				maxTokensField: 'max_tokens',
				extraRequestFields: { 'x-debug-secret': 'must-not-be-sent', temperature: 0.2 },
			},
		}),
	});
	assert.equal(report.passed, true);
	assert.ok(requestBodies.length >= 3);
	for (const body of requestBodies) {
		assert.equal(Object.hasOwn(body, 'x-debug-secret'), false);
		assert.equal(Object.hasOwn(body, 'temperature'), false);
	}
});

test('reports malformed SSE as a stream failure', async () => {
	const fetchImpl = async (_url, init = {}) => {
		const body = JSON.parse(init.body || '{}');
		if (body.stream) {
			return new Response('data: {not-json}\n\ndata: [DONE]\n\n', {
				status: 200,
				headers: { 'content-type': 'text/event-stream' },
			});
		}
		return new Response(
			JSON.stringify({ choices: [{ message: { content: 'OK' } }] }),
			{ status: 200, headers: { 'content-type': 'application/json' } },
		);
	};
	const report = await runCompatibilityDiagnostics({ client: clientFor(fetchImpl), model: model() });
	assert.equal(report.checks.find((check) => check.id === 'stream').status, 'fail');
});

test('supports an opt-in vision probe that verifies image content', async () => {
	const fetchImpl = async (_url, init = {}) => {
		const body = JSON.parse(init.body || '{}');
		const content = body.messages?.[0]?.content;
		const hasImage = Array.isArray(content) && content.some((part) => part.type === 'image_url');
		assert.equal(hasImage || body.stream, true);
		if (body.stream) {
			return streamResponse([{ choices: [{ delta: { content: 'OK' } }] }, '[DONE]']);
		}
		return new Response(JSON.stringify({ choices: [{ message: { content: 'V7Q2' } }] }), {
			status: 200,
			headers: { 'content-type': 'application/json' },
		});
	};
	const report = await runCompatibilityDiagnostics({
		client: clientFor(fetchImpl),
		model: model({ capabilities: { ...model().capabilities, imageMode: 'native' } }),
		includeVision: true,
	});
	assert.equal(report.checks.find((check) => check.id === 'vision').status, 'pass');
	assert.equal(report.checks.find((check) => check.id === 'vision').details.visualContentVerified, true);
});

test('accepts a concise visual description while rejecting an OCR near-match', async () => {
	let answer = 'red-circle,blue-square';
	const fetchImpl = async () =>
		new Response(JSON.stringify({ choices: [{ message: { content: answer } }] }), {
			status: 200,
			headers: { 'content-type': 'application/json' },
		});
	const options = {
		client: clientFor(fetchImpl),
		model: model({ capabilities: { ...model().capabilities, imageMode: 'proxy' } }),
		includeVision: true,
	};
	let check = await runVisionCompatibilityProbe(options);
	assert.equal(check.status, 'pass');
	answer = 'red-circle,blue-squar';
	check = await runVisionCompatibilityProbe(options);
	assert.equal(check.status, 'warn');
});

test('does not mark a model native when it ignores or misreads the probe image', async () => {
	const fetchImpl = async (_url, init = {}) => {
		const body = JSON.parse(init.body || '{}');
		if (body.stream) {
			return streamResponse([{ choices: [{ delta: { content: 'OK' } }] }, '[DONE]']);
		}
		return new Response(JSON.stringify({ choices: [{ message: { content: 'VISUAL_OK' } }] }), {
			status: 200,
			headers: { 'content-type': 'application/json' },
		});
	};
	const report = await runCompatibilityDiagnostics({
		client: clientFor(fetchImpl),
		model: model({ capabilities: { ...model().capabilities, imageMode: 'proxy' } }),
		includeVision: true,
	});
	const vision = report.checks.find((check) => check.id === 'vision');
	assert.equal(vision.status, 'warn');
	assert.equal(vision.details.visualContentVerified, false);
});

test('background native-vision probe sends only the bounded image request', async () => {
	let requests = 0;
	const fetchImpl = async (_url, init = {}) => {
		requests += 1;
		const body = JSON.parse(init.body || '{}');
		const content = body.messages?.[0]?.content;
		assert.ok(Array.isArray(content));
		assert.ok(content.some((part) => part.type === 'image_url'));
		return new Response(JSON.stringify({ choices: [{ message: { content: 'V7Q2' } }] }), {
			status: 200,
			headers: { 'content-type': 'application/json' },
		});
	};

	const check = await runVisionCompatibilityProbe({
		client: clientFor(fetchImpl),
		model: model({ capabilities: { ...model().capabilities, imageMode: 'proxy' } }),
		includeVision: true,
	});
	assert.equal(check.status, 'pass');
	assert.equal(requests, 1);
});

test('checks non-streaming and streaming Responses payloads', async () => {
	const fetchImpl = async (_url, init = {}) => {
		const body = JSON.parse(init.body || '{}');
		if (body.stream) {
			return streamResponse([
				{ type: 'response.output_text.delta', delta: 'OK' },
				{
					type: 'response.completed',
					response: {
						model: 'demo-responses',
						usage: { input_tokens: 2, output_tokens: 1, total_tokens: 3 },
					},
				},
			]);
		}
		return new Response(
			JSON.stringify({
				model: 'demo-responses',
				output_text: 'OK',
				usage: { input_tokens: 2, output_tokens: 1, total_tokens: 3 },
			}),
			{ status: 200, headers: { 'content-type': 'application/json' } },
		);
	};
	const report = await runCompatibilityDiagnostics({
		client: clientFor(fetchImpl),
		model: model({
			apiModelId: 'demo-responses',
			protocols: ['responses'],
			selectedProtocol: 'responses',
			source: {
				endpointTypes: ['openai-response'],
				profileIds: [],
				metadataIncomplete: false,
				fromStaleCache: false,
			},
		}),
	});
	assert.equal(report.checks.find((check) => check.id === 'responses').status, 'pass');
	assert.equal(report.checks.find((check) => check.id === 'stream').status, 'pass');
	assert.equal(report.checks.find((check) => check.id === 'usage').status, 'pass');
});

test('encodes Responses reasoning effort for Codex-style profiles', () => {
	const adapter = new ResponsesAdapter({}, {
		enabled: true,
		reasoning: {
			requestField: 'reasoning_effort',
			supportedEfforts: ['low', 'medium', 'high'],
			outputStyle: 'summary',
		},
	});
	const body = adapter.buildRequest({
		model: 'gpt-5.6-luna',
		messages: [{ role: 'user', content: 'Reply with OK.' }],
		reasoningEffort: 'high',
	});
	assert.deepEqual(body.reasoning, { effort: 'high', summary: 'auto' });
});

test('diagnostic reasoning probe follows chat-thinking adapter policy', async () => {
	const requestBodies = [];
	const fetchImpl = async (_url, init = {}) => {
		const body = JSON.parse(init.body || '{}');
		requestBodies.push(body);
		if (body.stream) {
			return streamResponse([{ choices: [{ delta: { content: 'OK' } }] }, '[DONE]']);
		}
		return new Response(JSON.stringify({ choices: [{ message: { content: 'OK' } }] }), {
			status: 200,
			headers: { 'content-type': 'application/json' },
		});
	};
	const report = await runCompatibilityDiagnostics({
		client: clientFor(fetchImpl),
		model: model({
			capabilities: {
				...model().capabilities,
				reasoning: {
					enabled: true,
					efforts: ['low', 'high'],
					defaultEffort: 'high',
					canDisable: true,
					requestStyle: 'chat-thinking',
				},
			},
		}),
		includeOptional: true,
	});
	assert.equal(report.checks.find((check) => check.id === 'reasoning').status, 'pass');
	const reasoningBody = requestBodies.find((body) => body.thinking);
	assert.deepEqual(reasoningBody?.thinking, { type: 'enabled' });
	assert.equal(Object.hasOwn(reasoningBody || {}, 'reasoning_effort'), false);
});

test('diagnostic reasoning probe supports the Responses protocol', async () => {
	const requestBodies = [];
	const fetchImpl = async (_url, init = {}) => {
		const body = JSON.parse(init.body || '{}');
		requestBodies.push(body);
		if (body.stream) {
			return streamResponse([
				{ type: 'response.output_text.delta', delta: 'OK' },
				{ type: 'response.completed', response: { model: 'demo-responses' } },
			]);
		}
		return new Response(JSON.stringify({ output_text: 'OK' }), {
			status: 200,
			headers: { 'content-type': 'application/json' },
		});
	};
	const report = await runCompatibilityDiagnostics({
		client: clientFor(fetchImpl),
		model: model({
			apiModelId: 'demo-responses',
			protocols: ['responses'],
			selectedProtocol: 'responses',
			capabilities: {
				...model().capabilities,
				reasoning: {
					enabled: true,
					efforts: ['low', 'high'],
					defaultEffort: 'high',
					canDisable: true,
					requestStyle: 'responses-object',
				},
			},
			source: {
				endpointTypes: ['openai-response'],
				profileIds: [],
				metadataIncomplete: false,
				fromStaleCache: false,
			},
		}),
		includeOptional: true,
	});
	assert.equal(report.checks.find((check) => check.id === 'reasoning').status, 'pass');
	const reasoningBody = requestBodies.find((body) => body.reasoning);
	assert.deepEqual(reasoningBody?.reasoning, { effort: 'high', summary: 'auto' });
});

test('honors an already-aborted diagnostic signal without sending a request', async () => {
	let requests = 0;
	const controller = new AbortController();
	controller.abort(new DOMException('cancelled', 'AbortError'));
	await assert.rejects(
		runCompatibilityDiagnostics({
			client: clientFor(async () => {
				requests += 1;
				return new Response('{}');
			}),
			model: model(),
			signal: controller.signal,
		}),
		(error) => error?.name === 'AbortError',
	);
	assert.equal(requests, 0);
});
