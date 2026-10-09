const assert = require('node:assert/strict');
const test = require('node:test');
const http = require('node:http');
const { once } = require('node:events');
const { NewApiClient, parseModelListEnvelope } = require('../out/newapi');
const { ChatAdapter } = require('../out/protocols/chat');
const { ResponsesAdapter } = require('../out/protocols/responses');
const {
	ModelCatalog,
	MemoryModelCache,
	parseModelListEnvelope: parseCatalogEnvelope,
} = require('../out/models/catalog');
const { ProfileResolver } = require('../out/models/profile');

const input = { model: 'test-model', messages: [{ role: 'user', content: 'hello' }] };
const frame = (value) => `data: ${JSON.stringify(value)}\n\n`;
function sink(events) {
	return {
		text: (value) => events.push(['text', value]),
		reasoning() {},
		usage() {},
		toolCall: (value) => events.push(['tool', value]),
		completed: () => events.push(['completed']),
	};
}
function adapter(kind, response, timeoutMs = 1000) {
	const client = new NewApiClient('https://example.test/v1', 'dummy', {
		timeoutMs,
		fetchImpl: async () => response,
	});
	return kind === 'chat'
		? new ChatAdapter(client)
		: new ResponsesAdapter(client, { enabled: true });
}
function sse(data) {
	return new Response(data, { headers: { 'content-type': 'text/event-stream' } });
}

async function localServer(t, handler) {
	const server = http.createServer(handler);
	server.listen(0, '127.0.0.1');
	await once(server, 'listening');
	t.after(async () => {
		server.closeAllConnections();
		await new Promise((resolve) => server.close(resolve));
	});
	return `http://127.0.0.1:${server.address().port}/v1`;
}

for (const kind of ['models', 'chat', 'responses']) {
	test(
		`${kind}: timeout covers a stalled response body after headers`,
		{ timeout: 3000 },
		async (t) => {
			const url = await localServer(t, (_req, res) => {
				res.writeHead(200, {
					'content-type': kind === 'models' ? 'application/json' : 'text/event-stream',
				});
				res.write(kind === 'models' ? '{"data":' : ': waiting\n\n');
			});
			const client = new NewApiClient(url, 'dummy', { timeoutMs: 150 });
			const events = [];
			const run =
				kind === 'models'
					? client.listModels()
					: (kind === 'chat'
							? new ChatAdapter(client)
							: new ResponsesAdapter(client, { enabled: true })
						).stream(input, sink(events));
			await assert.rejects(run, (error) => error.code === 'timeout');
			assert.equal(
				events.some((event) => event[0] === 'completed'),
				false,
			);
		},
	);
}

test(
	'models: caller cancellation interrupts JSON reading after headers',
	{ timeout: 3000 },
	async (t) => {
		let headersReceived;
		const started = new Promise((resolve) => {
			headersReceived = resolve;
		});
		const url = await localServer(t, (_req, res) => {
			res.writeHead(200, { 'content-type': 'application/json' });
			res.write('{"data":');
		});
		const caller = new AbortController();
		const client = new NewApiClient(url, 'dummy', {
			timeoutMs: 2000,
			fetchImpl: async (...args) => {
				const response = await fetch(...args);
				// Let request() hand off the body before issuing cancellation.
				setImmediate(headersReceived);
				return response;
			},
		});
		const run = client.listModels(caller.signal);
		const rejected = assert.rejects(run, (error) => error.code === 'aborted');
		await started;
		caller.abort();
		await rejected;
	},
);

test('body completion removes cancellation listeners and preserves response metadata', async () => {
	const caller = new AbortController();
	let active = 0;
	const add = caller.signal.addEventListener.bind(caller.signal);
	const remove = caller.signal.removeEventListener.bind(caller.signal);
	caller.signal.addEventListener = (...args) => {
		active++;
		return add(...args);
	};
	caller.signal.removeEventListener = (...args) => {
		active--;
		return remove(...args);
	};
	const response = Response.json({ data: [] }, { headers: { 'x-request-id': 'trace-1' } });
	Object.defineProperty(response, 'url', { value: 'https://example.test/v1/models' });
	const client = new NewApiClient('https://example.test/v1', 'dummy', {
		fetchImpl: async () => response,
	});
	const managed = await client.request('/models', { signal: caller.signal });
	assert.equal(managed.url, response.url);
	assert.equal(managed.headers.get('x-request-id'), 'trace-1');
	assert.equal(active, 1);
	assert.deepEqual(await managed.json(), { data: [] });
	assert.equal(active, 0);
});

