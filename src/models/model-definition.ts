import type { ModelDefinition, ThinkingCapability } from '../types';
import type { ChatModelProfile, StreamUsageMode } from '../newapi/types';
import type { ResolvedModel } from './profile';

/**
 * Convert the provider-neutral resolved model into the shape used by the
 * existing Copilot/DeepSeek compatibility layer. Keeping this boundary small
 * lets the legacy diagnostics and replay code continue to work while request
 * adapters consume the richer Profile data.
 */
export function toModelDefinition(model: ResolvedModel): ModelDefinition {
	const reasoning = toThinkingCapability(model);
	// `auto` is a resolver-only state; the legacy provider shape can only
	// represent an actionable path, so expose it as proxy until native support
	// has been verified by the resolver.
	const imageMode =
		model.capabilities.imageMode === 'auto' ? ('proxy' as const) : model.capabilities.imageMode;
	// VS Code uses `imageInput` to show the model-picker "Vision" badge and to
	// decide whether it can pass image parts straight to this provider. A proxy
	// route can describe an image before sending text, but it is not native model
	// image input and must not be advertised as such.
	const supportsNativeImageInput = imageMode === 'native';
	const requestStyle = model.capabilities.reasoning.requestStyle;

	return {
		id: model.id,
		apiModelId: model.apiModelId,
		name: model.displayName,
		family: model.family,
		version: model.version,
		detail: model.family + ' · ' + model.selectedProtocol,
		maxInputTokens: model.maxInputTokens,
		maxOutputTokens: model.maxOutputTokens,
		capabilities: {
			toolCalling: model.capabilities.toolCalling,
			parallelToolCalls: model.capabilities.parallelToolCalls,
			imageInput: supportsNativeImageInput,
			nativeImageInput: supportsNativeImageInput,
			thinking: reasoning,
		},
		requiresThinkingParam: requestStyle === 'chat-thinking',
		protocol: model.selectedProtocol,
		allowProtocolFallback: model.profile.allowProtocolFallback,
		reasoningRequestStyle: requestStyle,
		reasoningOutputStyle: model.capabilities.reasoning.outputStyle,
		imageMode,
		supportedEndpointTypes: model.source.endpointTypes,
		fromStaleCache: model.source.fromStaleCache,
	};
}

/** Convert a resolved profile to the provider-neutral Chat adapter contract. */
export function toChatModelProfile(
	model: ResolvedModel,
	streamUsage: StreamUsageMode = 'auto',
): ChatModelProfile {
	const reasoning = model.capabilities.reasoning;
	const requestStyle = reasoning.requestStyle;
	const supportsEffortWithThinking =
		model.family.toLowerCase().includes('deepseek') ||
		model.profile.reasoning?.effortMap !== undefined;
	return {
		supportsTools: model.capabilities.toolCalling,
		supportsParallelTools: model.capabilities.parallelToolCalls,
		supportsVision: model.capabilities.imageMode === 'native',
		maxTokensField: model.profile.maxTokensField,
		strictTools: model.profile.strictTools,
		streamUsage,
		reasoning: reasoning.enabled
			? {
					requestField:
						requestStyle === 'chat-thinking'
							? 'thinking'
							: requestStyle === 'responses-object'
								? 'reasoning_effort'
								: requestStyle === 'chat-reasoning-effort'
									? 'reasoning_effort'
									: 'none',
					outputStyle: reasoning.outputStyle,
					supportedEfforts: reasoning.efforts,
					effortMap: reasoning.effortMap,
					canDisable: reasoning.canDisable,
					includeReasoningContent: model.family.toLowerCase().includes('deepseek'),
					includeEffortWithThinking: supportsEffortWithThinking,
				}
			: { requestField: 'none', outputStyle: 'none' },
		extraBody: model.profile.extraRequestFields
			? { ...model.profile.extraRequestFields }
			: undefined,
	};
}

/** Responses uses the same wire capability profile, but only when explicitly enabled. */
export function toResponsesModelProfile(
	model: ResolvedModel,
	streamUsage: StreamUsageMode = 'auto',
): ChatModelProfile & { enabled: boolean; strictTools?: boolean } {
	const profile = toChatModelProfile(model, streamUsage);
	return {
		...profile,
		enabled: model.selectedProtocol === 'responses',
		strictTools: model.profile.strictTools,
	};
}

function toThinkingCapability(model: ResolvedModel): ThinkingCapability | false {
	const reasoning = model.capabilities.reasoning;
	if (
		!reasoning.enabled ||
		(!reasoning.canDisable && reasoning.efforts.length === 0) ||
		!reasoning.defaultEffort
	) {
		return false;
	}
	return {
		supportedEfforts: reasoning.efforts,
		defaultEffort: reasoning.defaultEffort,
		canDisable: reasoning.canDisable,
	};
}
