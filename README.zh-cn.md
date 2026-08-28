<h1 align="center">open Copilot Chat</h1>

<p align="center">
  <!-- marketplace-readme:remove-start -->
  <a href="https://marketplace.visualstudio.com/items?itemName=rongwei.open-copilot"><img src="https://img.shields.io/badge/VS%20Code%20Marketplace-安装-007ACC?logo=visualstudiocode&logoColor=white&style=for-the-badge" alt="从 VS Code Marketplace 安装"></a>
  <a href="https://open-vsx.org/extension/rongwei/open-copilot"><img src="https://img.shields.io/badge/Open%20VSX-安装-6A4FB6?style=for-the-badge" alt="从 Open VSX 安装"></a>
  <br/>
  <!-- marketplace-readme:remove-end -->
  <img src="https://img.shields.io/github/v/release/rongwei-lab/open-copilot?style=for-the-badge&label=版本" alt="版本" />
</p>

<p align="center">
  <a href="https://github.com/rongwei-lab/open-copilot/blob/main/README.md">English</a> |
  简体中文
</p>

将 [QuantumNous/new-api](https://github.com/QuantumNous/new-api) 暴露的模型接入 VS Code Copilot Chat 原生模型选择器。插件使用 New API 的 OpenAI 兼容接口，通过 `GET /v1/models` 动态发现模型，同时保留 Copilot Agent、工具、MCP 和 Skills 工作流。

## 功能

- 动态模型发现、Token 级缓存、后台自动刷新、手动刷新和失败时的过期缓存保留。
- Chat Completions 流式文本、工具调用、思考内容、Usage 和取消请求。
- Responses 协议实验支持，可按模型 Profile 配置协议和推理摘要。
- 模型 Profile 和模型规则：配置 API 模型 ID、上下文窗口、输出上限、工具、思考强度和视觉能力。
- “添加模型”流程：从 New API 模型目录选择模型并确认工具/Agent 能力，配置会保存到 Profile。
- 模型管理中心：查看实时目录、测试 `/v1/models`、编辑 Profile、执行健康检查和兼容性诊断。
- 视觉路由：`auto` 优先使用已确认的原生视觉；不支持时使用视觉代理；也可强制 `native`、`proxy` 或 `none`。
- 只有确认支持原生图片输入的模型才显示 VS Code 的图片能力和 Vision 标记。
- 按模型协议显示 `none`、`low`、`medium`、`high`、`xhigh`、`max` 等思考强度；上游声明优先，Profile 可覆盖，未确认厂商字段的模型不会伪造通用选项。

## 内置主流模型规则

New API 的 `/v1/models` 通常只返回模型 ID 和端点类型，插件因此内置了一套按模型 ID 匹配的保守能力规则：

| 模型家族 | 内置识别内容 |
|---|---|
| OpenAI GPT-3.5/GPT-4o/4.1、GPT-5.x、o1/o3/o4 | 工具调用、上下文窗口、原生视觉；GPT-5/Codex 提供相应思考强度档位，`o3-mini` 等文本模型不会标记视觉 |
| Claude 3.7+/4+/5 | 工具调用、原生视觉、`low/medium/high` 思考强度及长上下文别名 |
| Gemini 2.5/3、Grok 3/4 | 工具调用/并行工具、原生视觉和标准思考强度 |
| DeepSeek V3/R1/V3.1/V3.2/V4 | 工具调用和上下文；V4 使用 `low/high/max`，普通 V3/R1 维持文本/视觉代理模式，明确 Vision/VL/Omni 变体才启用原生视觉 |
| Qwen/QwQ/Qwen-VL/Omni/Qwen 2.5/3.x | 工具、上下文和明确视觉变体；Qwen 的厂商思考协议不统一，未确认字段时只标记为推理模型，不伪造通用强度参数 |
| Mistral/Codestral/Pixtral/Devstral、Llama/LLaVA/Gemma | 工具、上下文和已确认的多模态变体 |
| GLM、Kimi、MiniMax、Cohere、Hunyuan、Mimo、Step、Solar、Sonar、Nova 等 | 工具、上下文、推理和视觉能力的家族级提示；具体渠道仍以上游元数据或兼容性测试为准 |
| Yi、ERNIE、Doubao、ABAB 等历史渠道别名 | 识别常见上下文和明确的 Vision/VL 变体；`X1`/`thinking` 只标记为推理模型，不猜测厂商专用请求字段 |

规则只覆盖聊天模型；`gpt-image`、Imagen、Veo、Qwen Image、Wan、Seedance/Seedream、Kling、Sora、实时/音频/嵌入等生成或专用模型会从聊天列表中过滤。能力优先级为：用户 `modelProfiles`/`modelRules` ＞ New API 上游元数据 ＞ 兼容性测试结果 ＞ 内置规则 ＞ 安全默认值。若渠道把别的模型映射到自定义 ID，请在 `modelProfiles` 中显式配置，不要依赖名称猜测。

## 环境要求

- VS Code 1.116 或更高版本。
- 开发和打包需要 Node.js 24 或更高版本。

## 快速开始

1. 本插件的标识是 `rongwei.open-copilot`。
2. 在命令面板运行 **Open Copilot: 设置 Bearer Token**，或在设置中填写 `open-copilot.apiKey`。
3. 设置 `open-copilot.baseUrl`，例如 `http://localhost:3000/v1`。插件会自动规范化末尾的 `/v1`。
4. 运行 **Open Copilot: 刷新模型**，再运行 **Open Copilot: 选择当前聊天模型**，选择 **Open Copilot** 分组下的模型。
5. 需要调整工具能力时，运行 **Open Copilot: 添加模型并配置工具**，或在语言模型管理器中点击 **添加模型 → Open Copilot**。
6. 使用 **Open Copilot: 打开模型管理中心** 查看模型目录、能力来源、健康状态和 Profile。

模型目录会在 Token、地址、设置变化或 VS Code 窗口重新获得焦点时立即检查，并以不超过 60 秒的间隔后台检查。新模型未出现在聊天下拉框时，请先在语言模型管理器中显示/固定该模型，或执行 **Developer: Reload Window**。

## 图片与原生视觉

在 `open-copilot.vision.mode=auto` 下，只有 Profile 或兼容性测试确认模型能接收图片时，才会把原图直接发给模型；无法确认时会走视觉代理，不会把图片盲目发给文本模型。

兼容性测试中的 **测试原生视觉** 会发送一张很小的测试图片。测试通过后，插件会写入该模型的 `imageMode=native` Profile，并刷新模型能力。重新选择模型或新建聊天后再上传实际图片。聊天输入框应出现 **Attached image** 附件标记；“添加上下文 → 文件和文件夹”只是文件引用，不等同于原生图片输入。

## 重要设置

| 设置 | 默认值 | 用途 |
|---|---|---|
| `open-copilot.apiKey` | 空 | New API Bearer Token。设置页值为机器级明文；推荐使用设置命令保存到 SecretStorage。 |
| `open-copilot.baseUrl` | `http://localhost:3000/v1` | New API OpenAI 兼容 API 根地址。 |
| `open-copilot.modelDiscovery.enabled` | `true` | 是否通过 `/v1/models` 动态发现模型。 |
| `open-copilot.modelDiscovery.cacheTtlMinutes` | `15` | 模型目录缓存新鲜度；后台检查间隔不超过 60 秒。 |
| `open-copilot.unknownModelPolicy` | `safe` | 上游没有能力元数据时采用 `hide`、`safe` 或 `optimistic`。 |
| `open-copilot.modelProfiles` | `{}` | 按远端模型 ID 配置精确能力。 |
| `open-copilot.modelRules` | `[]` | 按 glob 顺序匹配模型并覆盖能力。 |
| `open-copilot.defaultProtocol` | `chat-completions` | Chat Completions 或 Responses 的默认协议偏好。 |
| `open-copilot.responses.enabled` | `false` | 是否允许元数据声明的 Responses 模型。 |
| `open-copilot.vision.mode` | `auto` | `auto`、`native`、`proxy` 或 `none`。 |
| `open-copilot.visionModel` | 空 | 原生视觉不可用时使用的视觉代理模型。 |
| `open-copilot.debugMode` | `minimal` | `minimal`、`metadata` 或 `verbose`。详细 Dump 可能包含敏感内容。 |

示例：为元数据不完整的模型补充能力。

```json
{
  "open-copilot.modelProfiles": {
    "gpt-4o": {
      "displayName": "GPT-4o（New API）",
      "apiModelId": "gpt-4o",
      "protocol": "chat-completions",
      "toolCalling": true,
      "parallelToolCalls": true,
      "imageMode": "native",
      "maxInputTokens": 128000,
      "maxOutputTokens": 16384
    }
  }
}
```

## 常见问题

- **模型没有出现**：检查 Token 所属用户组、渠道和模型权限；`/v1/models` 返回的集合才是插件可发现的模型。
- **显示没有视觉**：先运行模型管理中心的原生视觉兼容性测试；测试通过后重新选择模型或新建聊天。
- **出现 No active subscription found**：当前选择的是 Copilot 内置 `customendpoint/...`，运行 **Open Copilot: 选择当前聊天模型** 后新建聊天。
- **出现 503 No available channel**：在 New API 管理端为该模型配置可用渠道和分组。

## 开发与打包

```bash
npm install
npm run compile
npm test
npm run lint
npm run format:check
npm run package
```

使用 Node.js 24+（项目 `.nvmrc`）。真实 New API 集成还需要可访问的部署地址和有效 Token。

## 许可证

[MIT](https://github.com/rongwei-lab/open-copilot/blob/HEAD/LICENSE)
