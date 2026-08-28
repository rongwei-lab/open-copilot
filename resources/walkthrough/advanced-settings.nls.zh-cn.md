## 稳定工具列表（实验性）

先打开 VS Code 的 Tools 配置，查看当前聊天启用了多少个工具。

[配置 Tools](command:workbench.action.chat.configureTools)

- 64 个或更少已启用工具：通常无需开启，除非工具列表仍在跨轮次变化。
- 超过 128 个已启用工具：不建议开启。部分 New API 渠道单次请求最多支持 128 个 functions，超过这个数量后无法保证 `tools` 列表稳定。请先 disable 掉一些不常用的工具，再考虑开启。
- 介于 64 到 128 个已启用工具：仅在工具列表跨轮次变化、上游上下文缓存命中率不理想时，再考虑开启。

这个设置可能通过让 New API 的 `tools` 参数在多轮对话中更完整、更稳定来提高缓存命中率。代价是每次请求可能包含更多函数工具定义，因此 input tokens 可能增加。

[添加模型并配置工具调用](command:open-copilot.addModel)

[打开 Open Copilot 模型管理中心](command:open-copilot.openModelManager)

[打开插件设置](command:workbench.action.openSettings?%5B%22%40id%3Aopen-copilot.experimental.stabilizeToolList%22%5D)
