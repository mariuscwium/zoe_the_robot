/**
 * HTML page builders for the debug UI.
 * Returns complete HTML strings for the login page and dashboard.
 */

import { panelScript } from "./debug-panels.js";

const TITLE = "Family Assistant — Debug";

function styles(): string {
  return `
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: "Courier New", monospace; background: #f5f5f0; color: #2c2c2c;
           font-size: 14px; line-height: 1.5; padding: 20px; max-width: 960px; margin: 0 auto; }
    h1 { color: #333; margin-bottom: 8px; font-size: 18px; border-bottom: 2px solid #333; padding-bottom: 4px; }
    h2 { color: #555; font-size: 15px; margin: 16px 0 8px; cursor: pointer; }
    h2:hover { color: #000; }
    .panel { background: #fff; border: 1px solid #ccc; padding: 12px; margin-bottom: 12px; }
    .panel.collapsed .panel-body { display: none; }
    input, textarea, select { font-family: inherit; font-size: 13px; background: #fff;
           color: #2c2c2c; border: 1px solid #aaa; padding: 6px 8px; width: 100%; }
    textarea { min-height: 120px; resize: vertical; }
    button { font-family: inherit; font-size: 13px; background: #e8e8e8; color: #333;
             border: 1px solid #aaa; padding: 6px 14px; cursor: pointer; margin: 4px 2px; }
    button:hover { background: #ddd; }
    button.danger { background: #fdd; color: #900; border-color: #c99; }
    button.danger:hover { background: #fcc; }
    .key-list { list-style: none; }
    .key-list li { padding: 3px 0; cursor: pointer; }
    .key-list li:hover { color: #06c; }
    .entry { border-bottom: 1px solid #ddd; padding: 6px 0; }
    .entry-header { cursor: pointer; }
    .entry-header:hover { color: #06c; }
    .entry-body { display: none; padding: 6px 0; white-space: pre-wrap; }
    .entry.expanded .entry-body { display: block; }
    .meta { color: #888; font-size: 12px; }
    .pagination { margin-top: 8px; }
    .filter-row { margin-bottom: 8px; display: flex; gap: 8px; align-items: center; }
    .filter-row select, .filter-row input { width: auto; flex: 1; }
    .error { color: #c00; margin-bottom: 8px; }
    .login-box { max-width: 320px; margin: 80px auto; }
    .status { color: #270; font-size: 12px; margin: 4px 0; }
    pre { white-space: pre-wrap; word-break: break-word; }
    .msg-user { color: #06c; }
    .msg-assistant { color: #270; }
  `;
}

export function renderLoginPage(error?: string): string {
  const errorHtml = error ? `<div class="error">${error}</div>` : "";
  return `<!DOCTYPE html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${TITLE}</title><style>${styles()}</style></head>
<body><div class="login-box"><h1>${TITLE}</h1>${errorHtml}
<form method="POST"><input type="password" name="password" placeholder="Password" autofocus>
<button type="submit">Login</button></form></div></body></html>`;
}

export function renderDashboard(): string {
  const shell = dashboardShell();
  const script = panelScript();
  return `<!DOCTYPE html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${TITLE}</title><style>${styles()}</style></head>
<body><h1>${TITLE}</h1>${shell}<script>${script}</script></body></html>`;
}

function dashboardShell(): string {
  const memory = panelHtml("memory", "Memory Browser", "");
  const convo = panelHtml("conversation", "Conversation History", "");
  const audit = panelHtml("audit", "Audit Log", "");
  const incoming = panelHtml("incoming", "Incoming Messages", "");
  return `${memory}${convo}${audit}${incoming}`;
}

function panelHtml(id: string, title: string, body: string): string {
  return `<div class="panel" id="panel-${id}">
<h2 onclick="togglePanel('${id}')">[+] ${title}</h2>
<div class="panel-body">${body}<div id="${id}-content">Loading...</div></div></div>`;
}
