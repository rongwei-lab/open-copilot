const assert = require('node:assert/strict');
const test = require('node:test');
const Module = require('node:module');

const noop = () => {};
const configuration = {};
const writes = [];
class TextPart {
	constructor(value) {
		this.value = value;
	}
}
class DataPart {
	constructor(data, mimeType) {
		Object.assign(this, { data, mimeType });
	}
}
class ToolCallPart {
	constructor(callId, name, input) {
		Object.assign(this, { callId, name, input });
	}
}
class ToolResultPart {
	constructor(callId, content) {
		Object.assign(this, { callId, content });
	}
}
class ThinkingPart {
	constructor(value) {
		this.value = value;
	}
}
const vscode = {
	LanguageModelTextPart: TextPart,
	LanguageModelDataPart: DataPart,
	LanguageModelToolCallPart: ToolCallPart,
	LanguageModelToolResultPart: ToolResultPart,
	LanguageModelThinkingPart: ThinkingPart,
	LanguageModelChatMessageRole: { User: 1, Assistant: 2 },
	LanguageModelChatToolMode: { Auto: 1, Required: 2 },
	env: { language: 'en' },
	ConfigurationTarget: { Global: 1 },
	workspace: {
		getConfiguration: () => ({
			get: (key, fallback) => configuration[key] ?? fallback,
			inspect: () => configuration.__inspection,
			update: async (key, value, target) => {
				configuration[key] = value;
				writes.push({ key, value, target });
			},
		}),
	},
	window: {
		createOutputChannel: () => ({
			info: noop,
			warn: noop,
			error: noop,
			debug: noop,
			dispose: noop,
		}),
	},
	lm: { selectChatModels: async () => [] },
};
// Mock only the VS Code host boundary; all provider, protocol and configuration code is real.
const load = Module._load;
Module._load = function (request, parent, ...rest) {
	return request === 'vscode' ? vscode : load.call(this, request, parent, ...rest);
};
const { streamChatCompletion } = require('../out/provider/stream');
const { prepareChatRequest } = require('../out/provider/request');
const { DeepSeekChatProvider } = require('../out/provider');
const { NewApiClient } = require('../out/newapi');
const { ProfileResolver } = require('../out/models/profile');
const { getNewApiSettings } = require('../out/config');
const { updateModelProfile } = require('../out/config');
const { convertMessages } = require('../out/provider/convert');
const { resolveImageMessages } = require('../out/provider/vision');
const { getConfiguredThinkingEffort } = require('../out/provider/models');
Module._load = load;

const token = {
	isCancellationRequested: false,
	onCancellationRequested: () => ({ dispose: noop }),
};
test.beforeEach(() => {
	for (const key of Object.keys(configuration)) delete configuration[key];
	writes.length = 0;
});

async function forwardTool(argumentsText, report) {
	return streamChatCompletion({
		prepared: {
			client: {
				streamChatCompletion: async (_request, callbacks) => {
					callbacks.onToolCall({
						id: 'call_1',
						type: 'function',
						function: { name: 'edit_file', arguments: argumentsText },
					});
					callbacks.onDone();
				},
			},
			request: {},
			protocol: 'chat-completions',
			trailingToolResultIds: [],
			replayMarkerMetadata: {},
			cacheDiagnostics: new Proxy({}, { get: () => noop }),
		},
		progress: { report },
		token,
		getCharsPerToken: () => 4,
		setCharsPerToken: noop,
	});
}
for (const value of ['{"path":', '', 'null', '[]', '42', '"text"']) {
	test(`invalid tool arguments ${JSON.stringify(value)} never reach Copilot`, async () => {
		const parts = [];
		await assert.rejects(
			forwardTool(value, (part) => parts.push(part)),
			(error) => error.code === 'protocol',
		);
		assert.deepEqual(parts, []);
	});
}

test('valid tool arguments, including an empty object, are preserved', async () => {
	for (const args of [{ path: 'a.ts', nested: { enabled: true } }, {}]) {
		const parts = [];
		await forwardTool(JSON.stringify(args), (part) => parts.push(part));
		assert.equal(parts.length, 1);
		assert.deepEqual(parts[0].input, args);
	}
});

test('host reporting errors propagate without a second empty-argument tool call', async () => {
	let reports = 0;
	await assert.rejects(
		forwardTool('{"path":"a.ts"}', () => {
			reports++;
			throw new Error('host failed');
		}),
		/host failed/,
	);
	assert.equal(reports, 1);
});

