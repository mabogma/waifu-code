/* Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root. */
'use strict';
const { randomBytes } = require('node:crypto');

function getGalleryHtml(webview, extensionUri, vscode, mode = 'sidebar') {
	const media = name => webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', name));
	const nonce = randomBytes(16).toString('hex');
	return `<!doctype html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource}; style-src ${webview.cspSource}; script-src 'nonce-${nonce}'; base-uri 'none'; form-action 'none'"><link rel="stylesheet" href="${media('addons.css')}"></head><body data-mode="${mode}"><main id="app" aria-busy="true"></main><script nonce="${nonce}" src="${media('addons.js')}"></script></body></html>`;
}

function createAddonGallery(vscode, context, getState, onAction, onError) {
	const bindings = new Map();
	let details;
	let detailId;
	let revision = 0;
	const labels = {};
	for (const text of ['Search Waifu Addons', 'Installed', 'Available', 'Install', 'Install from Folder', 'Enable', 'Disable', 'Uninstall', 'Enabled', 'Disabled', 'Workspace Restricted', 'No Addons Found', 'Try a different search or install an addon from a folder.', 'Bundled Catalog', 'Details', 'Permissions', 'Commands', 'Run', 'Version', 'Identifier', 'Waifu Addons', 'No addon selected.', 'Select an addon from Waifu Addons.', 'This workspace is restricted. Trust it to run or install addons.', 'Publisher', 'No additional editor API permissions.', 'Installed locally', 'Local addon', 'Working…', 'Built into Waifu Code', 'Open Details', 'Marketplace', 'Publish Addon', 'Install Package', 'Registry unavailable', 'Source']) { labels[text] = vscode.l10n.t(text); }
	async function refresh() {
		const current = ++revision;
		const state = await getState();
		if (current !== revision) { return; }
		for (const [webview, binding] of bindings) {
			await webview.postMessage({ type: 'state', ...state, labels, detailId: binding.mode === 'detail' ? detailId : undefined });
		}
	}
	function bind(owner, mode) {
		const webview = owner.webview;
		webview.options = { enableScripts: true, localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'media')] };
		const listener = webview.onDidReceiveMessage(async message => {
			try {
				if (!message || typeof message.action !== 'string') { return; }
				if (message.action === 'ready') { await refresh(); return; }
				await onAction(message);
			} catch (error) { onError(error); }
			finally { await refresh().catch(onError); }
		});
		const disposed = owner.onDidDispose(() => {
			listener.dispose();
			disposed.dispose();
			bindings.delete(webview);
			if (owner === details) { details = undefined; detailId = undefined; }
		});
		bindings.set(webview, { mode, dispose() { listener.dispose(); disposed.dispose(); } });
		webview.html = getGalleryHtml(webview, context.extensionUri, vscode, mode);
	}
	const provider = { resolveWebviewView(view) { bind(view, 'sidebar'); } };
	context.subscriptions.push(vscode.window.registerWebviewViewProvider('waifu.addons', provider));
	const gallery = {
		refresh,
		async showDetails(id) {
			detailId = id;
			if (!details) {
				details = vscode.window.createWebviewPanel('waifu.addonDetails', 'Waifu Addons', vscode.ViewColumn.Active, { enableScripts: true, localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'media')] });
				bind(details, 'detail');
			} else { details.reveal(); }
			const panel = details;
			const state = await getState();
			if (details !== panel || detailId !== id) { return; }
			const addon = state.addons.find(item => item.id === id);
			details.title = addon ? addon.name : 'Waifu Addons';
			await refresh();
		},
		dispose() { for (const binding of bindings.values()) { binding.dispose(); } bindings.clear(); if (details) { details.dispose(); } }
	};
	context.subscriptions.push(gallery);
	return gallery;
}
module.exports = { createAddonGallery, getGalleryHtml };
