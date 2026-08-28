const assert = require('node:assert/strict');
const test = require('node:test');

const { MemoryModelCache, ModelCatalog } = require('../out/models/catalog');
const { ProfileResolver } = require('../out/models/profile');

function remoteModel(id) {
	return {
		id,
		supportedEndpointTypes: ['openai'],
		metadataIncomplete: false,
	};
}

function waitFor(predicate, timeoutMs = 500) {
	const started = Date.now();
	return new Promise((resolve, reject) => {
		const check = async () => {
			try {
				if (await predicate()) {
					resolve();
					return;
				}
			} catch {
				// The condition may briefly observe an in-flight refresh.
			}
			if (Date.now() - started >= timeoutMs) {
				reject(new Error('Timed out waiting for ModelCatalog condition'));
				return;
			}
			setTimeout(() => void check(), 5);
		};
		void check();
	});
}

test('auto refresh discovers newly added models and emits a change event', async () => {
	let remote = [remoteModel('first')];
	let requests = 0;
	const client = {
		listModels: async () => {
			requests += 1;
			return remote;
		},
	};
	const catalog = new ModelCatalog({
		cache: new MemoryModelCache('catalog-test'),
		clientFactory: () => client,
		resolver: new ProfileResolver(),
		ttlMs: 60_000,
		autoRefreshMs: 10,
	});
	let changes = 0;
	const subscription = catalog.onDidChange(() => {
		changes += 1;
	});

	try {
		await catalog.getModels({ force: true });
		assert.deepEqual((await catalog.getModels()).map((model) => model.apiModelId), ['first']);
		const changesBefore = changes;
		remote = [remoteModel('first'), remoteModel('second')];
		await waitFor(async () => {
			const models = await catalog.getModels({ allowStale: true });
			return models.some((model) => model.apiModelId === 'second');
		});
		assert.ok(changes > changesBefore);
		assert.deepEqual(
			(await catalog.getModels({ force: false })).map((model) => model.apiModelId),
			['first', 'second'],
		);
		assert.ok(requests >= 2);
	} finally {
		subscription.dispose();
		catalog.dispose();
	}
});

test('auto refresh shares an in-flight request instead of creating overlapping requests', async () => {
	let requests = 0;
	let release;
	const client = {
		listModels: () => {
			requests += 1;
			return new Promise((resolve) => {
				release = () => resolve([remoteModel('slow')]);
			});
		},
	};
	const catalog = new ModelCatalog({
		cache: new MemoryModelCache('catalog-flight-test'),
		clientFactory: () => client,
		resolver: new ProfileResolver(),
		ttlMs: 60_000,
		autoRefreshMs: 5,
	});

	try {
		const first = catalog.refresh();
		await waitFor(() => requests === 1);
		await new Promise((resolve) => setTimeout(resolve, 30));
		assert.equal(requests, 1);
		release();
		await first;
	} finally {
		catalog.dispose();
	}
});

test('dispose stops future auto refresh requests', async () => {
	let requests = 0;
	const catalog = new ModelCatalog({
		cache: new MemoryModelCache('catalog-dispose-test'),
		clientFactory: () => ({
			listModels: async () => {
				requests += 1;
				return [remoteModel('one')];
			},
		}),
		resolver: new ProfileResolver(),
		ttlMs: 60_000,
		autoRefreshMs: 10,
	});

	await waitFor(() => requests > 0);
	catalog.dispose();
	const requestsAtDispose = requests;
	await new Promise((resolve) => setTimeout(resolve, 40));
	assert.equal(requests, requestsAtDispose);
});
