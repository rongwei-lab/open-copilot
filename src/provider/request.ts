import vscode from 'vscode';
import { AuthManager } from '../auth';
import { OpenAICompatibleClient } from '../client/openai-compatible';
import { getApiModelId, getMaxTokens, type NewApiSettings } from '../config';
import { MODELS } from '../consts';
import { t } from '../i18n';
import {
	DEFAULT_MAX_INPUT_TOKENS,
	DEFAULT_MAX_OUTPUT_TOKENS,
	toChatModelProfile,
	toModelDefinition,
} from '../models';
import type { ResolvedModel } from '../models';
import type { ChatModelProfile, StreamUsageMode } from '../newapi';
import type { ModelDefinition } from '../types';
import type { DeepSeekMessage, DeepSeekRequest } from '../types';
import { convertMessages, countMessageChars } from './convert';
import {
	dumpDeepSeekRequest,
	type CacheDiagnosticsRecorder,
	type CacheDiagnosticsRun,
} from './debug';
import { getConfiguredThinkingEffort, type ModelConfigurationOptions } from './models';
import type { ReplayMarkerMetadata } from './replay';
import { classifyDeepSeekRequest, shouldForceThinkingNone, type RequestKind } from './routing';
import type { ConversationSegment } from './segment';
import { collectTrailingToolResultIds, prepareRequestTools } from './tools/request';
import type { VisionResolutionResult, VisionResolutionStats } from './vision';
import { resolveImageMessages, type VisionDescriber } from './vision';

export interface PreparedChatRequest {
	client: OpenAICompatibleClient;
	request: DeepSeekRequest;
	isThinkingModel: boolean;
	protocol: 'chat-completions' | 'responses';
	allowProtocolFallback: boolean;
	responsesStore?: boolean;
	responsesTruncation?: 'auto' | 'disabled';
	totalRequestChars: number;
	hasNativeImages: boolean;
	trailingToolResultIds: string[];
	cacheDiagnostics: CacheDiagnosticsRun;
	requestKind: RequestKind;
	segment: ConversationSegment;
	replayMarkerMetadata: ReplayMarkerMetadata;
	visionMarkerTextChars?: number;
	initialResponseNotice?: string;
}

export interface PrepareChatRequestOptions {
	authManager: AuthManager;
	globalStorageUri: vscode.Uri;
	modelInfo: vscode.LanguageModelChatInformation;
	segment: ConversationSegment;
	messages: readonly vscode.LanguageModelChatRequestMessage[];
	options: vscode.ProvideLanguageModelChatResponseOptions;
	token: vscode.CancellationToken;
	cacheDiagnostics: CacheDiagnosticsRecorder;
	getVisionDescriber: () => Promise<VisionDescriber | undefined>;
	resolvedModel?: ResolvedModel;
	settings: NewApiSettings;
}

