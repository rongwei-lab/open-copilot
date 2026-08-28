Models returned by New API should appear in the Copilot model picker after the extension is active and a bearer token is configured. Run `Open Copilot: Refresh Models` to force a new `GET /v1/models` request, then run `Open Copilot: Select Current Chat Model` to choose from the **Open Copilot** group instead of Copilot's `customendpoint` models.

If you do not see a model, check the base URL, token permissions, and model discovery include/exclude patterns in settings.

[Open the Open Copilot Model Manager](command:open-copilot.openModelManager) to inspect the live directory, test the connection, or run a minimal health check.