for (const kind of ['chat', 'responses']) {
	test(`${kind}: incomplete EOF rejects without reporting completion`, async () => {
		const payload =
			kind === 'chat'
				? { choices: [{ index: 0, delta: { content: 'partial' } }] }
				: { type: 'response.output_text.delta', delta: 'partial' };
		const events = [];
		await assert.rejects(
			adapter(kind, sse(frame(payload))).stream(input, sink(events)),
			/ended before/,
		);
		assert.deepEqual(events, [['text', 'partial']]);
	});
	test(`${kind}: terminal event cancels an upstream that keeps the connection open`, async () => {
		let cancelled = 0;
		const data =
			kind === 'chat'
				? 'data: [DONE]\n\n'
				: frame({ type: 'response.completed', response: { id: 'r1' } });
		const body = new ReadableStream({
			start(c) {
				c.enqueue(new TextEncoder().encode(data));
			},
			cancel() {
				cancelled++;
			},
		});
		const events = [];
		await adapter(kind, sse(body)).stream(input, sink(events));
		assert.deepEqual(events, [['completed']]);
		assert.equal(cancelled, 1);
		assert.equal(body.locked, false);
	});
}

test('chat: finish_reason without [DONE] remains compatible', async () => {
	const events = [];
	await adapter(
		'chat',
		sse(frame({ choices: [{ index: 0, delta: { content: 'OK' }, finish_reason: 'stop' }] })),
	).stream(input, sink(events));
	assert.deepEqual(events, [['text', 'OK'], ['completed']]);
});

test('chat: EOF does not flush an unfinished tool call', async () => {
	const events = [];
	const payload = {
		choices: [
			{
				index: 0,
				delta: {
					tool_calls: [
						{ index: 0, id: 'call_1', function: { name: 'edit_file', arguments: '{"path":' } },
					],
				},
			},
		],
	};
	await assert.rejects(
		adapter('chat', sse(frame(payload))).stream(input, sink(events)),
		/ended before/,
	);
	assert.deepEqual(events, []);
});

test('SSE parse errors release the body even if upstream cancellation rejects', async () => {
	let cancelled = 0;
	const body = new ReadableStream({
		start(c) {
			c.enqueue(new TextEncoder().encode('data: not-json\n\n'));
		},
		cancel() {
			cancelled++;
			throw new Error('cancel failed');
		},
	});
	await assert.rejects(
		adapter('chat', sse(body)).stream(input, sink([])),
		(error) => error.code === 'invalid_sse_json',
	);
	assert.equal(cancelled, 1);
	assert.equal(body.locked, false);
});

test('unexpected content type cancels its unread response body', async () => {
	let cancelled = false;
	const response = new Response(
		new ReadableStream({
			cancel() {
				cancelled = true;
			},
		}),
		{ headers: { 'content-type': 'application/json' } },
	);
	const client = new NewApiClient('https://example.test/v1', 'dummy', {
		fetchImpl: async () => response,
	});
	await assert.rejects(
		client.stream('/chat/completions', input),
		(error) => error.code === 'invalid_content_type',
	);
	assert.equal(cancelled, true);
});

test(
	'HTTP error bodies at the size limit cancel a response that has not reached EOF',
	{ timeout: 3000 },
	async (t) => {
		let closed = false;
		const url = await localServer(t, (_req, res) => {
			res.socket?.on('close', () => {
				closed = true;
			});
			res.writeHead(400, { 'content-type': 'text/plain' });
			res.write('x'.repeat(8 * 1024));
		});
		const client = new NewApiClient(url, 'dummy', { timeoutMs: 1000 });
		await assert.rejects(client.listModels(), (error) => error.code === 'http');
		for (let attempt = 0; attempt < 20 && !closed; attempt++) {
			await new Promise((resolve) => setTimeout(resolve, 10));
		}
		assert.equal(closed, true);
	},
);

test('cancelling during a buffered SSE chunk cannot report completion', async () => {
	const controller = new AbortController();
	const events = [];
	const target = sink(events);
	target.text = (value) => {
		events.push(['text', value]);
		controller.abort();
	};
	await assert.rejects(
		adapter(
			'chat',
			sse(frame({ choices: [{ delta: { content: 'first' } }] }) + 'data: [DONE]\n\n'),
		).stream(input, target, controller.signal),
	);
	assert.deepEqual(events, [['text', 'first']]);
});

for (const parse of [parseModelListEnvelope, parseCatalogEnvelope]) {
	test(`${parse === parseModelListEnvelope ? 'client' : 'catalog'} parser accepts empty data but rejects malformed model data`, () => {
		assert.deepEqual(parse({ data: [] }), []);
		assert.throws(() => parse({ data: [{}] }));
		assert.throws(() => parse({ data: null }));
		assert.throws(() => parse({ success: false, data: [] }));
	});
}

test('empty remote catalog clears cached models and is reused within TTL', async () => {
	let envelope = { data: [{ id: 'deleted-model' }] };
	let requests = 0;
	const client = new NewApiClient('https://example.test/v1', 'dummy', {
		fetchImpl: async () => {
			requests++;
			return Response.json(envelope);
		},
	});
	const catalog = new ModelCatalog({
		cache: new MemoryModelCache('empty-regression'),
		clientFactory: () => client,
		resolver: new ProfileResolver(),
		ttlMs: 60000,
	});
	try {
		await catalog.refresh();
		envelope = { data: [] };
		assert.deepEqual(await catalog.refresh(), []);
		assert.deepEqual(await catalog.getModels(), []);
		assert.equal(requests, 2);
		assert.equal(catalog.getSnapshotInfo().lastError, undefined);
	} finally {
		catalog.dispose();
	}
});