test('tool-result images are preserved in native requests and proxy descriptions', async () => {
	const image = new DataPart(Uint8Array.from([1, 2, 3]), 'image/png');
	const message = {
		role: vscode.LanguageModelChatMessageRole.User,
		content: [new ToolResultPart('call_1', [new TextPart('Screenshot'), image])],
	};
	const native = convertMessages([message], false, true);
	assert.deepEqual(native, [
		{
			role: 'tool',
			content: [
				{ type: 'text', text: 'Screenshot' },
				{ type: 'image_url', image_url: { url: 'data:image/png;base64,AQID' } },
			],
			tool_call_id: 'call_1',
		},
	]);

	const resolved = await resolveImageMessages([message], token, async () => ({
		id: 'vision',
		source: 'configured',
		describe: async () => 'red circle',
	}));
	const toolResult = resolved.messages[0].content[0];
	assert.equal(toolResult instanceof ToolResultPart, true);
	assert.equal(toolResult.content.some((part) => part instanceof DataPart), false);
	assert.equal(toolResult.content.at(-1).value.includes('red circle'), true);
});

test('model profiles update the active workspace scope when one exists', async () => {
	vscode.ConfigurationTarget.Workspace = 2;
	configuration.__inspection = {
		workspaceFolderValue: { demo: { imageMode: 'proxy' } },
		globalValue: { global: { imageMode: 'native' } },
	};
	await updateModelProfile('demo', { nativeImageInput: true });
	const write = writes.at(-1);
	assert.equal(write.target, vscode.ConfigurationTarget.Workspace);
	assert.deepEqual(write.value, {
		demo: { imageMode: 'proxy', nativeImageInput: true },
	});
});

test('thinking configuration is matched case-insensitively to the advertised effort', () => {
	assert.equal(
		getConfiguredThinkingEffort(
			{ modelOptions: { reasoningEffort: 'HIGH' } },
			{ supportedEfforts: ['low', 'high'], defaultEffort: 'low', canDisable: false },
		),
		'high',
	);
});

