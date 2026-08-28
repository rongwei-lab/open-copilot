import vscode from 'vscode';

/**
 * Lightweight i18n module — zero dependencies, follows VS Code display language.
 *
 *  - en / en-US / en-*      → English (default)
 *  - zh-cn / zh-hans / zh-sg → Simplified Chinese
 *  - all other locales      → English until translated
 */

function isZh(): boolean {
	const lang = vscode.env.language.toLowerCase();
	return lang === 'zh-cn' || lang === 'zh-hans' || lang.startsWith('zh-hans-') || lang === 'zh-sg';
}

// ---- Translation dictionaries ----

type Translations = Record<string, string>;

const zh: Translations = {
	// Model descriptions
	'model.flash.detail': '快速高效',
	'model.pro.detail': '深度推理',
	'model.flash-vision-exp.detail': '原生视觉实验模型',
	'model.flash.tooltip': '快速高效的 DeepSeek V4 模型，推理能力接近 V4 Pro，API 定价更经济。',
	'model.pro.tooltip': 'DeepSeek V4 模型，面向 Agent 编程、广泛世界知识和高阶推理任务。',
	'model.flash-vision-exp.tooltip': 'DeepSeek V4 Flash 视觉实验模型，支持原生图片与文本输入。',
	'model.catalog.stale': '模型目录来自过期缓存，刷新失败',

	// API Key
	'auth.apiKeyRequiredDetail': '请先配置 New API Bearer Token',
	'auth.prompt': '请输入 New API Bearer Token。该 Token 通常以 "sk-" 开头。',
	'auth.placeholder': 'sk-... 或服务商令牌',
	'auth.emptyValidation': 'Bearer Token 不能为空',
	'auth.saved': 'New API Bearer Token 已安全保存。',
	'auth.removed': 'New API Bearer Token 已移除。',
	'auth.notConfigured': 'Bearer Token 未配置，请在命令面板运行 "Open Copilot: 设置 Bearer Token"。',

	// Thinking Effort — short labels for model picker dropdown
	'status.thinking': '思考模式',
	'thinking.none': '停用',
	'thinking.none.desc': '停用思考，响应更快',
	'thinking.low': '轻量',
	'thinking.low.desc': '轻量推理，适合快速编辑和简单任务',
	'thinking.medium': '中等',
	'thinking.medium.desc': '平衡速度与推理深度，适合大多数任务',
	'thinking.high': '标准',
	'thinking.high.desc': '推荐日常使用',
	'thinking.xhigh': '极高',
	'thinking.xhigh.desc': '更深推理，适合复杂任务',
	'thinking.max': '深度',
	'thinking.max.desc': '深度推理，适合复杂任务',

	// Vision
	'vision.proxyUsing': '视觉代理：{0}',
	'vision.notFound': '未找到视觉模型 "{0}"',
	'vision.unavailable': '无可用视觉模型，图片已忽略。',
	'vision.disabled': '当前模型配置为不接收图片，请改用 vision.mode=proxy/native 或移除图片附件。',
	'vision.proxyError': '视觉代理异常：',
	'vision.action.configureProxy': '配置视觉代理',
	'vision.panel.title': 'New API 视觉代理',
	'vision.panel.description':
		'为 Flash 和 Pro 配置一个将图片转换成文字描述的视觉模型。Vision Exp 会直接处理原图。',
	'vision.panel.source.vscodeLm': 'VS Code 模型',
	'vision.panel.source.apiEndpoint': 'API 端点',
	'vision.panel.field.source': '视觉代理来源',
	'vision.panel.field.visionModel': '视觉模型',
	'vision.panel.field.endpointType': '端点类型',
	'vision.panel.field.endpointUrl': '端点 URL',
	'vision.panel.field.apiKey': 'API Key',
	'vision.panel.field.modelId': '模型 ID',
	'vision.panel.field.customHeaders': '自定义 headers JSON',
	'vision.panel.field.extraBody': '额外请求体 JSON',
	'vision.panel.hint.customHeaders':
		'Header 会随配置保存。建议尽量把服务商 token 放在 API Key 输入框中。',
	'vision.panel.hint.extraBody': '会合并进请求体，不能覆盖 model、messages、input 或 stream。',
	'vision.panel.placeholder.openaiEndpoint': 'https://api.example.com/v1/chat/completions',
	'vision.panel.placeholder.openaiResponsesEndpoint': 'https://api.example.com/v1/responses',
	'vision.panel.placeholder.anthropicEndpoint': 'https://api.example.com/v1/messages',
	'vision.panel.placeholder.endpointType': '选择端点类型',
	'vision.panel.placeholder.enterApiKey': '输入 API Key',
	'vision.panel.endpointType.openaiChatCompletions': 'OpenAI 兼容 Chat Completions',
	'vision.panel.endpointType.openaiResponses': 'OpenAI 兼容 Responses',
	'vision.panel.endpointType.anthropicMessages': 'Anthropic 兼容 Messages',
	'vision.panel.hint.endpointTypeEmpty': '输入端点 URL 后会尝试自动识别端点类型。',
	'vision.panel.hint.endpointTypeInferred': '已根据 URL 自动识别为 {0}。',
	'vision.panel.hint.endpointTypeManual': '无法根据 URL 自动识别，请手动选择端点类型。',
	'vision.panel.hint.endpointTypeSelected': '使用手动选择的端点类型：{0}。',
	'vision.panel.hint.apiKeySet': '已保存 API Key。输入新 key 可替换当前 key。',
	'vision.panel.hint.apiKeyUnset': 'API Key 将保存在 VS Code SecretStorage 中。',
	'vision.panel.cost.tokenCost': '费用：{0} credits / 100 万 tokens',
	'vision.panel.cost.longContextTokenCost': '长上下文：{0} credits / 100 万 tokens',
	'vision.panel.cost.input': '输入 {0}',
	'vision.panel.cost.cachedInput': '缓存输入 {0}',
	'vision.panel.cost.output': '输出 {0}',
	'vision.panel.cost.pricing': '费用：{0}',
	'vision.panel.cost.category.low': '低费用',
	'vision.panel.cost.category.medium': '中等费用',
	'vision.panel.cost.category.high': '高费用',
	'vision.panel.cost.category.veryHigh': '很高费用',
	'vision.panel.cost.category.named': '{0} 费用',
	'vision.panel.status.vscodeLmSelected': '已选择 VS Code 语言模型。',
	'vision.panel.status.apiKeySet': '已设置 API Key。',
	'vision.panel.status.apiKeyNotSet': '未设置 API Key。',
	'vision.panel.status.testing': '正在测试视觉代理...',
	'vision.panel.status.vscodeLmNoHttpTest': 'VS Code 语言模型无需 HTTP 测试。',
	'vision.panel.status.testSucceeded': '已收到视觉代理响应，请查看下方样例。',
	'vision.panel.status.vscodeLmSaved': 'VS Code 语言模型已启用。',
	'vision.panel.status.endpointSavedWithKey': 'API 端点和 API Key 已保存，并已启用 API 端点。',
	'vision.panel.status.endpointSaved': 'API 端点已保存，并已启用 API 端点。',
	'vision.panel.status.apiKeyCleared': '已清除保存的 API Key。',
	'vision.panel.summary.noVSCodeVision.title': '当前：没有 VS Code 视觉模型',
	'vision.panel.summary.noVSCodeVision.detail': '请配置 API 端点，或安装支持图片输入的模型提供方。',
	'vision.panel.summary.vscodeLm.title': '当前：VS Code 语言模型',
	'vision.panel.summary.vscodeLm.detail': '{0} · {1} · 支持图片输入',
	'vision.panel.summary.apiNotConfigured.title': '当前：API 端点未配置',
	'vision.panel.summary.apiNotConfigured.detail': '填写端点 URL、端点类型和模型 ID 后保存。',
	'vision.panel.summary.apiEndpoint.title': '当前：API 端点',
	'vision.panel.summary.apiEndpoint.detail': '{0} · {1} · {2} · {3}',
	'vision.panel.summary.apiKeySet': '已设置 API Key',
	'vision.panel.summary.apiKeyNotSet': '未设置 API Key',
	'vision.panel.action.save': '保存',
	'vision.panel.action.test': '测试',
	'vision.panel.action.clearApiKey': '清除已保存的 API Key',
	'vision.panel.test.image': '测试图片',
	'vision.panel.test.response': '模型回答',
	'vision.panel.error.required': '{0} 必填',
	'vision.panel.error.invalidJson': '{0} 必须是有效的 JSON。',
	'vision.proxy.error.configurationInvalid': '视觉代理配置无效。',
	'vision.proxy.error.providerFamilyInvalid': '视觉代理提供方类型无效。',
	'vision.proxy.error.apiTypeInvalid': '视觉代理 API 类型无效。',
	'vision.proxy.error.fieldRequired': '{0} 必填。',
	'vision.proxy.error.extraBodyObject': '额外请求体 JSON 必须是一个对象。',
	'vision.proxy.error.extraBodyProtectedKey': '额外请求体不能覆盖 "{0}"。',
	'vision.proxy.error.customHeadersObject': '自定义 headers 必须是一个对象。',
	'vision.proxy.error.customHeaderNameEmpty': '自定义 header 名不能为空。',
	'vision.proxy.error.customHeaderNameInvalid': '自定义 header "{0}" 无效。',
	'vision.proxy.error.customHeaderValueString': '自定义 header "{0}" 的值必须是字符串。',
	'vision.proxy.error.customHeaderValueInvalid': '自定义 header "{0}" 的值无效。',
	'vision.proxy.error.invalidUrl': '视觉代理端点 URL 无效。',
	'vision.proxy.error.invalidUrlProtocol': '视觉代理端点 URL 必须使用 http:// 或 https://。',
	'vision.proxy.error.auth': '视觉代理认证失败 ({0})。',
	'vision.proxy.error.notFound': '视觉代理端点或模型不存在：{0}。',
	'vision.proxy.error.payloadTooLarge': '视觉代理图片请求体过大 ({0})。',
	'vision.proxy.error.rateLimited': '视觉代理触发速率限制 ({0})。',
	'vision.proxy.error.providerUnavailable': '视觉代理服务不可用 ({0})。',
	'vision.proxy.error.requestFailed': '视觉代理请求失败 ({0})。',
	'vision.proxy.error.cancelled': '视觉代理请求已取消。',
	'vision.proxy.error.timeout': '视觉代理请求超时。',
	'vision.proxy.error.network.dns': '视觉代理 DNS 解析失败 ({0})。',
	'vision.proxy.error.network.unreachable': '视觉代理端点不可达或拒绝连接 ({0})。',
	'vision.proxy.error.network.interrupted': '视觉代理连接被中断 ({0})。',
	'vision.proxy.error.network.timeout': '视觉代理网络连接超时 ({0})。',
	'vision.proxy.error.network.tls': '视觉代理 TLS/证书校验失败 ({0})。',
	'vision.proxy.error.network.aborted': '视觉代理请求已中止 ({0})。',
	'vision.proxy.error.network.protocol': '视觉代理 HTTP 连接或响应解析失败 ({0})。',
	'vision.proxy.error.network.configuration': '视觉代理请求配置无效 ({0})。',
	'vision.proxy.error.network.generic': '视觉代理网络请求失败 ({0})。',
	'vision.proxy.error.emptyResponse': '视觉代理返回了空响应。',
	'vision.proxy.error.unsupportedAnthropicResponse': 'Anthropic-compatible 视觉响应格式不受支持。',
	'vision.proxy.error.unsupportedOpenAIResponse': 'OpenAI-compatible 视觉响应格式不受支持。',
	'vision.proxy.error.unsupportedOpenAIContent': 'OpenAI-compatible 视觉响应内容格式不受支持。',
	'vision.proxy.error.testFailed': '视觉代理测试失败。',
	'vision.proxy.error.unknown': '未知错误',

	// Request
	'request.toolsLimitExceeded':
		'当前上游单次 tools 请求最多支持 {0} 个 functions，当前请求包含 {1} 个。请先用 VS Code 的 Configure Tools 关闭不常用的工具；如果正在使用实验性稳定工具列表设置，请关闭它。',
	'request.preflightRoundLimitExceeded':
		'实验性稳定工具列表设置已尝试 {0} 轮，仍无法得到稳定的已启用工具列表。请关闭该实验性设置，或先用 VS Code 的 Configure Tools 关闭不常用的工具。',
	'notice.visionProxyMissing': '⚠️ 视觉代理不可用，当前模型无法看到图片。[配置视觉代理]({0})',
	'notice.visionProxyFailure': '**⚠️ {0}**\\\n\\\n**{1} · {2}**',
	'notice.toolDrift':
		'⚠️ 工具列表不稳定，缓存命中率可能下降。[了解更多](https://github.com/rongwei-lab/open-copilot/blob/main/docs/notices/tool-drift.zh.md)',

	// Errors
	'error.http.400': '[{0}] 请求体格式错误。请根据错误信息提示修改请求体。',
	'error.http.401':
		'[{0}] API Key 错误，认证失败。请检查您的 API Key 是否正确。如没有 API key，请先创建 API Key。',
	'error.http.401.withCreateApiKeyLink':
		'[{0}] API Key 错误，认证失败。请检查您的 API Key 是否正确。如没有 API key，请先[创建 API Key]({1})。',
	'error.http.402': '[{0}] 账号余额不足。请确认账户余额，并前往充值页面进行充值。',
	'error.http.422': '[{0}] 请求体参数错误。请根据错误信息提示修改相关参数。',
	'error.http.429': '[{0}] 请求速率（TPM 或 RPM）达到上限。请合理规划您的请求速率。',
	'error.http.500': '[{0}] 服务器内部故障。请等待后重试。',
	'error.http.503': '[{0}] 服务器负载过高。请稍后重试您的请求。',
	'error.http.generic': '[{0}] 服务返回错误响应。',
	'error.action.setApiKey': '设置 API Key',
	'error.action.createApiKey': '创建 API Key',
	'error.action.viewUsage': '用量',
	'error.action.checkDeepSeekStatus': 'DeepSeek 状态',
	'error.action.viewDetails': '错误详情',
	'error.network.dns': '[{0}] DNS 解析失败。请检查网络连接、防火墙或代理设置，以及自定义 baseUrl。',
	'error.network.unreachable':
		'[{0}] 目标不可达或拒绝连接。请检查自定义 baseUrl、代理服务、网络连接或防火墙设置。',
	'error.network.interrupted': '[{0}] 连接被中断。请检查网络连接、防火墙或代理设置，或稍后重试。',
	'error.network.timeout': '[{0}] 连接超时。请稍后重试，或检查网络连接、防火墙或代理设置。',
	'error.network.tls': '[{0}] TLS/证书校验失败。请检查代理、证书配置或自定义 baseUrl。',
	'error.network.aborted':
		'[{0}] 请求已中止。如果不是主动取消，请检查网络连接或代理设置，或稍后重试。',
	'error.network.protocol':
		'[{0}] HTTP 连接或响应解析失败。请检查代理设置、自定义 baseUrl 或服务响应。',
	'error.network.configuration': '[{0}] 请求配置无效。请检查自定义 baseUrl 或扩展设置。',
	'error.network.generic':
		'[{0}] 网络请求失败。请检查网络连接、防火墙或代理设置，以及自定义 baseUrl。',
	'error.unknown': 'New API 请求失败：{0}',

	// Extension
	'extension.activateFailed': 'Open Copilot 激活失败，请运行 "Open Copilot：显示日志" 查看详情。',
	'extension.deactivateFailed': 'New API 停用异常',
	'extension.welcomeFailed': '欢迎引导加载异常',
	'extension.openRequestDumpsFolderFailed':
		'打开请求 dump 目录失败，请运行 "Open Copilot：显示日志" 查看详情。',
	'extension.refreshModelsFailed': '刷新 New API 模型失败，请检查 Token 和 baseUrl。',
	'extension.selectModel.placeholder': '选择要用于当前 Copilot Chat 的 New API 模型',
	'extension.selectModel.toolCalling': '支持工具调用 / Agent',
	'extension.selectModel.textOnly': '未确认工具调用（文本模式）',
	'extension.selectModel.stale': '过期缓存',
	'extension.selectModel.switched': '已切换到 New API 模型：{0}',
	'extension.selectModel.failed': '无法切换当前聊天模型，请在模型选择器中选择 Open Copilot 分组。',
	'extension.selectModel.discoveryFailed':
		'模型目录刷新失败，当前显示兼容模型；请检查 Token、baseUrl 和 New API 渠道。',
	'extension.addModel.placeholder': '选择要添加并配置工具能力的 New API 模型',
	'extension.addModel.toolCallingPlaceholder': '是否允许此模型用于 Agent 工具调用？当前推断：{0}',
	'extension.addModel.enableTools': '启用工具调用 / Agent',
	'extension.addModel.enableToolsDescription': '将模型标记为支持 Copilot Agent、MCP 和工具调用。',
	'extension.addModel.disableTools': '关闭工具调用（文本模式）',
	'extension.addModel.disableToolsDescription':
		'不向模型发送工具定义，适用于不支持函数调用的渠道。',
	'extension.addModel.discoveryDisabled':
		'模型动态发现已关闭，请先启用 open-copilot.modelDiscovery.enabled。',
	'extension.addModel.discoveryFailed': '无法读取 New API 模型目录，请检查 Token、baseUrl 和网络。',
	'extension.addModel.noModels': '没有可添加的 New API 模型，请先刷新模型目录。',
	'extension.addModel.saveFailed': '模型能力保存失败，请检查设置权限。',
	'extension.addModel.capabilitiesRefreshed':
		'已添加模型 {0}，工具调用能力：{1}。模型能力已自动刷新。',
	'extension.addModel.nativeVisionVerified':
		'已添加模型 {0}，工具调用能力：{1}。原生视觉验证通过，已自动启用图片输入。',
	'extension.addModel.nativeVisionNotVerified':
		'已添加模型 {0}，但原生视觉未验证通过，未自动启用图片输入。模型其他能力已保存。',
	'extension.addModel.capabilitiesRefreshFailed':
		'已添加模型 {0}，但能力刷新失败；配置已保存，稍后刷新模型目录会重试。',

	// Model management center
	'modelManager.title': 'Open Copilot 模型管理中心',
	'modelManager.description': '查看模型目录、测试网关，并编辑模型能力 Profile。',
	'modelManager.action.refresh': '刷新模型',
	'modelManager.action.testConnection': '测试连接',
	'modelManager.action.openSettings': '打开设置',
	'modelManager.action.selectModel': '使用此模型',
	'modelManager.action.healthCheck': '健康检查',
	'modelManager.action.formatJson': '格式化 JSON',
	'modelManager.action.saveProfile': '保存 Profile',
	'modelManager.action.cancel': '取消',
	'modelManager.searchPlaceholder': '筛选模型…',
	'modelManager.allModels': '全部模型',
	'modelManager.modelCount': '{0} 个模型',
	'modelManager.noModels': '暂无可用模型。',
	'modelManager.noSelection': '选择一个模型查看详情。',
	'modelManager.loading': '加载中…',
	'modelManager.lastUpdated': '最后更新',
	'modelManager.field.baseUrl': 'API 地址',
	'modelManager.field.protocol': '协议',
	'modelManager.field.protocols': '可用协议',
	'modelManager.field.capabilities': '能力',
	'modelManager.field.contextWindow': '上下文窗口',
	'modelManager.field.inputTokens': '输入 Token',
	'modelManager.field.outputTokens': '输出 Token',
	'modelManager.field.modelId': '模型选择器 ID',
	'modelManager.field.apiModelId': 'API 模型 ID',
	'modelManager.field.family': '模型系列',
	'modelManager.field.version': '版本',
	'modelManager.field.endpointTypes': '网关端点',
	'modelManager.field.profileSources': 'Profile 来源',
	'modelManager.field.profile': '模型 Profile（JSON）',
	'modelManager.connection.tokenConfigured': 'Token 已配置',
	'modelManager.connection.tokenMissing': 'Token 未配置',
	'modelManager.connection.connected': '连接成功',
	'modelManager.connection.failed': '连接失败',
	'modelManager.tokenNotConfigured': '尚未配置 New API Bearer Token。',
	'modelManager.discoveryDisabled': '模型动态发现已关闭，请先在设置中启用。',
	'modelManager.status.stale': '过期缓存',
	'modelManager.status.metadataIncomplete': '元数据不完整',
	'modelManager.status.selected': '当前使用',
	'modelManager.status.ready': '就绪',
	'modelManager.status.refreshing': '正在刷新模型目录…',
	'modelManager.status.testing': '正在测试连接…',
	'modelManager.status.saving': '正在保存 Profile…',
	'modelManager.status.saved': 'Profile 已保存。',
	'modelManager.status.selectedMessage': '模型已选择。',
	'modelManager.status.error': '操作失败。',
	'modelManager.capability.tools': '工具调用',
	'modelManager.capability.parallelTools': '并行工具',
	'modelManager.capability.visionNative': '原生视觉',
	'modelManager.capability.visionProxy': '视觉代理',
	'modelManager.capability.visionNone': '纯文本',
	'modelManager.capability.visionAuto': '自动视觉',
	'modelManager.capability.reasoning': '推理',
	'modelManager.health.checking': '检查中…',
	'modelManager.health.unknown': '未检查',
	'modelManager.health.healthy': '健康',
	'modelManager.health.unhealthy': '不可用',
	'modelManager.health.passed': '健康检查通过。',
	'modelManager.health.failed': '健康检查失败。',
	'modelManager.health.notConfigured': '健康检查未配置。',
	'modelManager.compatibility.check': '兼容性诊断',
	'modelManager.compatibility.checking': '正在执行兼容性诊断…',
	'modelManager.compatibility.title': '兼容性诊断',
	'modelManager.compatibility.description': '执行受限探测，不会发送当前对话或执行真实工具。',
	'modelManager.compatibility.optional': '包含并行工具、推理和协议探测',
	'modelManager.compatibility.vision': '测试原生视觉（发送测试图片，可能消耗 Token）',
	'modelManager.compatibility.confirmVision':
		'视觉探测会发送一张极小测试图片，可能消耗 Token。是否继续？',
	'modelManager.compatibility.pass': '通过',
	'modelManager.compatibility.fail': '失败',
	'modelManager.compatibility.warn': '警告',
	'modelManager.compatibility.skip': '未测试',
	'modelManager.compatibility.noChecks': '尚未执行兼容性诊断。',
	'modelManager.compatibility.reportPassed': '兼容性检查通过。',
	'modelManager.compatibility.reportFailed': '部分兼容性检查失败。',
	'modelManager.compatibility.latency': '延迟',
	'modelManager.compatibility.firstToken': '首 Token',
	'modelManager.compatibility.http': 'HTTP',
	'modelManager.compatibility.requestId': '请求 ID',
	'modelManager.compatibility.usage': 'Usage',
	'modelManager.compatibility.details': '详情',
	'modelManager.compatibility.tokensPerSecond': '输出速度',
	'modelManager.compatibility.responseChars': '响应字符',
	'modelManager.compatibility.frames': 'SSE 帧',
	'modelManager.compatibility.chat': '普通文本',
	'modelManager.compatibility.stream': '流式 SSE',
	'modelManager.compatibility.usageCheck': 'Usage 字段',
	'modelManager.compatibility.tools': '工具调用',
	'modelManager.compatibility.parallelTools': '并行工具',
	'modelManager.compatibility.reasoning': '推理',
	'modelManager.compatibility.responses': 'Responses 协议',
	'modelManager.compatibility.visionCheck': '原生视觉',
	'modelManager.compatibility.nativeApplied':
		'已将该模型启用为原生图片输入。请重新选择模型或新建聊天后上传图片。',
	'modelManager.compatibility.nativeApplyFailed':
		'原生图片输入配置未能保存，请在模型 Profile 中设置 imageMode 为 native。',
	'modelManager.profile.hint': '仅保存支持的 Profile 字段；不会接受密钥、请求头或任意请求体字段。',
	'modelManager.profile.placeholder':
		'{\n  "protocol": "chat-completions",\n  "imageMode": "auto"\n}',
	'modelManager.profile.invalid': 'Profile 必须是有效的 JSON 对象。',
	'modelManager.profile.confirmDiscard': '放弃尚未保存的 Profile 修改？',
	'modelManager.modelNotFound': '模型已不在当前目录中。',
	'modelManager.unknown': '未知',
	'modelManager.unknownCapability': '未确认',
	'modelManager.source.gateway': '网关',
	'modelManager.source.profile': 'Profile',
	'modelManager.source.heuristic': '名称推断',
	'modelManager.source.builtin': '内置规则',
	'modelManager.source.probe': '探测',
	'modelManager.source.unknown': '未知来源',
	'modelManager.filter.all': '全部',
	'modelManager.filter.tools': '工具',
	'modelManager.filter.vision': '视觉',
	'modelManager.filter.reasoning': '推理',
	'modelManager.profileEditingNotConfigured': '模型 Profile 编辑未配置。',
	'modelManager.selectionNotConfigured': '模型选择未配置。',
	'modelManager.operationInProgress': '另一个模型操作正在进行中。',
};

