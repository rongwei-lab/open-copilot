扩展激活并配置 Bearer Token 后，New API 返回的模型应出现在 Copilot 模型选择器中。运行 `Open Copilot：刷新模型` 可强制重新请求 `GET /v1/models`；运行 `Open Copilot：选择当前聊天模型` 可直接切换到 **Open Copilot** 分组，避免误选 Copilot 的 `customendpoint` 模型。

如果没有看到模型，请检查 baseUrl、Token 权限，以及设置中的模型发现 include/exclude 规则。

[打开 Open Copilot 模型管理中心](command:open-copilot.openModelManager)，可查看实时目录、测试连接或执行最小健康检查。
