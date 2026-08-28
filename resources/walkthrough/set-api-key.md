open Copilot Chat uses your own New API bearer token to discover models exposed by your New API deployment.

The recommended flow stores it in VS Code SecretStorage. You can also enter `open-copilot.apiKey` in the extension settings, but that setting is stored as plaintext on the machine.

- `Cmd/Ctrl + Shift + P`: Open the Command Palette
- `Open Copilot: Set Bearer Token`: Set or update your bearer token
- `Open Copilot: Clear Bearer Token`: Remove your bearer token
- `Open Copilot: Open Token Documentation`: Open New API token documentation