const en: Translations = {
	// Model descriptions
	'model.flash.detail': 'Fast, general-purpose model',
	'model.pro.detail': 'Most capable reasoning model',
	'model.flash-vision-exp.detail': 'Experimental native vision model',
	'model.flash.tooltip':
		'Fast, efficient DeepSeek V4 model with reasoning close to V4 Pro and economical API pricing.',
	'model.pro.tooltip':
		'DeepSeek V4 model for agentic coding, broad world knowledge, and high-end reasoning.',
	'model.flash-vision-exp.tooltip':
		'Experimental DeepSeek V4 Flash vision model with native image and text input.',
	'model.catalog.stale': 'Model catalog is from a stale cache; refresh failed',

	// API Key
	'auth.apiKeyRequiredDetail': 'Please run Open Copilot: Set Bearer Token to configure.',
	'auth.prompt': 'Enter your New API bearer token. Provider tokens usually start with "sk-".',
	'auth.placeholder': 'sk-... or provider token',
	'auth.emptyValidation': 'Bearer token cannot be empty',
	'auth.saved': 'New API bearer token saved.',
	'auth.removed': 'New API bearer token removed.',
	'auth.notConfigured':
		'Bearer token is not configured. Run "Open Copilot: Set Bearer Token" from the Command Palette.',

	// Thinking Effort
	'status.thinking': 'Thinking Effort',
	'thinking.none': 'None',
	'thinking.none.desc': 'Disable thinking for faster responses',
	'thinking.low': 'Low',
	'thinking.low.desc': 'Light reasoning for quick edits and simple tasks',
	'thinking.medium': 'Medium',
	'thinking.medium.desc': 'Balanced reasoning for most tasks',
	'thinking.high': 'High',
	'thinking.high.desc': 'Recommended for most tasks',
	'thinking.xhigh': 'Extra high',
	'thinking.xhigh.desc': 'Deeper reasoning for complex tasks',
	'thinking.max': 'Max',
	'thinking.max.desc': 'Maximum reasoning depth for complex agent tasks',

	// Vision
	// NOTE: vision.unableToDescribe has been moved to consts.ts as
	// IMAGE_DESCRIPTION_UNAVAILABLE — it is prompt content, not UI text.
	'vision.proxyUsing': 'Vision proxy: {0}',
	'vision.notFound': 'Vision model "{0}" not found',
	'vision.unavailable': 'No vision models available, image(s) ignored',
	'vision.disabled':
		'This model is configured to reject images. Set vision.mode to proxy/native or remove the image attachment.',
	'vision.proxyError': 'Vision proxy error:',
	'vision.action.configureProxy': 'Configure Vision Proxy',
	'vision.panel.title': 'New API Vision Proxy',
	'vision.panel.description':
		'Configure a vision model that turns images into text for Flash and Pro. Vision Exp processes original images directly.',
	'vision.panel.source.vscodeLm': 'VS Code model',
	'vision.panel.source.apiEndpoint': 'API endpoint',
	'vision.panel.field.source': 'Vision proxy source',
	'vision.panel.field.visionModel': 'Vision model',
	'vision.panel.field.endpointType': 'Endpoint type',
	'vision.panel.field.endpointUrl': 'Endpoint URL',
	'vision.panel.field.apiKey': 'API key',
	'vision.panel.field.modelId': 'Model ID',
	'vision.panel.field.customHeaders': 'Custom headers JSON',
	'vision.panel.field.extraBody': 'Additional request body JSON',
	'vision.panel.hint.customHeaders':
		'Header values are stored with the profile. Put provider tokens in the API key field when possible.',
	'vision.panel.hint.extraBody':
		'Merged into the request body. Cannot override model, messages, input, or stream.',
	'vision.panel.placeholder.openaiEndpoint': 'https://api.example.com/v1/chat/completions',
	'vision.panel.placeholder.openaiResponsesEndpoint': 'https://api.example.com/v1/responses',
	'vision.panel.placeholder.anthropicEndpoint': 'https://api.example.com/v1/messages',
	'vision.panel.placeholder.endpointType': 'Select endpoint type',
	'vision.panel.placeholder.enterApiKey': 'Enter API key',
	'vision.panel.endpointType.openaiChatCompletions': 'OpenAI-compatible Chat Completions',
	'vision.panel.endpointType.openaiResponses': 'OpenAI-compatible Responses',
	'vision.panel.endpointType.anthropicMessages': 'Anthropic-compatible Messages',
	'vision.panel.hint.endpointTypeEmpty':
		'Enter an endpoint URL to infer the endpoint type automatically.',
	'vision.panel.hint.endpointTypeInferred': 'Inferred from URL: {0}.',
	'vision.panel.hint.endpointTypeManual':
		'Could not infer this URL. Select the endpoint type manually.',
	'vision.panel.hint.endpointTypeSelected': 'Using selected endpoint type: {0}.',
	'vision.panel.hint.apiKeySet': 'Stored API key is set. Enter a new key to replace it.',
	'vision.panel.hint.apiKeyUnset': 'API key will be stored in VS Code SecretStorage.',
	'vision.panel.cost.tokenCost': 'Cost: {0} credits / 1M tokens',
	'vision.panel.cost.longContextTokenCost': 'Long context: {0} credits / 1M tokens',
	'vision.panel.cost.input': 'input {0}',
	'vision.panel.cost.cachedInput': 'cached input {0}',
	'vision.panel.cost.output': 'output {0}',
	'vision.panel.cost.pricing': 'Cost: {0}',
	'vision.panel.cost.category.low': 'low cost',
	'vision.panel.cost.category.medium': 'medium cost',
	'vision.panel.cost.category.high': 'high cost',
	'vision.panel.cost.category.veryHigh': 'very high cost',
	'vision.panel.cost.category.named': '{0} cost',
	'vision.panel.status.vscodeLmSelected': 'VS Code language model is selected.',
	'vision.panel.status.apiKeySet': 'API key is set.',
	'vision.panel.status.apiKeyNotSet': 'API key is not set.',
	'vision.panel.status.testing': 'Testing vision proxy...',
	'vision.panel.status.vscodeLmNoHttpTest':
		'VS Code language model selection does not need an HTTP test.',
	'vision.panel.status.testSucceeded': 'Vision proxy responded. Review the sample below.',
	'vision.panel.status.vscodeLmSaved': 'VS Code language model is now active.',
	'vision.panel.status.endpointSavedWithKey':
		'API endpoint and API key saved. API endpoint is now active.',
	'vision.panel.status.endpointSaved': 'API endpoint saved. API endpoint is now active.',
	'vision.panel.status.apiKeyCleared': 'Saved API key cleared.',
	'vision.panel.summary.noVSCodeVision.title': 'Current: no VS Code vision model',
	'vision.panel.summary.noVSCodeVision.detail':
		'Configure an API endpoint or install a provider with image input support.',
	'vision.panel.summary.vscodeLm.title': 'Current: VS Code language model',
	'vision.panel.summary.vscodeLm.detail': '{0} · {1} · image input supported',
	'vision.panel.summary.apiNotConfigured.title': 'Current: API endpoint not configured',
	'vision.panel.summary.apiNotConfigured.detail':
		'Complete the endpoint URL, endpoint type, and model ID, then save.',
	'vision.panel.summary.apiEndpoint.title': 'Current: API endpoint',
	'vision.panel.summary.apiEndpoint.detail': '{0} · {1} · {2} · {3}',
	'vision.panel.summary.apiKeySet': 'API key set',
	'vision.panel.summary.apiKeyNotSet': 'API key not set',
	'vision.panel.action.save': 'Save',
	'vision.panel.action.test': 'Test',
	'vision.panel.action.clearApiKey': 'Clear saved API key',
	'vision.panel.test.image': 'Test image',
	'vision.panel.test.response': 'Model response',
	'vision.panel.error.required': '{0} is required',
	'vision.panel.error.invalidJson': '{0} must be valid JSON.',
	'vision.proxy.error.configurationInvalid': 'Vision proxy configuration is invalid.',
	'vision.proxy.error.providerFamilyInvalid': 'Vision proxy provider type is invalid.',
	'vision.proxy.error.apiTypeInvalid': 'Vision proxy API type is invalid.',
	'vision.proxy.error.fieldRequired': '{0} is required.',
	'vision.proxy.error.extraBodyObject': 'Additional request body JSON must be an object.',
	'vision.proxy.error.extraBodyProtectedKey': 'Additional request body cannot override "{0}".',
	'vision.proxy.error.customHeadersObject': 'Custom headers must be an object.',
	'vision.proxy.error.customHeaderNameEmpty': 'Custom header name cannot be empty.',
	'vision.proxy.error.customHeaderNameInvalid': 'Custom header "{0}" is invalid.',
	'vision.proxy.error.customHeaderValueString': 'Custom header "{0}" must have a string value.',
	'vision.proxy.error.customHeaderValueInvalid': 'Custom header "{0}" has an invalid value.',
	'vision.proxy.error.invalidUrl': 'Vision proxy endpoint URL is invalid.',
	'vision.proxy.error.invalidUrlProtocol':
		'Vision proxy endpoint URL must start with http:// or https://.',
	'vision.proxy.error.auth': 'Vision proxy authentication failed ({0}).',
	'vision.proxy.error.notFound': 'Vision proxy endpoint or model not found at {0}.',
	'vision.proxy.error.payloadTooLarge': 'Vision proxy image payload too large ({0}).',
	'vision.proxy.error.rateLimited': 'Vision proxy rate limited ({0}).',
	'vision.proxy.error.providerUnavailable': 'Vision proxy provider unavailable ({0}).',
	'vision.proxy.error.requestFailed': 'Vision proxy request failed ({0}).',
	'vision.proxy.error.cancelled': 'Vision proxy request was cancelled.',
	'vision.proxy.error.timeout': 'Vision proxy request timed out.',
	'vision.proxy.error.network.dns': 'Vision proxy DNS lookup failed ({0}).',
	'vision.proxy.error.network.unreachable':
		'Vision proxy endpoint is unreachable or refused the connection ({0}).',
	'vision.proxy.error.network.interrupted': 'Vision proxy connection was interrupted ({0}).',
	'vision.proxy.error.network.timeout': 'Vision proxy network connection timed out ({0}).',
	'vision.proxy.error.network.tls': 'Vision proxy TLS/certificate verification failed ({0}).',
	'vision.proxy.error.network.aborted': 'Vision proxy request was aborted ({0}).',
	'vision.proxy.error.network.protocol':
		'Vision proxy HTTP connection or response parsing failed ({0}).',
	'vision.proxy.error.network.configuration':
		'Vision proxy request configuration is invalid ({0}).',
	'vision.proxy.error.network.generic': 'Vision proxy network request failed ({0}).',
	'vision.proxy.error.emptyResponse': 'Vision proxy returned an empty response.',
	'vision.proxy.error.unsupportedAnthropicResponse':
		'Anthropic-compatible vision response has unsupported shape.',
	'vision.proxy.error.unsupportedOpenAIResponse':
		'OpenAI-compatible vision response has unsupported shape.',
	'vision.proxy.error.unsupportedOpenAIContent':
		'OpenAI-compatible vision response content has unsupported shape.',
	'vision.proxy.error.testFailed': 'Vision proxy test failed.',
	'vision.proxy.error.unknown': 'unknown',

	// Request
	'request.toolsLimitExceeded':
		'The upstream channel supports at most {0} functions in a single `tools` request, but this request contains {1}. Use VS Code Configure Tools to disable tools you rarely use. If the experimental tool-list stabilization setting is enabled, turn it off.',
	'request.preflightRoundLimitExceeded':
		'Experimental tool-list stabilization tried {0} rounds but still could not get a stable enabled-tools list. Turn this experimental setting off, or use VS Code Configure Tools to disable tools you rarely use first.',
	'notice.visionProxyMissing':
		'⚠️ Vision Proxy is unavailable. The selected model cannot see images. [Configure Vision Proxy]({0})',
	'notice.visionProxyFailure': '**⚠️ {0}**\\\n\\\n**{1} · {2}**',
	'notice.toolDrift':
		'⚠️ Tool list is unstable; cache hit rate may drop. [Learn more](https://github.com/rongwei-lab/open-copilot/blob/main/docs/notices/tool-drift.en.md)',

	// Errors
	'error.http.400':
		'[{0}] Invalid request body format. Please modify your request body according to the hints in the error message.',
	'error.http.401':
		"[{0}] Authentication fails due to the wrong API key. Please check your API key. If you don't have one, please create an API key first.",
	'error.http.401.withCreateApiKeyLink':
		"[{0}] Authentication fails due to the wrong API key. Please check your API key. If you don't have one, please [create an API key]({1}) first.",
	'error.http.402':
		"[{0}] You have run out of balance. Please check your account's balance, and go to the Top up page to add funds.",
	'error.http.422':
		'[{0}] Your request contains invalid parameters. Please modify your request parameters according to the hints in the error message.',
	'error.http.429':
		'[{0}] You are sending requests too quickly. Please pace your requests reasonably.',
	'error.http.500':
		'[{0}] Our server encounters an issue. Please retry your request after a brief wait.',
	'error.http.503':
		'[{0}] The server is overloaded due to high traffic. Please retry your request after a brief wait.',
	'error.http.generic': '[{0}] The service returned an error response.',
	'error.action.setApiKey': 'Set API Key',
	'error.action.createApiKey': 'Create API Key',
	'error.action.viewUsage': 'Usage',
	'error.action.checkDeepSeekStatus': 'DeepSeek Status',
	'error.action.viewDetails': 'Error Details',
	'error.network.dns':
		'[{0}] DNS lookup failed. Check your network connection, firewall, or proxy settings, and your custom baseUrl.',
	'error.network.unreachable':
		'[{0}] The target is unreachable or refused the connection. Check your custom baseUrl, proxy service, network connection, or firewall settings.',
	'error.network.interrupted':
		'[{0}] The connection was interrupted. Check your network connection, firewall, or proxy settings, or try again later.',
	'error.network.timeout':
		'[{0}] Connection timed out. Try again later, or check your network connection, firewall, or proxy settings.',
	'error.network.tls':
		'[{0}] TLS/certificate verification failed. Check your proxy settings, certificate configuration, or custom baseUrl.',
	'error.network.aborted':
		'[{0}] The request was aborted. If you did not cancel it, check your network connection or proxy settings, or try again later.',
	'error.network.protocol':
		'[{0}] The HTTP connection or response parsing failed. Check your proxy settings, custom baseUrl, or service response.',
	'error.network.configuration':
		'[{0}] The request configuration is invalid. Check your custom baseUrl or extension settings.',
	'error.network.generic':
		'[{0}] Network request failed. Check your network connection, firewall, or proxy settings, and your custom baseUrl.',
	'error.unknown': 'New API request failed: {0}',

	// Extension
	'extension.activateFailed':
		'Open Copilot failed to activate. Run "Open Copilot: Show Logs" for details.',
	'extension.deactivateFailed': 'Failed to prepare New API provider for deactivate',
	'extension.welcomeFailed': 'Failed to show New API welcome prompt',
	'extension.openRequestDumpsFolderFailed':
		'Failed to open request dumps folder. Run "Open Copilot: Show Logs" for details.',
	'extension.refreshModelsFailed':
		'Failed to refresh New API models. Check your token and baseUrl.',
	'extension.selectModel.placeholder': 'Select a New API model for the current Copilot Chat',
	'extension.selectModel.toolCalling': 'Tool calling / Agent supported',
	'extension.selectModel.textOnly': 'Tool calling not confirmed (text mode)',
	'extension.selectModel.stale': 'stale cache',
	'extension.selectModel.switched': 'Switched to New API model: {0}',
	'extension.selectModel.failed':
		'Unable to switch the current chat model. Choose a model from the Open Copilot group in the model picker.',
	'extension.selectModel.discoveryFailed':
		'Model discovery failed; showing compatibility models. Check the token, baseUrl, and New API channels.',
	'extension.addModel.placeholder': 'Select a New API model to add and configure tool calling',
	'extension.addModel.toolCallingPlaceholder':
		'Should this model be available for Agent tool calls? Current inference: {0}',
	'extension.addModel.enableTools': 'Enable tool calling / Agent',
	'extension.addModel.enableToolsDescription':
		'Mark the model as supporting Copilot Agent, MCP, and tool calls.',
	'extension.addModel.disableTools': 'Disable tool calling (text mode)',
	'extension.addModel.disableToolsDescription':
		'Do not send tool definitions; use this for channels without function calling.',
	'extension.addModel.discoveryDisabled':
		'Model discovery is disabled. Enable open-copilot.modelDiscovery.enabled first.',
	'extension.addModel.discoveryFailed':
		'Unable to read the New API model catalog. Check the token, baseUrl, and network.',
	'extension.addModel.noModels':
		'No New API models are available. Refresh the model catalog first.',
	'extension.addModel.saveFailed': 'Failed to save model capabilities. Check settings permissions.',
	'extension.addModel.capabilitiesRefreshed':
		'Added model {0}; tool-calling capability: {1}. Model capabilities were refreshed automatically.',
	'extension.addModel.nativeVisionVerified':
		'Added model {0}; tool-calling capability: {1}. Native vision was verified and image input was enabled automatically.',
	'extension.addModel.nativeVisionNotVerified':
		'Added model {0}, but native vision was not verified. Image input was not enabled; other capabilities were saved.',
	'extension.addModel.capabilitiesRefreshFailed':
		'Added model {0}, but capability refresh failed. The profile was saved; refreshing the model catalog will retry.',

	// Model management center
	'modelManager.title': 'Open Copilot Model Manager',
	'modelManager.description':
		'Inspect discovered models, test the gateway, and edit model profiles.',
	'modelManager.action.refresh': 'Refresh models',
	'modelManager.action.testConnection': 'Test connection',
	'modelManager.action.openSettings': 'Open settings',
	'modelManager.action.selectModel': 'Use this model',
	'modelManager.action.healthCheck': 'Health check',
	'modelManager.action.formatJson': 'Format JSON',
	'modelManager.action.saveProfile': 'Save profile',
	'modelManager.action.cancel': 'Cancel',
	'modelManager.searchPlaceholder': 'Filter models…',
	'modelManager.allModels': 'All models',
	'modelManager.modelCount': '{0} models',
	'modelManager.noModels': 'No models available.',
	'modelManager.noSelection': 'Select a model to view details.',
	'modelManager.loading': 'Loading…',
	'modelManager.lastUpdated': 'Last updated',
	'modelManager.field.baseUrl': 'Base URL',
	'modelManager.field.protocol': 'Protocol',
	'modelManager.field.protocols': 'Protocols',
	'modelManager.field.capabilities': 'Capabilities',
	'modelManager.field.contextWindow': 'Context window',
	'modelManager.field.inputTokens': 'Input tokens',
	'modelManager.field.outputTokens': 'Output tokens',
	'modelManager.field.modelId': 'Picker ID',
	'modelManager.field.apiModelId': 'API model ID',
	'modelManager.field.family': 'Family',
	'modelManager.field.version': 'Version',
	'modelManager.field.endpointTypes': 'Gateway endpoints',
	'modelManager.field.profileSources': 'Profile sources',
	'modelManager.field.profile': 'Model profile (JSON)',
	'modelManager.connection.tokenConfigured': 'Token configured',
	'modelManager.connection.tokenMissing': 'Token not configured',
	'modelManager.connection.connected': 'Connection successful',
	'modelManager.connection.failed': 'Connection failed',
	'modelManager.tokenNotConfigured': 'New API bearer token is not configured.',
	'modelManager.discoveryDisabled': 'Model discovery is disabled. Enable it in settings first.',
	'modelManager.status.stale': 'Stale cache',
	'modelManager.status.metadataIncomplete': 'Incomplete metadata',
	'modelManager.status.selected': 'Active',
	'modelManager.status.ready': 'Ready',
	'modelManager.status.refreshing': 'Refreshing model directory…',
	'modelManager.status.testing': 'Testing connection…',
	'modelManager.status.saving': 'Saving profile…',
	'modelManager.status.saved': 'Profile saved.',
	'modelManager.status.selectedMessage': 'Model selected.',
	'modelManager.status.error': 'Operation failed.',
	'modelManager.capability.tools': 'Tool calling',
	'modelManager.capability.parallelTools': 'Parallel tools',
	'modelManager.capability.visionNative': 'Native vision',
	'modelManager.capability.visionProxy': 'Vision proxy',
	'modelManager.capability.visionNone': 'Text only',
	'modelManager.capability.visionAuto': 'Vision auto',
	'modelManager.capability.reasoning': 'Reasoning',
	'modelManager.health.checking': 'Checking…',
	'modelManager.health.unknown': 'Not checked',
	'modelManager.health.healthy': 'Healthy',
	'modelManager.health.unhealthy': 'Unavailable',
	'modelManager.health.passed': 'Health check passed.',
	'modelManager.health.failed': 'Health check failed.',
	'modelManager.health.notConfigured': 'Health check is not configured.',
	'modelManager.compatibility.check': 'Compatibility check',
	'modelManager.compatibility.checking': 'Running compatibility checks…',
	'modelManager.compatibility.title': 'Compatibility diagnostics',
	'modelManager.compatibility.description':
		'Run bounded probes without sending this conversation or executing real tools.',
	'modelManager.compatibility.optional':
		'Include tools, parallel tools, reasoning, and protocol probes',
	'modelManager.compatibility.vision': 'Test native vision (may use tokens)',
	'modelManager.compatibility.confirmVision':
		'The visual probe sends a tiny test image and may consume tokens. Continue?',
	'modelManager.compatibility.pass': 'Pass',
	'modelManager.compatibility.fail': 'Fail',
	'modelManager.compatibility.warn': 'Warning',
	'modelManager.compatibility.skip': 'Not tested',
	'modelManager.compatibility.noChecks': 'No compatibility checks have been run.',
	'modelManager.compatibility.reportPassed': 'Compatibility checks passed.',
	'modelManager.compatibility.reportFailed': 'Some compatibility checks failed.',
	'modelManager.compatibility.latency': 'Latency',
	'modelManager.compatibility.firstToken': 'First token',
	'modelManager.compatibility.http': 'HTTP',
	'modelManager.compatibility.requestId': 'Request ID',
	'modelManager.compatibility.usage': 'Usage',
	'modelManager.compatibility.details': 'Details',
	'modelManager.compatibility.tokensPerSecond': 'Output speed',
	'modelManager.compatibility.responseChars': 'Response chars',
	'modelManager.compatibility.frames': 'SSE frames',
	'modelManager.compatibility.chat': 'Chat response',
	'modelManager.compatibility.stream': 'Streaming SSE',
	'modelManager.compatibility.usageCheck': 'Usage fields',
	'modelManager.compatibility.tools': 'Tool calling',
	'modelManager.compatibility.parallelTools': 'Parallel tools',
	'modelManager.compatibility.reasoning': 'Reasoning',
	'modelManager.compatibility.responses': 'Responses protocol',
	'modelManager.compatibility.visionCheck': 'Native vision',
	'modelManager.compatibility.nativeApplied':
		'Native image input is enabled. Re-select the model or start a new chat before uploading an image.',
	'modelManager.compatibility.nativeApplyFailed':
		'Native image input could not be saved. Set imageMode to native in the model Profile.',
	'modelManager.profile.hint':
		'Only supported profile fields are saved; secrets, headers, and arbitrary request-body fields are rejected.',
	'modelManager.profile.placeholder':
		'{\n  "protocol": "chat-completions",\n  "imageMode": "auto"\n}',
	'modelManager.profile.invalid': 'Profile must be a valid JSON object.',
	'modelManager.profile.confirmDiscard': 'Discard unsaved profile changes?',
	'modelManager.modelNotFound': 'Model is no longer in the directory.',
	'modelManager.unknown': 'Unknown',
	'modelManager.unknownCapability': 'Unconfirmed',
	'modelManager.source.gateway': 'Gateway',
	'modelManager.source.profile': 'Profile',
	'modelManager.source.heuristic': 'Name heuristic',
	'modelManager.source.builtin': 'Built-in',
	'modelManager.source.probe': 'Probe',
	'modelManager.source.unknown': 'Unknown source',
	'modelManager.filter.all': 'All',
	'modelManager.filter.tools': 'Tools',
	'modelManager.filter.vision': 'Vision',
	'modelManager.filter.reasoning': 'Reasoning',
	'modelManager.profileEditingNotConfigured': 'Profile editing is not configured.',
	'modelManager.selectionNotConfigured': 'Model selection is not configured.',
	'modelManager.operationInProgress': 'Another model operation is still running.',
};

/**
 * Resolve a translation key for the current VS Code display language.
 * Supports positional placeholders {0}, {1}, ...
 */
export function t(key: string, ...args: (string | number)[]): string {
	const dict = isZh() ? zh : en;
	let text = dict[key];
	if (text === undefined) {
		// Fall back to English when a key is missing from the active locale.
		text = en[key];
	}
	if (text === undefined) {
		return key;
	}
	// Replace all occurrences of each positional placeholder.
	for (let i = 0; i < args.length; i++) {
		text = text.replaceAll(`{${i}}`, String(args[i]));
	}
	return text;
}