for (const [mode, expected] of [
	[vscode.LanguageModelChatToolMode.Required, 'required'],
	[vscode.LanguageModelChatToolMode.Auto, 'auto'],
	[undefined, 'auto'],
]) {
	test(`tool mode ${mode} becomes ${expected} on both protocols`, async () => {
		const model = new ProfileResolver({
			exactProfiles: { 'test-model': { toolCalling: true, imageMode: 'none' } },
		}).resolveAll([
			{ id: 'test-model', supportedEndpointTypes: ['openai'], metadataIncomplete: false },
		])[0];
		const prepared = await prepareChatRequest({
			authManager: { getApiKey: async () => 'dummy' },
			globalStorageUri: {},
			modelInfo: { id: 'test-model' },
			segment: {},
			messages: [{ role: 1, content: [new TextPart('call tool')] }],
			options: {
				toolMode: mode,
				tools: [{ name: 'edit_file', description: 'Edit', inputSchema: { type: 'object' } }],
			},
			token,
			cacheDiagnostics: { beginRequest: () => ({}) },
			getVisionDescriber: async () => undefined,
			resolvedModel: model,
			settings: getNewApiSettings(),
		});
		assert.equal(prepared.request.tool_choice, expected);
		const requests = [];
		const originalFetch = globalThis.fetch;
		globalThis.fetch = async (_url, init) => {
			requests.push(JSON.parse(init.body));
			return new Response('data: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } });
		};
		try {
			// Build a client after replacing fetch, so both wire paths are checked.
			const { OpenAICompatibleClient } = require('../out/client/openai-compatible');
			const client = new OpenAICompatibleClient('https://example.test/v1', 'dummy', {
				supportsTools: true,
			});
			const callbacks = {
				onContent: noop,
				onThinking: noop,
				onToolCall: noop,
				onDone: noop,
				onError: (error) => {
					throw error;
				},
			};
			await client.streamChatCompletion(prepared.request, callbacks, token);
			await client.streamResponses(prepared.request, callbacks, token);
		} finally {
			globalThis.fetch = originalFetch;
		}
		assert.deepEqual(
			requests.map((request) => request.tool_choice),
			[expected, expected],
		);
	});
}

function visionFixture(overrides = {}) {
	configuration.baseUrl = 'https://old.example.test/v1';
	Object.assign(configuration, overrides);
	const settings = getNewApiSettings();
	const models = new ProfileResolver({ unknownModelDefaults: { imageMode: 'auto' } }).resolveAll(
		['first', 'second'].map((id) => ({
			id,
			supportedEndpointTypes: ['openai'],
			metadataIncomplete: false,
		})),
	);
	const catalog = { getModels: async () => models, dispose: noop };
	const provider = Object.create(DeepSeekChatProvider.prototype);
	const state = {};
	provider.isActive = true;
	provider.catalog = catalog;
	provider.context = {
		globalState: {
			get: (key) => state[key],
			update: async (key, value) => {
				state[key] = value;
			},
		},
	};
	provider.authManager = { getApiKey: async () => 'dummy' };
	provider.refreshModelPicker = noop;
	provider.onDidChangeLanguageModelChatInformationEmitter = { fire: noop };
	let release;
	const blocked = new Promise((resolve) => {
		release = resolve;
	});
	let notifyStarted;
	const started = new Promise((resolve) => {
		notifyStarted = resolve;
	});
	const calls = [];
	provider.createNewApiClient = (options, apiKey) =>
		new NewApiClient(options.baseUrl, apiKey, {
			fetchImpl: async (url, init) => {
				calls.push({ url, signal: init.signal, model: JSON.parse(init.body).model });
				if (calls.length === 1) {
					notifyStarted();
					await blocked;
				}
				return Response.json({ choices: [{ message: { content: 'red-circle,blue-square' } }] });
			},
		});
	return { provider, catalog, settings, calls, state, release, started };
}

for (const change of ['profile', 'gateway', 'token', 'deactivate']) {
	test(
		`in-flight vision probe cannot write or continue after ${change} changes`,
		{ timeout: 3000 },
		async () => {
			const fixture = visionFixture();
			const { provider, catalog, settings, started, release, calls } = fixture;
			const flight = provider.autoRefreshNewModelVision(catalog, 'dummy', settings);
			await started;
			try {
				if (change === 'profile') {
					// Even before a configuration event is delivered, re-read the user's choice.
					configuration.modelProfiles = { first: { imageMode: 'none', nativeImageInput: false } };
				} else if (change === 'gateway') {
					configuration.baseUrl = 'https://new.example.test/v1';
					provider.invalidateCatalog('baseUrl');
				} else if (change === 'token') {
					provider.authManager.getApiKey = async () => undefined;
					provider.invalidateCatalog('token');
				} else {
					await provider.prepareForDeactivate();
				}
				if (change !== 'profile') assert.equal(calls[0].signal.aborted, true);
			} finally {
				release();
			}
			await flight;
			assert.equal(calls.length, 1);
			assert.deepEqual(writes, []);
			if (change === 'profile') assert.equal(configuration.modelProfiles.first.imageMode, 'none');
		},
	);
}

test('successful vision probes still enable eligible models and persist their results', async () => {
	const { provider, catalog, settings, release, calls, state } = visionFixture();
	release();
	await provider.autoRefreshNewModelVision(catalog, 'dummy', settings);
	assert.equal(calls.length, 2);
	assert.equal(configuration.modelProfiles.first.imageMode, 'native');
	assert.equal(configuration.modelProfiles.second.imageMode, 'native');
	assert.equal(Object.keys(state['open-copilot.nativeVisionChecks']).length, 4);
});

test('automatic vision probes send the model ID override to the upstream API', async () => {
	const { provider, catalog, settings, release, calls } = visionFixture({
		modelIdOverrides: { first: 'wire-first', second: 'wire-second' },
	});
	release();
	await provider.autoRefreshNewModelVision(catalog, 'dummy', settings);
	assert.deepEqual(
		calls.map((call) => call.model),
		['wire-first', 'wire-second'],
	);
});

test('a new catalog generation is drained after an old probe is cancelled', async () => {
	const { provider, catalog, settings, started, release, calls } = visionFixture();
	const flight = provider.autoRefreshNewModelVision(catalog, 'dummy', settings);
	await started;
	configuration.baseUrl = 'https://new.example.test/v1';
	provider.invalidateCatalog('baseUrl');
	const nextCatalog = { getModels: catalog.getModels, dispose: noop };
	provider.catalog = nextCatalog;
	const nextFlight = provider.autoRefreshNewModelVision(nextCatalog, 'dummy', getNewApiSettings());
	release();
	await Promise.all([flight, nextFlight]);
	assert.deepEqual(
		calls.map((call) => call.url),
		[
			'https://old.example.test/v1/chat/completions',
			'https://new.example.test/v1/chat/completions',
			'https://new.example.test/v1/chat/completions',
		],
	);
	assert.equal(configuration.modelProfiles.second.imageMode, 'native');
});