export async function prepareChatRequest({
	authManager,
	globalStorageUri,
	modelInfo,
	segment,
	messages,
	options,
	token,
	cacheDiagnostics,
	getVisionDescriber,
	resolvedModel,
	settings,
}: PrepareChatRequestOptions): Promise<PreparedChatRequest> {
	const apiKey = await authManager.getApiKey();
	if (!apiKey) {
		throw new Error(t('auth.notConfigured'));
	}

	const baseUrl = settings.baseUrl;
	const modelDef = resolvedModel
		? toModelDefinition(resolvedModel)
		: (MODELS.find((m) => m.id === modelInfo.id) ?? createFallbackModelDefinition(modelInfo.id));
	const thinkingCapability = modelDef?.capabilities.thinking;
	const isThinkingModel = Boolean(thinkingCapability);
	const imageMode =
		modelDef.imageMode ?? (modelDef.capabilities.nativeImageInput ? 'native' : 'proxy');
	const nativeImageInput = imageMode === 'native';
	const maxTokens = settings.maxTokens > 0 ? settings.maxTokens : getMaxTokens();

	// Flash/Pro are declared as non-native vision models and therefore resolve
	// image inputs through the configured/default proxy route (Vision Exp in auto mode).
	const visionResolution: VisionResolutionResult = nativeImageInput
		? createNativeVisionResolution(messages)
		: imageMode === 'none'
			? createNoVisionResolution(messages)
			: await resolveImageMessages(messages, token, getVisionDescriber);
	if (imageMode === 'none' && visionResolution.stats.inputImageParts > 0) {
		throw new Error(t('vision.disabled'));
	}

	const resolvedMessages = visionResolution.messages;

	const deepseekMessages = convertMessages(resolvedMessages, isThinkingModel, nativeImageInput);
	if (nativeImageInput) {
		// For native-image models, count images after conversion so diagnostics reflect
		// what is actually forwarded in the DeepSeek payload.
		visionResolution.stats.forwardedImageParts = countNativeForwardedImageParts(deepseekMessages);
		visionResolution.stats.droppedImageParts = Math.max(
			0,
			visionResolution.stats.inputImageParts - visionResolution.stats.forwardedImageParts,
		);
	}
	const tools = prepareRequestTools(modelDef.capabilities.toolCalling, options);

	const totalRequestChars = countMessageChars(deepseekMessages);
	const hasNativeImages = hasNativeImageParts(deepseekMessages);
	const baseRequest: DeepSeekRequest = {
		// An explicit alias is a wire-level override and therefore wins over a
		// remote profile's advertised ID. This also keeps legacy picker IDs
		// usable when discovery is enabled.
		model:
			settings.modelIdOverrides[modelInfo.id] ??
			resolvedModel?.apiModelId ??
			modelDef.apiModelId ??
			getApiModelId(modelInfo.id),
		messages: deepseekMessages,
		stream: true,
		tools,
		tool_choice: tools && tools.length > 0 ? ('auto' as const) : undefined,
		max_tokens: maxTokens,
		parallel_tool_calls:
			tools && modelDef.capabilities.parallelToolCalls === true ? true : undefined,
	};
	const requestKind = classifyDeepSeekRequest({
		request: baseRequest,
		inputMessages: messages,
	});
	const configuredThinkingEffort = thinkingCapability
		? getConfiguredThinkingEffort(options as ModelConfigurationOptions, thinkingCapability)
		: 'none';
	// Internal Copilot helper prompts are intentionally cheap, but forcing a
	// disabled-thinking wire value is only safe when the upstream profile
	// explicitly advertises that capability. Unknown/gateway-specific models
	// may support reasoning without accepting a disable toggle.
	const forceNoneThinking =
		thinkingCapability !== false &&
		thinkingCapability?.canDisable === true &&
		shouldForceThinkingNone(requestKind);
	const thinkingEffort = forceNoneThinking ? 'none' : configuredThinkingEffort;
	const clientProfile = resolvedModel
		? toChatModelProfile(resolvedModel, settings.chatIncludeUsage)
		: toFallbackChatProfile(modelDef, settings.chatIncludeUsage);
	applyResponsesReasoningSummary(clientProfile, resolvedModel, settings);
	// Build the legacy DeepSeek-shaped request only after resolving the generic
	// profile.  A profile can explicitly disable reasoning (`requestField:
	// 'none'`), and relying solely on ModelDefinition.reasoningRequestStyle would
	// otherwise leak a reasoning_effort field that the adapter then cannot route.
	const reasoningField = clientProfile.reasoning?.requestField ?? 'none';
	const thinkingFields: Pick<DeepSeekRequest, 'thinking' | 'reasoning_effort'> =
		!isThinkingModel || reasoningField === 'none'
			? {}
			: reasoningField === 'thinking'
				? {
						thinking: {
							type: thinkingEffort === 'none' ? ('disabled' as const) : ('enabled' as const),
						},
						// DeepSeek-style profiles may accept both the thinking toggle and
						// the finer-grained effort.  ChatAdapter applies the profile's
						// includeEffortWithThinking policy before putting this on the wire.
						...(thinkingEffort === 'none' ? {} : { reasoning_effort: thinkingEffort }),
					}
				: { reasoning_effort: thinkingEffort };
	const request: DeepSeekRequest = {
		...baseRequest,
		...thinkingFields,
		extraBody: resolvedModel?.profile.extraRequestFields
			? { ...resolvedModel.profile.extraRequestFields }
			: undefined,
	};
	const client = new OpenAICompatibleClient(baseUrl, apiKey, clientProfile, {
		timeoutMs: settings.requestTimeoutMs,
	});
	dumpDeepSeekRequest(request, {
		globalStorageUri,
		segment,
		requestKind,
		vscodeModelId: modelInfo.id,
		isThinkingModel,
		thinkingEffort,
		maxTokens,
		inputMessages: messages,
		resolvedMessages,
		requestOptions: options,
		visionModelId: visionResolution.visionModelId,
		visionProxySource: visionResolution.visionProxySource,
		visionStats: visionResolution.stats,
	});

	const diagnosticsRun = cacheDiagnostics.beginRequest({
		request,
		segment,
		requestKind,
		vscodeModelId: modelInfo.id,
		isThinkingModel,
		thinkingEffort,
		maxTokens,
		inputMessages: messages,
		resolvedMessages,
		visionModelId: visionResolution.visionModelId,
		visionProxySource: visionResolution.visionProxySource,
		visionStats: visionResolution.stats,
	});

	return {
		client,
		request,
		isThinkingModel,
		protocol: resolvedModel?.selectedProtocol ?? modelDef.protocol ?? 'chat-completions',
		allowProtocolFallback: resolvedModel?.profile.allowProtocolFallback === true,
		responsesStore: settings.responses.store,
		responsesTruncation: settings.responses.truncation,
		totalRequestChars,
		hasNativeImages,
		trailingToolResultIds: collectTrailingToolResultIds(deepseekMessages),
		cacheDiagnostics: diagnosticsRun,
		requestKind,
		segment,
		replayMarkerMetadata: visionResolution.replayMarkerMetadata,
		visionMarkerTextChars: visionResolution.stats.markerVisionTextChars || undefined,
		initialResponseNotice: visionResolution.initialResponseNotice,
	};
}

