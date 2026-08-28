import { randomBytes } from 'node:crypto';
import vscode from 'vscode';
import {
	mergeModelManagerStrings,
	type ModelManagerPanelState,
	type ModelManagerPanelStrings,
} from './types';
import { getModelManagerPanelScript } from './script';
import { getModelManagerPanelStyle } from './style';

/**
 * Render the model manager as a self-contained, nonce-protected webview.
 * `strings` is deliberately an argument so the extension host can provide
 * localized copy without making this UI module depend on the i18n singleton.
 */
export function getModelManagerPanelHtml(
	webview: vscode.Webview,
	state: ModelManagerPanelState,
	strings: Partial<ModelManagerPanelStrings> = {},
): string {
	const nonce = createNonce();
	const mergedStrings: ModelManagerPanelStrings = mergeModelManagerStrings(strings);
	const language = vscode.env.language.toLowerCase();
	const htmlLang =
		language === 'zh-cn' ||
		language === 'zh-hans' ||
		language.startsWith('zh-hans-') ||
		language === 'zh-sg'
			? 'zh-CN'
			: 'en';
	const initialState = escapeScriptJson(normalizeInitialState(state));
	const initialStrings = escapeScriptJson(mergedStrings);
	const csp = [
		"default-src 'none'",
		"base-uri 'none'",
		"form-action 'none'",
		"object-src 'none'",
		`style-src 'nonce-${nonce}'`,
		`script-src 'nonce-${nonce}'`,
		`img-src ${webview.cspSource} data:`,
		"connect-src 'none'",
	].join('; ');

	return `<!DOCTYPE html>
<html lang="${htmlLang}">
<head>
	<meta charset="UTF-8">
	<meta http-equiv="Content-Security-Policy" content="${csp}">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<title>${escapeHtml(mergedStrings.title)}</title>
	<style nonce="${nonce}">${getModelManagerPanelStyle()}</style>
</head>
<body>
	<main>
		<header class="page-header">
			<div>
				<h1>${escapeHtml(mergedStrings.title)}</h1>
				<p class="description">${escapeHtml(mergedStrings.description)}</p>
			</div>
			<div class="actions" aria-label="${escapeHtml(mergedStrings.title)} actions">
				<button id="refresh" type="button">${escapeHtml(mergedStrings.refresh)}</button>
				<button id="testConnection" class="secondary" type="button">${escapeHtml(mergedStrings.testConnection)}</button>
				<button id="openSettings" class="quiet" type="button">${escapeHtml(mergedStrings.openSettings)}</button>
			</div>
		</header>

		<section id="connection" class="connection" aria-live="polite">
			<div class="connection-main">
				<span class="connection-dot" aria-hidden="true"></span>
				<span id="connectionTitle" class="connection-title"></span>
				<span id="connectionDetail" class="connection-detail"></span>
			</div>
			<div id="connectionMeta" class="connection-detail"></div>
			<div id="connectionError" class="connection-error" hidden></div>
		</section>

		<div class="layout">
			<aside class="sidebar" aria-label="${escapeHtml(mergedStrings.allModels)}">
				<div class="sidebar-toolbar">
					<input id="search" class="search" type="search" autocomplete="off" placeholder="${escapeHtml(mergedStrings.searchPlaceholder)}" aria-label="${escapeHtml(mergedStrings.searchPlaceholder)}">
					<div class="filter-row">
						<select id="filter" aria-label="${escapeHtml(mergedStrings.allModels)}">
							<option value="all">${escapeHtml(mergedStrings.filterAll)}</option>
							<option value="tools">${escapeHtml(mergedStrings.filterTools)}</option>
							<option value="vision">${escapeHtml(mergedStrings.filterVision)}</option>
							<option value="reasoning">${escapeHtml(mergedStrings.filterReasoning)}</option>
						</select>
					</div>
					<div id="modelCount" class="model-count"></div>
				</div>
				<ul id="modelList" class="model-list" role="listbox" aria-label="${escapeHtml(mergedStrings.allModels)}"></ul>
			</aside>

			<section class="detail" aria-live="polite">
				<div id="detailEmpty" class="detail-empty">${escapeHtml(mergedStrings.noSelection)}</div>
				<article id="detailContent" hidden>
					<header class="detail-header">
						<div class="detail-title">
							<h2 id="detailName"></h2>
							<p id="detailSubtitle" class="detail-subtitle"></p>
							<div id="detailBadges" class="badges"></div>
						</div>
						<div class="detail-actions">
							<span id="healthStatus" class="health"><span class="health-dot" aria-hidden="true"></span><span id="healthLabel"></span></span>
							<button id="healthCheck" class="secondary" type="button">${escapeHtml(mergedStrings.healthCheck)}</button>
							<button id="compatibilityCheck" class="secondary" type="button">${escapeHtml(mergedStrings.compatibilityCheck)}</button>
							<button id="selectModel" type="button">${escapeHtml(mergedStrings.selectModel)}</button>
						</div>
					</header>

					<div id="metaGrid" class="meta-grid"></div>

					<section class="section-card">
						<div class="section-heading"><h3>${escapeHtml(mergedStrings.capabilities)}</h3><span id="capabilitySource" class="hint"></span></div>
						<div id="capabilities" class="capabilities"></div>
					</section>

					<section class="section-card">
						<div class="section-heading"><h3>${escapeHtml(mergedStrings.protocols)}</h3></div>
						<div id="protocolList" class="source-list"></div>
					</section>

					<section class="section-card compatibility-card">
						<div class="section-heading"><h3>${escapeHtml(mergedStrings.compatibilityTitle)}</h3></div>
						<div class="compatibility-description">${escapeHtml(mergedStrings.compatibilityDescription)}</div>
						<div class="compatibility-options">
							<label><input id="compatibilityOptional" type="checkbox"> <span>${escapeHtml(mergedStrings.compatibilityOptional)}</span></label>
							<label><input id="compatibilityVision" type="checkbox"> <span>${escapeHtml(mergedStrings.compatibilityVision)}</span></label>
						</div>
						<div id="compatibilityReport" class="compatibility-report" aria-live="polite"><span class="hint">${escapeHtml(mergedStrings.compatibilityNoChecks)}</span></div>
					</section>

					<section class="section-card profile-editor">
						<div class="section-heading"><h3>${escapeHtml(mergedStrings.profile)}</h3></div>
						<div class="profile-hint">${escapeHtml(mergedStrings.profileHint)}</div>
						<label for="profileJson">${escapeHtml(mergedStrings.profile)}</label>
						<textarea id="profileJson" spellcheck="false" placeholder="${escapeHtml(mergedStrings.profilePlaceholder)}"></textarea>
						<div class="profile-actions">
							<button id="formatJson" class="secondary" type="button">${escapeHtml(mergedStrings.formatJson)}</button>
							<button id="saveProfile" type="button">${escapeHtml(mergedStrings.saveProfile)}</button>
							<button id="cancelProfile" class="quiet" type="button">${escapeHtml(mergedStrings.cancel)}</button>
						</div>
					</section>
				</article>
			</section>
		</div>
		<div id="status" class="status" role="status" aria-live="polite"></div>
	</main>
	<script nonce="${nonce}">${getModelManagerPanelScript(initialState, initialStrings)}</script>
</body>
</html>`;
}

