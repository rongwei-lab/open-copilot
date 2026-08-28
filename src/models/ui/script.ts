/**
 * Browser-side logic for the model manager. This is emitted as an inline
 * nonce-protected script by html.ts; all extension communication goes through
 * a small, explicitly validated message protocol.
 */
export function getModelManagerPanelScript(initialState: string, initialStrings: string): string {
	return `
		const vscode = acquireVsCodeApi();
		const initialState = ${initialState};
		const strings = ${initialStrings};
		const initialModels = Array.isArray(initialState.models) ? initialState.models : [];
		const initialActiveModel = initialModels.find(function (model) { return model && model.id === initialState.activeModelId; });
		const state = {
			current: initialState,
			selectedModelId: initialActiveModel ? initialActiveModel.id : (initialModels[0] && initialModels[0].id),
			filterText: '',
			filterKind: 'all',
			profileDirty: false,
			busy: false,
			pendingOperation: undefined,
			operationTimer: undefined,
			healthByModel: Object.create(null),
			compatibilityByModel: Object.create(null),
		};

		const connection = document.getElementById('connection');
		const connectionTitle = document.getElementById('connectionTitle');
		const connectionDetail = document.getElementById('connectionDetail');
		const connectionMeta = document.getElementById('connectionMeta');
		const connectionError = document.getElementById('connectionError');
		const refreshButton = document.getElementById('refresh');
		const testConnectionButton = document.getElementById('testConnection');
		const openSettingsButton = document.getElementById('openSettings');
		const searchInput = document.getElementById('search');
		const filterSelect = document.getElementById('filter');
		const modelCount = document.getElementById('modelCount');
		const modelList = document.getElementById('modelList');
		const detailEmpty = document.getElementById('detailEmpty');
		const detailContent = document.getElementById('detailContent');
		const detailName = document.getElementById('detailName');
		const detailSubtitle = document.getElementById('detailSubtitle');
		const detailBadges = document.getElementById('detailBadges');
		const healthStatus = document.getElementById('healthStatus');
		const healthLabel = document.getElementById('healthLabel');
		const healthCheckButton = document.getElementById('healthCheck');
		const compatibilityCheckButton = document.getElementById('compatibilityCheck');
		const compatibilityOptional = document.getElementById('compatibilityOptional');
		const compatibilityVision = document.getElementById('compatibilityVision');
		const compatibilityReport = document.getElementById('compatibilityReport');
		const selectModelButton = document.getElementById('selectModel');
		const metaGrid = document.getElementById('metaGrid');
		const capabilities = document.getElementById('capabilities');
		const capabilitySource = document.getElementById('capabilitySource');
		const protocolList = document.getElementById('protocolList');
		const profileJson = document.getElementById('profileJson');
		const formatJsonButton = document.getElementById('formatJson');
		const saveProfileButton = document.getElementById('saveProfile');
		const cancelProfileButton = document.getElementById('cancelProfile');
		const status = document.getElementById('status');

		function text(value) {
			return value === undefined || value === null ? '' : String(value);
		}

		function formatString(template, ...args) {
			return text(template).replace(/\\{(\\d+)\\}/g, function (match, index) {
				return Object.prototype.hasOwnProperty.call(args, index) ? text(args[index]) : match;
			});
		}

		function isRecord(value) {
			return value !== null && typeof value === 'object' && !Array.isArray(value);
		}

		function normalizeState(value) {
			if (!isRecord(value)) return { models: [] };
			const models = Array.isArray(value.models) ? value.models.filter(function (model) {
				return isRecord(model) && typeof model.id === 'string' && model.id.trim().length > 0;
			}) : [];
			return Object.assign({}, value, { models: models });
		}

		function normalizeModel(value) {
			if (!isRecord(value) || typeof value.id !== 'string' || !value.id.trim()) return undefined;
			return value;
		}

		function getModel(modelId) {
			const models = state.current.models || [];
			return models.find(function (model) { return model.id === modelId; }) || undefined;
		}

		function currentModel() {
			return getModel(state.selectedModelId);
		}

		function post(message) {
			// Do not forward arbitrary DOM values. Message construction is kept at
			// the call sites and profile values are validated before this function.
			try { void vscode.postMessage(message); } catch (error) { setStatus(text(error), 'error'); }
		}

		function setStatus(message, tone) {
			status.textContent = text(message);
			status.className = 'status' + (tone ? ' ' + tone : '');
		}

		function setBusy(value, message) {
			state.busy = Boolean(value);
			refreshButton.disabled = state.busy;
			testConnectionButton.disabled = state.busy;
			healthCheckButton.disabled = state.busy || !currentModel();
			compatibilityCheckButton.disabled = state.busy || !currentModel();
			selectModelButton.disabled = state.busy || !currentModel();
			saveProfileButton.disabled = state.busy || !currentModel();
			if (message) setStatus(message, '');
		}

		function formatDate(value) {
			if (!Number.isFinite(Number(value)) || Number(value) <= 0) return strings.unknown;
			try { return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(Number(value))); }
			catch { return new Date(Number(value)).toLocaleString(); }
		}

		function formatBaseUrl(value) {
			const raw = text(value).trim();
			if (!raw) return '';
			try {
				const parsed = new URL(raw);
				parsed.username = '';
				parsed.password = '';
				parsed.search = '';
				parsed.hash = '';
				return parsed.toString().replace(/\\/$/, '');
			} catch {
				return raw.split(/[?#]/, 1)[0];
			}
		}

		function formatNumber(value) {
			if (!Number.isFinite(Number(value)) || Number(value) <= 0) return strings.unknown;
			return Number(value).toLocaleString();
		}

		function formatContext(model) {
			const input = Number(model.maxInputTokens);
			const output = Number(model.maxOutputTokens);
			if (!Number.isFinite(input) && !Number.isFinite(output)) return strings.unknown;
			return formatNumber(input) + ' / ' + formatNumber(output);
		}

		function appendBadge(parent, label, kind) {
			const badge = document.createElement('span');
			badge.className = 'badge' + (kind ? ' ' + kind : '');
			badge.textContent = text(label);
			parent.appendChild(badge);
			return badge;
		}

		function appendMeta(label, value, code) {
			const item = document.createElement('div');
			item.className = 'meta-item';
			const name = document.createElement('div');
			name.className = 'meta-label';
			name.textContent = text(label);
			const content = document.createElement('div');
			content.className = 'meta-value';
			if (code) {
				const codeNode = document.createElement('code');
				codeNode.textContent = text(value) || strings.unknown;
				content.appendChild(codeNode);
			} else {
				content.textContent = text(value) || strings.unknown;
			}
			item.appendChild(name);
			item.appendChild(content);
			metaGrid.appendChild(item);
		}

		function capabilityValue(model, key) {
			const caps = isRecord(model.capabilities) ? model.capabilities : {};
			const actualKey = key === 'tools' ? 'toolCalling' : key === 'parallelTools' ? 'parallelToolCalls' : key;
			if (key === 'reasoning') {
				if (typeof caps.reasoning === 'boolean') return caps.reasoning;
				if (!isRecord(caps.reasoning) || typeof caps.reasoning.enabled !== 'boolean') return undefined;
				return caps.reasoning.enabled;
			}
			if (typeof caps[actualKey] === 'boolean') return caps[actualKey];
			return undefined;
		}

		function capabilitySourceFor(model, key) {
			const caps = isRecord(model.capabilities) ? model.capabilities : {};
			const sources = isRecord(caps.sources) ? caps.sources : {};
			return typeof sources[key] === 'string' ? sources[key] : '';
		}

		function sourceLabel(value) {
			const normalized = text(value).toLowerCase();
			if (normalized === 'gateway') return strings.fromGateway;
			if (normalized === 'profile') return strings.fromProfile;
			if (normalized === 'name-heuristic' || normalized === 'heuristic') return strings.fromHeuristic;
			if (normalized === 'builtin' || normalized === 'built-in') return strings.fromBuiltin;
			if (normalized === 'probe') return strings.fromProbe;
			return value ? text(value) : strings.fromUnknown;
		}

		function capabilityLabel(key, model) {
			if (key === 'tools') return strings.tools;
			if (key === 'parallelTools') return strings.parallelTools;
			if (key === 'reasoning') return strings.reasoning;
			const mode = isRecord(model.capabilities) ? text(model.capabilities.imageMode).toLowerCase() : '';
			if (mode === 'native') return strings.visionNative;
			if (mode === 'proxy') return strings.visionProxy;
			if (mode === 'auto') return strings.visionAuto;
			return strings.visionNone;
		}

		function visionProbeStatusLabel(probe) {
			if (!isRecord(probe)) return '';
			if (probe.status === 'pass') return probe.applied === true ? strings.compatibilityNativeApplied : strings.compatibilityPass;
			if (probe.status === 'warn') return strings.compatibilityCheckVision + ' · ' + strings.compatibilityWarn;
			if (probe.status === 'fail') return strings.compatibilityCheckVision + ' · ' + strings.compatibilityFail;
			return strings.compatibilityCheckVision + ' · ' + strings.compatibilitySkip;
		}

		function appendVisionProbeBadge(parent, model) {
			const probe = isRecord(model.visionProbe) ? model.visionProbe : undefined;
			if (!probe || typeof probe.status !== 'string') return;
			const kind = probe.status === 'pass' ? 'active' : probe.status === 'fail' ? 'error' : probe.status === 'warn' ? 'stale' : 'info';
			const badge = appendBadge(parent, visionProbeStatusLabel(probe), kind);
			if (Number.isFinite(Number(probe.checkedAt))) badge.title = strings.lastUpdated + ': ' + formatDate(probe.checkedAt);
		}

		function renderConnection() {
			const current = state.current || { models: [] };
			if (current.loading) {
				connection.className = 'connection warning';
				connectionTitle.textContent = strings.loading;
				connectionDetail.textContent = strings.statusRefreshing;
				connectionMeta.textContent = '';
				connectionError.hidden = true;
				connectionError.textContent = '';
				return;
			}
			const hasUrl = Boolean(text(current.baseUrl).trim());
			const hasKey = current.hasApiKey === true;
			const hasError = isRecord(current.error) && Boolean(text(current.error.message));
			connection.className = 'connection ' + (hasError ? 'error' : (hasUrl && hasKey && !current.stale ? 'success' : 'warning'));
			connectionTitle.textContent = hasError ? strings.statusError : (hasUrl && hasKey ? strings.statusReady : strings.apiKeyMissing);
			const detailParts = [];
			if (hasUrl) detailParts.push(formatBaseUrl(current.baseUrl));
			detailParts.push(hasKey ? strings.apiKeyConfigured : strings.apiKeyMissing);
			connectionDetail.textContent = detailParts.join(' · ');
			const metaParts = current.fetchedAt ? [strings.lastUpdated + ': ' + formatDate(current.fetchedAt)] : [];
			if (isRecord(current.error) && typeof current.error.status === 'number') metaParts.push('HTTP ' + String(current.error.status));
			if (isRecord(current.error) && typeof current.error.requestId === 'string' && current.error.requestId) metaParts.push('Request ' + current.error.requestId);
			connectionMeta.textContent = metaParts.join(' · ');
			connectionError.hidden = !hasError;
			connectionError.textContent = hasError ? text(current.error.message) : '';
		}

		function modelMatches(model) {
			const query = state.filterText.trim().toLowerCase();
			const haystack = [model.id, model.apiModelId, model.displayName, model.family, model.version]
				.map(text).join(' ').toLowerCase();
			if (query && !haystack.includes(query)) return false;
			if (state.filterKind === 'tools' && capabilityValue(model, 'tools') !== true) return false;
			if (state.filterKind === 'vision') {
				const mode = isRecord(model.capabilities) ? text(model.capabilities.imageMode).toLowerCase() : '';
				if (!mode || mode === 'none') return false;
			}
			if (state.filterKind === 'reasoning' && capabilityValue(model, 'reasoning') !== true) return false;
			return true;
		}

		function renderList() {
			modelList.textContent = '';
			if (state.current.loading) {
				const loading = document.createElement('li');
				loading.className = 'model-list-empty';
				loading.textContent = strings.loading;
				modelList.appendChild(loading);
				modelCount.textContent = '';
				return;
			}
			const models = (state.current.models || []).filter(modelMatches);
			modelCount.textContent = formatString(strings.modelCount, models.length);
			if (!models.length) {
				const empty = document.createElement('li');
				empty.className = 'model-list-empty';
				empty.textContent = (state.current.models || []).length ? strings.noModels : strings.noModels;
				modelList.appendChild(empty);
				return;
			}
			for (const model of models) {
				const item = document.createElement('li');
				const button = document.createElement('button');
				button.type = 'button';
				button.className = 'model-item' + (model.id === state.selectedModelId ? ' active' : '');
				button.setAttribute('role', 'option');
				button.setAttribute('aria-selected', model.id === state.selectedModelId ? 'true' : 'false');
				button.dataset.modelId = model.id;
				const textColumn = document.createElement('span');
				textColumn.style.minWidth = '0';
				const name = document.createElement('span');
				name.className = 'model-item-name';
				name.textContent = text(model.displayName || model.id);
				const id = document.createElement('span');
				id.className = 'model-item-id';
				id.textContent = text(model.apiModelId || model.id);
				textColumn.appendChild(name);
				textColumn.appendChild(id);
				const badges = document.createElement('span');
				badges.className = 'model-item-badges';
				if (model.id === state.current.activeModelId) appendBadge(badges, strings.selected, 'active');
				if (model.source && model.source.fromStaleCache || model.fromStaleCache || state.current.stale) appendBadge(badges, strings.stale, 'stale');
				if (model.source && model.source.metadataIncomplete) appendBadge(badges, strings.metadataIncomplete, 'info');
				appendVisionProbeBadge(badges, model);
				button.appendChild(textColumn);
				button.appendChild(badges);
				button.addEventListener('click', function () { selectLocalModel(model.id); });
				item.appendChild(button);
				modelList.appendChild(item);
			}
		}

		function selectLocalModel(modelId) {
			if (!getModel(modelId) || modelId === state.selectedModelId) {
				if (modelId === state.selectedModelId) renderDetails();
				return;
			}
			if (state.profileDirty && !window.confirm(strings.confirmDiscard)) return;
			state.profileDirty = false;
			state.selectedModelId = modelId;
			renderList();
			renderDetails();
		}

		function renderDetails() {
			const model = currentModel();
			if (!model) {
				detailEmpty.hidden = false;
				detailContent.hidden = true;
				healthCheckButton.disabled = true;
				compatibilityCheckButton.disabled = true;
				selectModelButton.disabled = true;
				saveProfileButton.disabled = true;
				return;
			}
			detailEmpty.hidden = true;
			detailContent.hidden = false;
			detailName.textContent = text(model.displayName || model.id);
			detailSubtitle.textContent = text(model.family || '') + (model.version ? ' · ' + text(model.version) : '');
			detailBadges.textContent = '';
			if (model.id === state.current.activeModelId) appendBadge(detailBadges, strings.selected, 'active');
			if (model.source && model.source.fromStaleCache || model.fromStaleCache || state.current.stale) appendBadge(detailBadges, strings.stale, 'stale');
			if (model.source && model.source.metadataIncomplete) appendBadge(detailBadges, strings.metadataIncomplete, 'info');
			appendVisionProbeBadge(detailBadges, model);
			appendBadge(detailBadges, text(model.selectedProtocol || (model.protocols && model.protocols[0]) || strings.unknown), 'info');
			metaGrid.textContent = '';
			appendMeta(strings.modelId, model.id, true);
			appendMeta(strings.apiModelId, model.apiModelId || model.id, true);
			appendMeta(strings.family, model.family);
			appendMeta(strings.version, model.version);
			appendMeta(strings.contextWindow, formatContext(model));
			appendMeta(strings.inputTokens, formatNumber(model.maxInputTokens));
			appendMeta(strings.outputTokens, formatNumber(model.maxOutputTokens));
			const source = model.source || {};
			appendMeta(strings.endpointTypes, (source.endpointTypes || []).join(', ') || strings.unknown);
			appendMeta(strings.profileSources, (source.profileIds || []).join(', ') || strings.fromUnknown);
			const reasoning = isRecord(model.capabilities) && isRecord(model.capabilities.reasoning)
				? model.capabilities.reasoning
				: undefined;
			if (reasoning && reasoning.enabled) {
				const efforts = Array.isArray(reasoning.efforts) ? reasoning.efforts.slice() : [];
				if (reasoning.canDisable === true && !efforts.some(function (effort) { return text(effort).toLowerCase() === 'none'; })) efforts.unshift('none');
				const defaultEffort = typeof reasoning.defaultEffort === 'string' && reasoning.defaultEffort ? ' · ' + reasoning.defaultEffort : '';
				appendMeta(strings.reasoning, (efforts.join(', ') || strings.unknown) + defaultEffort);
			}
			renderCapabilities(model);
			renderProtocols(model);
			renderHealth(model);
			renderCompatibility(model);
			if (!state.profileDirty) renderProfile(model);
			healthCheckButton.disabled = state.busy;
			compatibilityCheckButton.disabled = state.busy;
			selectModelButton.disabled = state.busy || model.id === state.current.activeModelId;
			saveProfileButton.disabled = state.busy;
		}

		function renderCapabilities(model) {
			capabilities.textContent = '';
			const keys = ['tools', 'parallelTools', 'vision', 'reasoning'];
			for (const key of keys) {
				const mode = isRecord(model.capabilities) ? text(model.capabilities.imageMode).toLowerCase() : '';
				const value = key === 'vision'
					? (mode ? mode !== 'none' : undefined)
					: capabilityValue(model, key === 'tools' ? 'tools' : key);
				const known = key === 'vision' ? ['none', 'native', 'proxy', 'auto'].includes(mode) : value !== undefined;
				const chip = document.createElement('span');
				chip.className = 'capability ' + (value === true ? 'enabled' : known ? '' : 'unknown');
				const label = document.createElement('span');
				label.textContent = known ? capabilityLabel(key, model) : capabilityLabel(key, model) + ' · ' + strings.unknownCapability;
				chip.appendChild(label);
				const source = capabilitySourceFor(model, key === 'tools' ? 'toolCalling' : key === 'parallelTools' ? 'parallelToolCalls' : key === 'vision' ? 'imageMode' : key);
				if (source) chip.title = sourceLabel(source);
				capabilities.appendChild(chip);
			}
			const sources = isRecord(model.capabilities) && isRecord(model.capabilities.sources) ? Object.values(model.capabilities.sources).filter(function (value) { return typeof value === 'string'; }).map(sourceLabel) : [];
			capabilitySource.textContent = sources.length ? Array.from(new Set(sources)).join(' · ') : '';
		}

		function renderProtocols(model) {
			protocolList.textContent = '';
			const protocols = Array.isArray(model.protocols) ? model.protocols : [];
			if (!protocols.length) {
				protocolList.textContent = strings.unknown;
				return;
			}
			for (const protocol of protocols) appendBadge(protocolList, text(protocol) + (protocol === model.selectedProtocol ? ' · ' + strings.selected : ''), protocol === model.selectedProtocol ? 'active' : 'info');
		}

		function healthFor(model) {
			return state.healthByModel[model.id] || model.health;
		}
		function renderHealth(model) {
			const result = healthFor(model);
			healthStatus.className = 'health' + (result ? (result.ok ? ' healthy' : ' unhealthy') : '');
			if (result) {
				const details = [result.ok ? strings.healthHealthy : strings.healthUnhealthy];
				if (Number.isFinite(Number(result.latencyMs))) details.push(String(Math.max(0, Number(result.latencyMs))) + ' ms');
				if (Number.isFinite(Number(result.status))) details.push('HTTP ' + String(result.status));
				healthLabel.textContent = details.join(' · ');
			} else {
				healthLabel.textContent = strings.healthUnknown;
			}
			if (result && (result.message || result.requestId || result.responseModel)) {
				healthLabel.title = [result.message, result.protocol, result.responseModel, result.requestId]
					.filter(Boolean).map(text).join(' · ');
			}
			else healthLabel.removeAttribute('title');
		}

		function compatibilityFor(model) {
			return state.compatibilityByModel[model.id];
		}

		function compatibilityCheckLabel(id) {
			const labels = {
				chat: strings.compatibilityCheckChat,
				stream: strings.compatibilityCheckStream,
				usage: strings.compatibilityCheckUsage,
				tools: strings.compatibilityCheckTools,
				'parallel-tools': strings.compatibilityCheckParallelTools,
				reasoning: strings.compatibilityCheckReasoning,
				responses: strings.compatibilityCheckResponses,
				vision: strings.compatibilityCheckVision,
			};
			return labels[id] || text(id);
		}

		function compatibilityStatusLabel(statusValue) {
			if (statusValue === 'pass') return strings.compatibilityPass;
			if (statusValue === 'fail') return strings.compatibilityFail;
			if (statusValue === 'warn') return strings.compatibilityWarn;
			return strings.compatibilitySkip;
		}

		function compatibilityDetailLabel(key) {
			const labels = {
				frames: strings.compatibilityFrames,
				responseChars: strings.compatibilityResponseChars,
				tokensPerSecond: strings.compatibilityTokensPerSecond,
				outputTokens: strings.compatibilityUsage,
				usageReported: strings.compatibilityUsage,
			};
			return labels[key] || text(key);
		}

		function renderCompatibility(model) {
			compatibilityReport.textContent = '';
			const report = compatibilityFor(model);
			if (!report || !Array.isArray(report.checks) || !report.checks.length) {
				const empty = document.createElement('span');
				empty.className = 'hint';
				empty.textContent = strings.compatibilityNoChecks;
				compatibilityReport.appendChild(empty);
				return;
			}
			const summary = document.createElement('div');
			summary.className = 'compatibility-summary ' + (report.passed === true ? 'passed' : 'failed');
			summary.textContent = report.passed === true ? strings.compatibilityReportPassed : strings.compatibilityReportFailed;
			compatibilityReport.appendChild(summary);
			if (report.visionProfileApplied === true) {
				const applied = document.createElement('div');
				applied.className = 'compatibility-summary passed';
				applied.textContent = strings.compatibilityNativeApplied;
				compatibilityReport.appendChild(applied);
			} else if (report.visionProfileError) {
				const failed = document.createElement('div');
				failed.className = 'compatibility-summary failed';
				failed.textContent = strings.compatibilityNativeApplyFailed + ' ' + text(report.visionProfileError);
				compatibilityReport.appendChild(failed);
			}
			for (const check of report.checks) {
				if (!isRecord(check)) continue;
				const row = document.createElement('div');
				row.className = 'compatibility-row ' + text(check.status || 'skip');
				const name = document.createElement('span');
				name.className = 'compatibility-name';
				name.textContent = compatibilityCheckLabel(check.id);
				const badge = document.createElement('span');
				badge.className = 'badge ' + (check.status === 'pass' ? 'active' : check.status === 'fail' ? 'error' : check.status === 'warn' ? 'stale' : 'info');
				badge.textContent = compatibilityStatusLabel(check.status);
				const detail = document.createElement('span');
				detail.className = 'compatibility-detail';
				const parts = [];
				if (Number.isFinite(Number(check.latencyMs))) parts.push(strings.compatibilityLatency + ': ' + Math.max(0, Number(check.latencyMs)) + ' ms');
				if (Number.isFinite(Number(check.firstTokenMs))) parts.push(strings.compatibilityFirstToken + ': ' + Math.max(0, Number(check.firstTokenMs)) + ' ms');
				if (Number.isFinite(Number(check.httpStatus))) parts.push(strings.compatibilityHttp + ' ' + Number(check.httpStatus));
				if (check.usage && Number.isFinite(Number(check.usage.totalTokens))) parts.push(strings.compatibilityUsage + ': ' + Number(check.usage.totalTokens) + ' tokens');
				detail.textContent = parts.join(' · ');
				row.appendChild(name);
				row.appendChild(badge);
				row.appendChild(detail);
				if (check.message || check.requestId || check.responseModel || check.details) {
					const explanation = document.createElement('div');
					explanation.className = 'compatibility-explanation';
					const explanationParts = [text(check.message)];
					if (check.requestId) explanationParts.push(strings.compatibilityRequestId + ': ' + text(check.requestId));
					if (check.responseModel) explanationParts.push('model: ' + text(check.responseModel));
					if (check.details && isRecord(check.details)) {
						for (const [key, value] of Object.entries(check.details)) explanationParts.push(compatibilityDetailLabel(key) + ': ' + text(value));
					}
					explanation.textContent = explanationParts.filter(Boolean).join(' · ');
					row.appendChild(explanation);
				}
				compatibilityReport.appendChild(row);
			}
		}

		function renderProfile(model) {
			try { profileJson.value = JSON.stringify(isRecord(model.profile) ? model.profile : {}, null, 2); }
			catch { profileJson.value = '{}'; }
		}

		function readProfile() {
			const raw = text(profileJson.value).trim();
			if (!raw) return {};
			if (raw.length > 64 * 1024) throw new Error(strings.invalidProfile);
			let parsed;
			try { parsed = JSON.parse(raw); } catch { throw new Error(strings.invalidProfile); }
			if (!isRecord(parsed)) throw new Error(strings.invalidProfile);
			if (getDepth(parsed) > 8) throw new Error(strings.invalidProfile);
			if (containsSecretField(parsed)) throw new Error(strings.invalidProfile);
			return parsed;
		}

		function getDepth(value, depth) {
			const currentDepth = depth || 0;
			if (!isRecord(value) && !Array.isArray(value)) return currentDepth;
			let max = currentDepth;
			for (const child of Object.values(value)) max = Math.max(max, getDepth(child, currentDepth + 1));
			return max;
		}

		function containsSecretField(value) {
			if (Array.isArray(value)) return value.some(containsSecretField);
			if (!isRecord(value)) return false;
			for (const key of Object.keys(value)) {
				if (key === '__proto__' || key === 'constructor' || key === 'prototype') return true;
				if (/^(authorization|proxy-authorization|cookie|set-cookie|api[-_]?key|token|secret|password)$/i.test(key)) return true;
				if (containsSecretField(value[key])) return true;
			}
			return false;
		}

		function markProfileDirty() {
			state.profileDirty = true;
		}
		function resetProfile() {
			const model = currentModel();
			if (model) renderProfile(model);
			state.profileDirty = false;
		}

		function startOperation(kind, message, busyText) {
			if (state.busy) return;
			state.pendingOperation = kind;
			setBusy(true, busyText);
			if (state.operationTimer) window.clearTimeout(state.operationTimer);
			// The diagnostic runner caps each individual probe at 30 seconds. With
			// optional reasoning/parallel checks and the opt-in vision request, six
			// probes can run sequentially; leave headroom for response cleanup so the
			// webview does not unlock while the extension host is still busy.
			const operationTimeout = kind === 'compatibilityCheck' ? 300000 : 60000;
			state.operationTimer = window.setTimeout(function () {
				finishOperation(strings.statusError, 'error');
			}, operationTimeout);
			post(message);
		}

		function finishOperation(message, tone) {
			if (state.operationTimer) window.clearTimeout(state.operationTimer);
			state.operationTimer = undefined;
			state.pendingOperation = undefined;
			setBusy(false);
			if (message) setStatus(message, tone || '');
			renderConnection();
			renderList();
			renderDetails();
		}

		refreshButton.addEventListener('click', function () {
			startOperation('refresh', { type: 'refresh' }, strings.statusRefreshing);
		});
		testConnectionButton.addEventListener('click', function () {
			startOperation('testConnection', { type: 'testConnection' }, strings.statusTesting);
		});
		openSettingsButton.addEventListener('click', function () { post({ type: 'openSettings' }); });
		healthCheckButton.addEventListener('click', function () {
			const model = currentModel();
			if (!model) return;
			startOperation('healthCheck', { type: 'healthCheck', modelId: model.id }, strings.healthChecking);
		});
		compatibilityCheckButton.addEventListener('click', function () {
			const model = currentModel();
			if (!model) return;
			const includeVision = compatibilityVision.checked === true;
			startOperation(
				'compatibilityCheck',
				{
					type: 'compatibilityCheck',
					modelId: model.id,
					includeOptional: compatibilityOptional.checked === true,
					includeVision,
				},
				strings.compatibilityChecking,
			);
		});
		selectModelButton.addEventListener('click', function () {
			const model = currentModel();
			if (!model || model.id === state.current.activeModelId) return;
			startOperation('selectModel', { type: 'selectModel', modelId: model.id }, strings.statusSelected);
		});
		formatJsonButton.addEventListener('click', function () {
			try {
				profileJson.value = JSON.stringify(readProfile(), null, 2);
				state.profileDirty = true;
				setStatus(strings.statusReady, '');
			} catch (error) { setStatus(text(error.message || error), 'error'); }
		});
		profileJson.addEventListener('input', markProfileDirty);
		cancelProfileButton.addEventListener('click', function () {
			if (state.profileDirty && !window.confirm(strings.confirmDiscard)) return;
			resetProfile();
			setStatus(strings.statusReady, '');
		});
		saveProfileButton.addEventListener('click', function () {
			const model = currentModel();
			if (!model) return;
			let profile;
			try { profile = readProfile(); } catch (error) { setStatus(text(error.message || error), 'error'); return; }
			startOperation('saveProfile', { type: 'saveProfile', modelId: model.id, profile: profile }, strings.statusSaving);
		});
		searchInput.addEventListener('input', function () { state.filterText = text(searchInput.value); renderList(); });
		filterSelect.addEventListener('change', function () { state.filterKind = text(filterSelect.value) || 'all'; renderList(); });

		window.addEventListener('message', function (event) {
			const message = event.data;
			if (!isRecord(message) || typeof message.type !== 'string') return;
			if (message.type === 'state') {
				const next = normalizeState(message.value);
				const operationCompleted = typeof message.operation === 'string' && message.operation === state.pendingOperation;
				const selectedStillExists = next.models.some(function (model) { return model.id === state.selectedModelId; });
				state.current = next;
				if (operationCompleted && state.pendingOperation === 'saveProfile') state.profileDirty = false;
				if (!selectedStillExists) state.selectedModelId = next.activeModelId || (next.models[0] && next.models[0].id);
				if (!state.profileDirty) renderAll(); else { renderConnection(); renderList(); renderDetails(); }
				if (operationCompleted) finishOperation(undefined, '');
				return;
			}
			if (message.type === 'status') {
				const value = isRecord(message.value) ? message.value : {};
				const tone = value.tone === 'error' || value.error ? 'error' : value.tone === 'success' || value.success ? 'success' : value.tone === 'warning' ? 'warning' : '';
				const messageText = text(value.message) || strings.statusReady;
				if (!state.pendingOperation || tone === 'error' || tone === 'success' || tone === 'warning') {
					finishOperation(messageText, tone);
				} else {
					setStatus(messageText, tone);
				}
				return;
			}
			if (message.type === 'healthResult') {
				const value = isRecord(message.value) ? message.value : {};
				const modelId = typeof value.modelId === 'string' ? value.modelId : state.selectedModelId;
				if (modelId) state.healthByModel[modelId] = value;
				const result = value.ok === true ? strings.statusHealthPassed : strings.statusHealthFailed;
				finishOperation(result, value.ok === true ? 'success' : 'error');
				renderDetails();
				return;
			}
			if (message.type === 'compatibilityResult') {
				const value = isRecord(message.value) ? message.value : {};
				const modelId = typeof value.modelId === 'string' ? value.modelId : state.selectedModelId;
				if (modelId) state.compatibilityByModel[modelId] = value;
				const passed = value.passed === true;
				finishOperation(passed ? strings.compatibilityReportPassed : strings.compatibilityReportFailed, passed ? 'success' : 'warning');
				renderDetails();
				return;
			}
			if (message.type === 'testResult') {
				const value = isRecord(message.value) ? message.value : {};
				const details = [];
				if (Number.isFinite(Number(value.modelCount))) details.push(formatString(strings.modelCount, value.modelCount));
				if (Number.isFinite(Number(value.latencyMs))) details.push(String(Math.max(0, Number(value.latencyMs))) + ' ms');
				if (Array.isArray(value.endpointTypes) && value.endpointTypes.length) details.push(strings.endpointTypes + ': ' + value.endpointTypes.map(text).join(', '));
				const messageText = text(value.message) || (value.ok === true ? strings.statusReady : strings.statusError);
				finishOperation([messageText, ...details].join(' · '), value.ok === true ? 'success' : 'error');
			}
		});

		function renderAll() {
			renderConnection();
			renderList();
			renderDetails();
		}
		renderAll();
	`;
}