/** Apply the global Responses display policy without overriding an explicit
 * model profile when the setting is `auto`. */
function applyResponsesReasoningSummary(
	profile: ChatModelProfile,
	model: ResolvedModel | undefined,
	settings: NewApiSettings,
): void {
	if (model?.selectedProtocol !== 'responses') return;
	const configured = settings.responses.reasoningSummary;
	if (configured === 'auto' || !profile.reasoning) return;
	profile.reasoning = {
		...profile.reasoning,
		outputStyle: configured,
	};
}

function hasNativeImageParts(messages: DeepSeekMessage[]): boolean {
	for (const message of messages) {
		if (typeof message.content === 'string') {
			continue;
		}
		for (const part of message.content) {
			if (part.type === 'image_url') {
				return true;
			}
		}
	}
	return false;
}

function createFallbackModelDefinition(id: string): ModelDefinition {
	const normalized = id.trim() || 'open-copilot-model';
	return {
		id: normalized,
		apiModelId: normalized,
		name: normalized,
		family: 'newapi',
		version: 'unknown',
		detail: 'Discovered New API model',
		// Keep the compatibility path consistent with ProfileResolver's safe
		// unknown-model window (119808 input + 8192 output = 128K total).
		maxInputTokens: DEFAULT_MAX_INPUT_TOKENS,
		maxOutputTokens: DEFAULT_MAX_OUTPUT_TOKENS,
		capabilities: {
			toolCalling: false,
			parallelToolCalls: false,
			imageInput: false,
			nativeImageInput: false,
			thinking: false,
		},
		requiresThinkingParam: false,
		protocol: 'chat-completions',
		imageMode: 'proxy',
	};
}