function normalizeInitialState(state: ModelManagerPanelState): ModelManagerPanelState {
	return {
		...state,
		baseUrl: sanitizeBaseUrl(state.baseUrl),
		error: state.error
			? {
					...state.error,
					message:
						typeof state.error.message === 'string'
							? sanitizeMessage(state.error.message)
							: 'Model manager operation failed.',
				}
			: undefined,
		models: Array.isArray(state.models) ? state.models : [],
	};
}

/** Do not put URL query strings or embedded credentials into webview memory. */
function sanitizeBaseUrl(value: string | undefined): string | undefined {
	if (!value?.trim()) return undefined;
	try {
		const url = new URL(value);
		url.username = '';
		url.password = '';
		url.search = '';
		url.hash = '';
		return url.toString().replace(/\/$/u, '');
	} catch {
		return value.replace(/[?#].*$/u, '').replace(/\/[^/]*@/u, '/<redacted>@');
	}
}

function sanitizeMessage(value: string): string {
	return value
		.replace(/bearer\s+[^\s,;]+/giu, 'Bearer <redacted>')
		.replace(/\bsk-[a-z0-9._~-]+/giu, 'sk-<redacted>')
		.replace(/authorization\s*[:=]\s*[^\s,;]+/giu, 'Authorization: <redacted>')
		.replace(/\s+/gu, ' ')
		.trim()
		.slice(0, 512);
}

function createNonce(): string {
	return randomBytes(16).toString('base64');
}

function escapeScriptJson(value: unknown): string {
	return JSON.stringify(value)
		.replaceAll('<', '\\u003c')
		.replaceAll('\u2028', '\\u2028')
		.replaceAll('\u2029', '\\u2029');
}

function escapeHtml(value: string): string {
	return value
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;')
		.replaceAll("'", '&#39;');
}
