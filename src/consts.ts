import { DEEPSEEK_TOOLS_LIMIT } from './provider/tools/consts';
import type { ModelDefinition } from './types';

/**
 * Compile-time constants shared across the extension.
 *
 * These do NOT depend on the VS Code runtime (no workspace configuration,
 * no secrets API). For run-time settings reads see `config.ts`.
 */

/** VS Code configuration section prefix for all extension settings. */
export const CONFIG_SECTION = 'open-copilot';

/** Default local New API deployment URL (OpenAI-compatible `/v1` root). */
export const DEFAULT_NEW_API_BASE_URL = 'http://localhost:3000/v1';

export const EXTERNAL_URLS = {
	newapi: {
		home: 'https://github.com/QuantumNous/new-api',
		docs: 'https://docs.newapi.pro/',
		apiKeys: 'https://docs.newapi.pro/zh/docs/user/api-token',
	},
	deepseek: {
		apiKeys: 'https://platform.deepseek.com/api_keys',
		usage: 'https://platform.deepseek.com/usage',
		status: 'https://status.deepseek.com',
	},
} as const;

/** URI path handled by this extension to reveal the output log. */
export const SHOW_LOGS_URI_PATH = '/showLogs';

/** URI path handled by this extension to open API key configuration. */
export const CONFIGURE_API_KEY_URI_PATH = '/setApiKey';

/** URI path handled by this extension to open vision model configuration. */
export const SET_VISION_MODEL_URI_PATH = '/setVisionModel';

/** URI path handled by this extension to refresh the remote model catalog. */
export const REFRESH_MODELS_URI_PATH = '/refreshModels';

// VS Code's internal LanguageModelChatMessageRole.System is not exposed in @types/vscode.
export const LANGUAGE_MODEL_CHAT_SYSTEM_ROLE = 3;

// ---- Secret keys ----

/** SecretStorage key for the New API Bearer token. */
export const API_KEY_SECRET = 'open-copilot.apiKey';

/** SecretStorage keys used by the endpoint-based vision proxy. */
export const VISION_PROXY_CONFIG_KEY = 'open-copilot.visionProxy.config';
export const VISION_PROXY_SOURCE_KEY = 'open-copilot.visionProxy.source';
export const VISION_PROXY_API_KEY_SECRET = 'open-copilot.visionProxy.apiKey';

/** memento key tracking whether the welcome walkthrough has been shown. */
export const WELCOME_SHOWN_KEY = 'open-copilot.welcomeShown';

// ---- Walkthrough ----

/** Walkthrough contribution ID. */
export const WALKTHROUGH_ID = 'rongwei.open-copilot#openCopilotGettingStarted';

// ---- Model registry ----

/** Available DeepSeek models exposed through the language model provider. */
export const MODELS: ModelDefinition[] = [
	{
		id: 'deepseek-v4-flash',
		name: 'DeepSeek V4 Flash',
		family: 'deepseek',
		version: 'v4',
		detail: 'Fast, general-purpose model',
		maxInputTokens: 655360,
		maxOutputTokens: 393216,
		capabilities: {
			toolCalling: DEEPSEEK_TOOLS_LIMIT,
			// Flash uses the configured vision proxy rather than accepting image
			// parts itself, so it must not be shown as a native Vision model.
			imageInput: false,
			nativeImageInput: false,
			thinking: {
				supportedEfforts: ['low', 'high', 'max'],
				defaultEffort: 'high',
				canDisable: true,
			},
		},
		requiresThinkingParam: true,
		pricing: {
			USD: { cacheHitInput: 0.0028, cacheMissInput: 0.14, output: 0.28 },
			CNY: { cacheHitInput: 0.02, cacheMissInput: 1, output: 2 },
		},
		priceCategory: 'low',
	},
	{
		id: 'deepseek-v4-pro',
		name: 'DeepSeek V4 Pro',
		family: 'deepseek',
		version: 'v4',
		detail: 'Most capable reasoning model',
		maxInputTokens: 655360,
		maxOutputTokens: 393216,
		capabilities: {
			toolCalling: DEEPSEEK_TOOLS_LIMIT,
			// Pro uses the configured vision proxy rather than accepting image
			// parts itself, so it must not be shown as a native Vision model.
			imageInput: false,
			nativeImageInput: false,
			thinking: {
				supportedEfforts: ['low', 'high', 'max'],
				defaultEffort: 'high',
				canDisable: true,
			},
		},
		requiresThinkingParam: true,
		pricing: {
			USD: { cacheHitInput: 0.003625, cacheMissInput: 0.435, output: 0.87 },
			CNY: { cacheHitInput: 0.025, cacheMissInput: 3, output: 6 },
		},
		priceCategory: 'low',
	},
	{
		id: 'deepseek-v4-flash-vision-exp',
		name: 'DeepSeek V4 Flash Vision Exp',
		family: 'deepseek',
		version: 'v4',
		detail: 'Experimental native vision model',
		maxInputTokens: 655360,
		maxOutputTokens: 393216,
		capabilities: {
			toolCalling: DEEPSEEK_TOOLS_LIMIT,
			imageInput: true,
			nativeImageInput: true,
			thinking: {
				supportedEfforts: ['low', 'high', 'max'],
				defaultEffort: 'high',
				canDisable: true,
			},
		},
		requiresThinkingParam: true,
		pricing: {
			USD: { cacheHitInput: 0.0028, cacheMissInput: 0.14, output: 0.28 },
			CNY: { cacheHitInput: 0.02, cacheMissInput: 1, output: 2 },
		},
		priceCategory: 'low',
	},
];