function toFallbackChatProfile(
	model: ModelDefinition,
	streamUsage: StreamUsageMode,
): ChatModelProfile {
	const thinking = model.capabilities.thinking;
	const requestStyle = model.reasoningRequestStyle;
	const requestField =
		requestStyle === 'chat-thinking'
			? 'thinking'
			: requestStyle === 'chat-reasoning-effort' || requestStyle === 'responses-object'
				? 'reasoning_effort'
				: 'none';
	return {
		supportsTools: Boolean(model.capabilities.toolCalling),
		supportsParallelTools: model.capabilities.parallelToolCalls === true,
		supportsVision: model.capabilities.nativeImageInput === true,
		maxTokensField: 'max_tokens',
		streamUsage,
		reasoning: thinking
			? {
					requestField,
					outputStyle: model.reasoningOutputStyle ?? 'summary',
					supportedEfforts: thinking.supportedEfforts,
					canDisable: thinking.canDisable,
					includeEffortWithThinking: requestField === 'thinking',
				}
			: { requestField: 'none', outputStyle: 'none' },
	};
}

function createNoVisionResolution(
	messages: readonly vscode.LanguageModelChatRequestMessage[],
): VisionResolutionResult {
	const stats = createNativeVisionResolutionStats();
	stats.imageHandlingMode = 'none';
	const resolved: vscode.LanguageModelChatRequestMessage[] = [];
	for (const message of messages) {
		const imageParts = message.content.filter(
			(part): part is vscode.LanguageModelDataPart =>
				part instanceof vscode.LanguageModelDataPart && part.mimeType.startsWith('image/'),
		);
		if (imageParts.length === 0) {
			resolved.push(message);
			continue;
		}
		stats.inputImageMessages += 1;
		stats.inputImageParts += imageParts.length;
		stats.droppedImageParts += imageParts.length;
		for (const image of imageParts) stats.inputImageBytes += image.data.byteLength;
		// `convertMessages` only forwards image parts in native mode, so retaining
		// the original host message here safely drops them from the wire payload.
		resolved.push(message);
	}
	return { messages: resolved, stats, replayMarkerMetadata: {} };
}

/**
 * Build a lightweight resolution result for native-image models.
 * Native mode does not run proxy description, but still records input image
 * counts/bytes so diagnostics are no longer reported as all-zero.
 */
function createNativeVisionResolution(
	messages: readonly vscode.LanguageModelChatRequestMessage[],
): VisionResolutionResult {
	const stats = createNativeVisionResolutionStats();
	for (const message of messages) {
		let imagePartsInMessage = 0;
		for (const part of message.content) {
			if (part instanceof vscode.LanguageModelDataPart && part.mimeType.startsWith('image/')) {
				imagePartsInMessage += 1;
				stats.inputImageBytes += part.data.byteLength;
			}
		}
		if (imagePartsInMessage > 0) {
			stats.inputImageMessages += 1;
			stats.inputImageParts += imagePartsInMessage;
		}
	}

	if (stats.inputImageParts > 0) {
		stats.imageHandlingMode = 'native';
	}

	return {
		messages,
		stats,
		replayMarkerMetadata: {},
	};
}

/** Create a zeroed stats object that matches VisionResolutionStats shape. */
function createNativeVisionResolutionStats(): VisionResolutionStats {
	return {
		imageHandlingMode: 'none',
		inputImageParts: 0,
		inputImageMessages: 0,
		inputImageBytes: 0,
		currentImageMessages: 0,
		generatedImageMessages: 0,
		replayedImageMessages: 0,
		omittedImageMessages: 0,
		unavailableImageMessages: 0,
		failedImageMessages: 0,
		forwardedImageParts: 0,
		droppedImageParts: 0,
		markerVisionTextChars: 0,
		invalidMarkerVisionMetadata: 0,
	};
}

/** Count native image parts that survived conversion into image_url content. */
function countNativeForwardedImageParts(messages: readonly DeepSeekMessage[]): number {
	let total = 0;
	for (const message of messages) {
		if (typeof message.content === 'string') {
			continue;
		}
		for (const part of message.content) {
			if (part.type === 'image_url') {
				total += 1;
			}
		}
	}
	return total;
}
