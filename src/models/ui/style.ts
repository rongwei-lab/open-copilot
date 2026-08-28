/** Styles for the model manager webview. All colors come from VS Code theme variables. */
export function getModelManagerPanelStyle(): string {
	return `
		:root { color-scheme: light dark; }
		* { box-sizing: border-box; }
		body {
			margin: 0;
			padding: 20px 24px 28px;
			color: var(--vscode-foreground);
			background: var(--vscode-editor-background);
			font-family: var(--vscode-font-family);
			font-size: var(--vscode-font-size);
		}
		main { max-width: 1240px; margin: 0 auto; }
		.page-header {
			display: flex;
			align-items: flex-start;
			justify-content: space-between;
			gap: 16px;
			margin-bottom: 16px;
		}
		h1 { margin: 0 0 6px; font-size: 21px; font-weight: 600; }
		.description {
			margin: 0;
			max-width: 720px;
			color: var(--vscode-descriptionForeground);
			line-height: 1.5;
		}
		.actions, .detail-actions, .toolbar-actions {
			display: flex;
			align-items: center;
			flex-wrap: wrap;
			gap: 8px;
		}
		button {
			min-height: 28px;
			padding: 5px 11px;
			color: var(--vscode-button-foreground);
			background: var(--vscode-button-background);
			border: 1px solid var(--vscode-button-border, transparent);
			border-radius: 3px;
			font-family: var(--vscode-font-family);
			font-size: var(--vscode-font-size);
			cursor: pointer;
		}
		button.secondary {
			color: var(--vscode-button-secondaryForeground);
			background: var(--vscode-button-secondaryBackground);
		}
		button.quiet {
			color: var(--vscode-foreground);
			background: transparent;
			border-color: transparent;
		}
		button:hover { background: var(--vscode-button-hoverBackground); }
		button.secondary:hover { background: var(--vscode-button-secondaryHoverBackground); }
		button.quiet:hover { background: var(--vscode-toolbar-hoverBackground); }
		button:disabled { opacity: .55; cursor: default; }
		button:focus, input:focus, select:focus, textarea:focus {
			outline: 1px solid var(--vscode-focusBorder);
			outline-offset: 1px;
		}
		.connection {
			display: grid;
			grid-template-columns: minmax(0, 1fr) auto;
			gap: 14px;
			align-items: center;
			margin-bottom: 16px;
			padding: 10px 12px;
			border: 1px solid var(--vscode-panel-border, var(--vscode-input-border, transparent));
			border-radius: 4px;
			background: var(--vscode-editorWidget-background, var(--vscode-sideBar-background));
		}
		.connection-main { min-width: 0; display: flex; align-items: center; gap: 9px; flex-wrap: wrap; }
		.connection-dot { width: 8px; height: 8px; border-radius: 50%; flex: 0 0 auto; background: var(--vscode-descriptionForeground); }
		.connection.success .connection-dot { background: var(--vscode-testing-iconPassed, #73c991); }
		.connection.warning .connection-dot { background: var(--vscode-testing-iconQueued, #cca700); }
		.connection.error .connection-dot { background: var(--vscode-testing-iconFailed, var(--vscode-errorForeground)); }
		.connection-title { font-weight: 600; }
		.connection-detail { color: var(--vscode-descriptionForeground); font-size: 12px; }
		.connection-error { grid-column: 1 / -1; color: var(--vscode-errorForeground); line-height: 1.45; }
		.layout {
			display: grid;
			grid-template-columns: minmax(250px, 31%) minmax(0, 1fr);
			min-height: 560px;
			border: 1px solid var(--vscode-panel-border, var(--vscode-input-border, transparent));
			border-radius: 4px;
			overflow: hidden;
		}
		.sidebar {
			min-width: 0;
			background: var(--vscode-sideBar-background);
			border-right: 1px solid var(--vscode-panel-border, var(--vscode-input-border, transparent));
		}
		.sidebar-toolbar { display: grid; gap: 8px; padding: 12px; border-bottom: 1px solid var(--vscode-panel-border, var(--vscode-input-border, transparent)); }
		.search { width: 100%; }
		input, select, textarea {
			width: 100%;
			padding: 6px 8px;
			color: var(--vscode-input-foreground);
			background: var(--vscode-input-background);
			border: 1px solid var(--vscode-input-border, transparent);
			border-radius: 3px;
			font-family: var(--vscode-font-family);
			font-size: var(--vscode-font-size);
		}
		.filter-row { display: flex; gap: 6px; }
		.filter-row select { min-width: 0; }
		.model-count { color: var(--vscode-descriptionForeground); font-size: 12px; }
		.model-list { margin: 0; padding: 4px 0; list-style: none; }
		.model-list-empty { padding: 20px 14px; color: var(--vscode-descriptionForeground); line-height: 1.5; }
		.model-item {
			position: relative;
			display: grid;
			grid-template-columns: minmax(0, 1fr) auto;
			gap: 6px;
			width: 100%;
			padding: 9px 12px 9px 16px;
			color: var(--vscode-list-inactiveForeground, var(--vscode-foreground));
			background: transparent;
			border: 0;
			border-radius: 0;
			text-align: left;
			cursor: pointer;
		}
		.model-item:hover { background: var(--vscode-list-hoverBackground); }
		.model-item.active { color: var(--vscode-list-activeForeground, var(--vscode-foreground)); }
		.model-item.active { background: var(--vscode-list-activeSelectionBackground); }
		.model-item-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600; }
		.model-item-id { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--vscode-descriptionForeground); font-size: 11px; }
		.model-item-badges { display: flex; align-items: flex-start; justify-content: flex-end; gap: 3px; flex-wrap: wrap; }
		.badge {
			display: inline-flex;
			align-items: center;
			min-height: 19px;
			padding: 1px 6px;
			border: 1px solid var(--vscode-input-border, var(--vscode-panel-border, transparent));
			border-radius: 10px;
			color: var(--vscode-descriptionForeground);
			font-size: 11px;
			line-height: 1.35;
			white-space: nowrap;
		}
		.badge.active { color: var(--vscode-testing-iconPassed, #73c991); border-color: currentColor; }
		.badge.stale { color: var(--vscode-testing-iconQueued, #cca700); border-color: currentColor; }
		.badge.error { color: var(--vscode-errorForeground); border-color: currentColor; }
		.badge.info { color: var(--vscode-textLink-foreground); border-color: currentColor; }
		.detail {
			min-width: 0;
			padding: 18px 20px 24px;
			background: var(--vscode-editor-background);
		}
		.detail-empty { display: grid; place-items: center; min-height: 420px; color: var(--vscode-descriptionForeground); text-align: center; }
		.detail-header { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; margin-bottom: 18px; }
		.detail-title { min-width: 0; }
		.detail-title h2 { margin: 0 0 4px; font-size: 18px; font-weight: 600; overflow-wrap: anywhere; }
		.detail-subtitle { margin: 0; color: var(--vscode-descriptionForeground); font-size: 12px; overflow-wrap: anywhere; }
		.badges { display: flex; gap: 5px; flex-wrap: wrap; margin-top: 9px; }
		.meta-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px 18px; margin: 0 0 18px; }
		.meta-item { min-width: 0; }
		.meta-label { margin-bottom: 3px; color: var(--vscode-descriptionForeground); font-size: 11px; text-transform: uppercase; letter-spacing: .03em; }
		.meta-value { overflow-wrap: anywhere; line-height: 1.45; }
		.meta-value code { font-family: var(--vscode-editor-font-family, monospace); font-size: 12px; }
		.section-card {
			margin-top: 14px;
			padding: 13px 14px;
			border: 1px solid var(--vscode-panel-border, var(--vscode-input-border, transparent));
			border-radius: 4px;
			background: var(--vscode-editorWidget-background, var(--vscode-sideBar-background));
		}
		.section-heading { display: flex; justify-content: space-between; align-items: baseline; gap: 10px; margin-bottom: 10px; }
		.section-heading h3 { margin: 0; font-size: 14px; font-weight: 600; }
		.capabilities { display: flex; gap: 6px; flex-wrap: wrap; }
		.capability { display: inline-flex; align-items: center; gap: 4px; padding: 4px 8px; border-radius: 3px; color: var(--vscode-descriptionForeground); background: var(--vscode-badge-background); font-size: 12px; }
		.capability.enabled { color: var(--vscode-badge-foreground); }
		.capability.unknown { opacity: .75; border: 1px dashed var(--vscode-input-border, transparent); background: transparent; }
		.source-list { display: flex; gap: 6px; flex-wrap: wrap; color: var(--vscode-descriptionForeground); font-size: 12px; }
		.hint { color: var(--vscode-descriptionForeground); font-size: 12px; line-height: 1.45; }
		.health { display: inline-flex; align-items: center; gap: 6px; color: var(--vscode-descriptionForeground); font-size: 12px; }
		.health.healthy { color: var(--vscode-testing-iconPassed, #73c991); }
		.health.unhealthy { color: var(--vscode-errorForeground); }
		.health-dot { width: 7px; height: 7px; border-radius: 50%; background: currentColor; }
		.compatibility-card { display: grid; gap: 9px; }
		.compatibility-description { color: var(--vscode-descriptionForeground); font-size: 12px; line-height: 1.45; }
		.compatibility-options { display: flex; flex-wrap: wrap; gap: 10px 16px; color: var(--vscode-descriptionForeground); font-size: 12px; }
		.compatibility-options label { display: inline-flex; align-items: flex-start; gap: 5px; }
		.compatibility-options input { width: auto; margin-top: 2px; }
		.compatibility-report { display: grid; gap: 6px; }
		.compatibility-summary { padding: 6px 8px; border-radius: 3px; font-size: 12px; }
		.compatibility-summary.passed { color: var(--vscode-testing-iconPassed, #73c991); background: color-mix(in srgb, var(--vscode-testing-iconPassed, #73c991) 12%, transparent); }
		.compatibility-summary.failed { color: var(--vscode-errorForeground); background: color-mix(in srgb, var(--vscode-errorForeground) 12%, transparent); }
		.compatibility-row { display: grid; grid-template-columns: minmax(110px, 1fr) auto minmax(0, 2fr); gap: 7px; align-items: center; padding: 5px 0; border-bottom: 1px solid var(--vscode-panel-border, transparent); font-size: 12px; }
		.compatibility-row:last-child { border-bottom: 0; }
		.compatibility-name { font-weight: 600; }
		.compatibility-detail { color: var(--vscode-descriptionForeground); overflow-wrap: anywhere; }
		.compatibility-explanation { grid-column: 1 / -1; color: var(--vscode-descriptionForeground); line-height: 1.4; overflow-wrap: anywhere; }
		.profile-editor { display: grid; gap: 9px; }
		.profile-editor label { font-weight: 600; }
		.profile-editor textarea { min-height: 220px; resize: vertical; font-family: var(--vscode-editor-font-family, monospace); line-height: 1.45; }
		.profile-hint { color: var(--vscode-descriptionForeground); font-size: 12px; line-height: 1.45; }
		.profile-actions { display: flex; flex-wrap: wrap; gap: 8px; }
		.status { min-height: 20px; margin-top: 12px; color: var(--vscode-descriptionForeground); line-height: 1.45; }
		.status.success { color: var(--vscode-testing-iconPassed, #73c991); }
		.status.error { color: var(--vscode-errorForeground); }
		.status.warning { color: var(--vscode-testing-iconQueued, #cca700); }
		.spinner { display: inline-block; width: 12px; height: 12px; margin-right: 5px; border: 2px solid currentColor; border-right-color: transparent; border-radius: 50%; vertical-align: -2px; animation: spin .8s linear infinite; }
		@keyframes spin { to { transform: rotate(360deg); } }
		[hidden] { display: none !important; }
		@media (max-width: 760px) {
			body { padding: 16px; }
			.page-header { display: grid; }
			.layout { grid-template-columns: 1fr; }
			.sidebar { border-right: 0; border-bottom: 1px solid var(--vscode-panel-border, var(--vscode-input-border, transparent)); max-height: 360px; overflow: auto; }
			.detail { padding: 16px; }
			.detail-header { display: grid; }
		}
		@media (max-width: 560px) { .compatibility-row { grid-template-columns: 1fr auto; } .compatibility-detail { grid-column: 1 / -1; } }
		@media (max-width: 480px) { .meta-grid { grid-template-columns: 1fr; } .connection { grid-template-columns: 1fr; } }
	`;
}
