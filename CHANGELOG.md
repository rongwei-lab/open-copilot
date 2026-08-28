# 更新日志

## [1.0.0] - 2026-08-28

open Copilot Chat 的首个正式版本，将 New API 暴露的多模型能力接入 VS Code Copilot Chat 原生模型选择器，并保留 Agent、工具、MCP 和 Skills 工作流。

### 核心能力

- 通过 `GET /v1/models` 动态发现 New API 模型，支持 Token 级缓存、后台自动刷新、手动刷新和刷新失败时的过期缓存保留。
- 支持 OpenAI 兼容的 Chat Completions，包括流式文本、思考内容、工具调用、Usage、请求取消和错误诊断。
- 提供实验性的 Responses 协议支持，可按模型 Profile 配置协议、存储策略、截断策略和推理摘要。
- 支持 Copilot Agent 工具调用、并行工具调用、MCP 和 Skills，并提供稳定工具列表的实验选项。
- 提供模型 ID 映射、精确 `modelProfiles` 和有序 `modelRules`，用于覆盖 API 模型 ID、上下文、输出上限、协议、工具、推理和视觉能力。

### 模型管理与诊断

- 新增 Open Copilot 模型管理中心，可查看实时模型目录、能力来源、缓存状态、上下文窗口、工具、视觉和思考能力。
- 支持直接添加模型、配置工具/Agent 能力、编辑 Profile、刷新模型并切换当前 Copilot Chat 模型。
- 新增连接测试、单模型健康检查和兼容性诊断，覆盖普通请求、流式 SSE、Usage、工具调用、并行工具、思考、Responses 和原生视觉。
- 诊断结果提供 HTTP 状态、请求 ID、总延迟、首 Token 延迟和输出速度等信息；诊断不会发送当前对话，也不会执行真实工具。
- 新增模型后自动探测基础能力和原生视觉，并在能力变化后刷新目录和失效旧缓存。

### 模型能力识别

- 内置 OpenAI、Claude、Gemini、Grok、DeepSeek、Qwen、Mistral、Llama、GLM、Kimi、MiniMax、Cohere、Hunyuan、Doubao、ERNIE、Yi 等主流模型家族规则。
- 按保守策略识别上下文窗口、工具调用、并行工具、推理能力、思考强度和原生视觉，用户 Profile 与上游明确元数据始终优先。
- 支持 `none`、`low`、`medium`、`high`、`xhigh`、`max` 等思考强度，并根据 Chat Completions、Responses 或厂商映射生成对应请求字段。
- 对只声明推理能力但没有明确请求协议的模型，不猜测通用思考强度字段，避免向上游发送不兼容参数。
- 只有确认支持原生图片输入的模型才向 VS Code 暴露图片能力；未确认模型使用视觉代理或保持纯文本模式。
- 过滤图片生成、视频生成、音频、实时、嵌入、重排等非聊天模型，避免其出现在 Copilot Chat 模型列表。

### 使用体验

- 插件正式更名为 `open Copilot Chat`，扩展 ID 为 `rongwei.open-copilot`，配置和命令前缀统一为 `open-copilot.*`。
- 模型分组、命令面板、输出日志和模型管理中心统一使用 `Open Copilot` 品牌名称。
- API Key 可通过命令安全保存到 VS Code SecretStorage，也可在设置页使用机器级明文配置。
- 设置、命令、欢迎引导、模型管理中心和诊断界面支持英文与简体中文，并跟随 VS Code 显示语言。
- README、中文 README、欢迎引导、配置说明和项目地址已统一为 `rongwei-lab/open-copilot`。

### 发布说明

- 最低支持 VS Code 1.116，开发和打包使用 Node.js 24 或更高版本。
- `rongwei.open-copilot` 是新的扩展标识，不读取或迁移旧扩展 ID 的设置、SecretStorage、模型 Profile 和缓存。
- 原生视觉、Responses 和厂商专用思考协议仍取决于具体 New API 渠道，建议在模型管理中心对实际模型运行兼容性诊断。
