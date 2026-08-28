<h1 align="center">open Copilot Chat</h1>

<p align="center">
  <!-- marketplace-readme:remove-start -->
  <a href="https://marketplace.visualstudio.com/items?itemName=rongwei.open-copilot"><img src="https://img.shields.io/badge/VS%20Code%20Marketplace-Install-007ACC?logo=visualstudiocode&logoColor=white&style=for-the-badge" alt="Install from VS Code Marketplace"></a>
  <a href="https://open-vsx.org/extension/rongwei/open-copilot"><img src="https://img.shields.io/badge/Open%20VSX-Install-6A4FB6?style=for-the-badge" alt="Install from Open VSX"></a>
  <br/>
  <!-- marketplace-readme:remove-end -->
  <img src="https://img.shields.io/github/v/release/rongwei-lab/open-copilot?style=for-the-badge&label=Version" alt="Version" />
</p>

<p align="center">
  English |
  <a href="https://github.com/rongwei-lab/open-copilot/blob/main/README.zh-cn.md">简体中文</a>
</p>

Connect models exposed by [QuantumNous/new-api](https://github.com/QuantumNous/new-api) to the native VS Code Copilot Chat model picker. The extension uses New API's OpenAI-compatible interface, dynamically discovers models through `GET /v1/models`, and preserves Copilot Agent, tools, MCP, and Skills workflows.

## Features

- Dynamic model discovery, token-scoped caching, automatic background refresh, manual refresh, and stale-cache fallback after a failed refresh.
- Chat Completions with streaming text, tool calls, reasoning content, Usage, and request cancellation.
- Experimental Responses support, with protocol and reasoning-summary behavior configurable per model Profile.
- Model Profiles and model rules for configuring API model IDs, context windows, output limits, tools, reasoning efforts, and vision capabilities.
- An “Add Model” flow for selecting a model from the New API catalog and confirming its tool/Agent capability; the result is saved to the model Profile.
- A Model Manager for inspecting the live catalog, testing `/v1/models`, editing Profiles, and running health checks and compatibility diagnostics.
- Vision routing: `auto` prefers confirmed native vision and otherwise uses the Vision Proxy; `native`, `proxy`, and `none` are also available as explicit modes.
- Only models confirmed to support native image input expose VS Code image capabilities and the Vision badge.
- Reasoning efforts such as `none`, `low`, `medium`, `high`, `xhigh`, and `max` are shown according to the model protocol. Upstream declarations take precedence, Profiles can override them, and models with unverified vendor-specific fields are not given fabricated generic options.

## Built-in mainstream model rules

New API's `/v1/models` response usually contains only model IDs and endpoint types, so the extension includes a conservative capability matrix matched by model ID:

| Model family | Built-in detection |
|---|---|
| OpenAI GPT-3.5/GPT-4o/4.1, GPT-5.x, o1/o3/o4 | Tool calls, context windows, and native vision; GPT-5/Codex models expose the appropriate reasoning-effort ladder, while text-only models such as `o3-mini` are not marked as vision models |
| Claude 3.7+/4+/5 | Tool calls, native vision, `low/medium/high` reasoning efforts, and long-context aliases |
| Gemini 2.5/3 and Grok 3/4 | Tool calls/parallel tools, native vision, and standard reasoning efforts |
| DeepSeek V3/R1/V3.1/V3.2/V4 | Tool calls and context; V4 uses `low/high/max`, ordinary V3/R1 models remain text/Vision Proxy models, and only explicit Vision/VL/Omni variants enable native vision |
| Qwen/QwQ/Qwen-VL/Omni/Qwen 2.5/3.x | Tools, context, and explicit vision variants; because Qwen reasoning protocols vary by vendor, models are only marked as reasoning-capable when request fields are unverified, without fabricated generic effort parameters |
| Mistral/Codestral/Pixtral/Devstral, Llama/LLaVA/Gemma | Tools, context, and confirmed multimodal variants |
| GLM, Kimi, MiniMax, Cohere, Hunyuan, Mimo, Step, Solar, Sonar, Nova, and related families | Family-level hints for tools, context, reasoning, and vision; actual channel metadata or compatibility diagnostics remain authoritative |
| Yi, ERNIE, Doubao, ABAB, and other legacy channel aliases | Common context limits and explicit Vision/VL variants; `X1`/`thinking` only marks a model as reasoning-capable and does not guess vendor-specific request fields |

The rules cover chat models only. Generation and specialist models such as `gpt-image`, Imagen, Veo, Qwen Image, Wan, Seedance/Seedream, Kling, Sora, realtime/audio, and embedding models are filtered from the chat catalog. Capability precedence is: user `modelProfiles`/`modelRules` > upstream New API metadata > compatibility diagnostics > built-in rules > safe defaults. If a channel maps another model to a custom ID, configure it explicitly in `modelProfiles` instead of relying on name-based detection.

## Requirements

- VS Code 1.116 or later.
- Node.js 24 or later for development and packaging.

## Quick start

1. The extension ID is `rongwei.open-copilot`.
2. Run **Open Copilot: Set Bearer Token** from the Command Palette, or enter the token in `open-copilot.apiKey` in Settings.
3. Set `open-copilot.baseUrl`, for example `http://localhost:3000/v1`. The extension automatically normalizes the trailing `/v1`.
4. Run **Open Copilot: Refresh Models**, then **Open Copilot: Select Current Chat Model**, and choose a model from the **Open Copilot** group.
5. To adjust tool capability, run **Open Copilot: Add Model and Configure Tools**, or select **Add Model → Open Copilot** in the Language Models manager.
6. Use **Open Copilot: Open Model Manager** to inspect the model catalog, capability sources, health status, and Profiles.

The model catalog is checked immediately when the token, endpoint, or settings change, or when the VS Code window regains focus. Background checks run at intervals of no more than 60 seconds. If a new model does not appear in the chat picker, first show or pin it in the Language Models manager, or run **Developer: Reload Window**.

## Images and native vision

With `open-copilot.vision.mode=auto`, the original image is sent directly to a model only when its Profile or a compatibility diagnostic confirms that the model accepts images. Otherwise the request uses the Vision Proxy, so images are not sent blindly to text-only models.

The compatibility diagnostic's **Test native vision** option sends a very small test image. After the test passes, the extension writes `imageMode=native` to that model's Profile and refreshes its capabilities. Reselect the model or start a new chat before uploading a real image. The chat composer should show an **Attached image** chip; **Add context → Files and folders** creates only a file reference and is not native image input.

## Important settings

| Setting | Default | Purpose |
|---|---|---|
| `open-copilot.apiKey` | empty | New API Bearer Token. The Settings value is machine-scoped plaintext; using the token command to save it in SecretStorage is recommended. |
| `open-copilot.baseUrl` | `http://localhost:3000/v1` | New API OpenAI-compatible API root. |
| `open-copilot.modelDiscovery.enabled` | `true` | Whether to dynamically discover models through `/v1/models`. |
| `open-copilot.modelDiscovery.cacheTtlMinutes` | `15` | Model-catalog freshness window; background checks run at intervals of no more than 60 seconds. |
| `open-copilot.unknownModelPolicy` | `safe` | Use `hide`, `safe`, or `optimistic` when upstream capability metadata is unavailable. |
| `open-copilot.modelProfiles` | `{}` | Configure exact capabilities by remote model ID. |
| `open-copilot.modelRules` | `[]` | Match models with ordered glob rules and override their capabilities. |
| `open-copilot.defaultProtocol` | `chat-completions` | Default protocol preference between Chat Completions and Responses. |
| `open-copilot.responses.enabled` | `false` | Whether to allow Responses models declared by metadata. |
| `open-copilot.vision.mode` | `auto` | `auto`, `native`, `proxy`, or `none`. |
| `open-copilot.visionModel` | empty | Vision Proxy model used when native vision is unavailable. |
| `open-copilot.debugMode` | `minimal` | `minimal`, `metadata`, or `verbose`. Detailed dumps may contain sensitive content. |

Example: supplement capabilities for a model whose metadata is incomplete.

```json
{
  "open-copilot.modelProfiles": {
    "gpt-4o": {
      "displayName": "GPT-4o (New API)",
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

## FAQ

- **A model does not appear**: Check the token's user group, channels, and model permissions. The extension can discover only the models returned by `/v1/models`.
- **A model is not marked as Vision**: Run the native-vision compatibility diagnostic in Model Manager, then reselect the model or start a new chat after the test passes.
- **Copilot reports “No active subscription found”**: The current chat is using Copilot's built-in `customendpoint/...` model. Run **Open Copilot: Select Current Chat Model** and start a new chat.
- **New API returns 503 “No available channel”**: Configure an available channel and group for the model in the New API administration interface.

## Development and packaging

```bash
npm install
npm run compile
npm test
npm run lint
npm run format:check
npm run package
```

Use Node.js 24+ through the project's `.nvmrc`. Real New API integration also requires a reachable deployment and a valid token.

## License

[MIT](https://github.com/rongwei-lab/open-copilot/blob/HEAD/LICENSE)
