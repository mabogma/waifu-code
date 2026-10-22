/* Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root. */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const extensionRequire = require('node:module').createRequire(path.join(__dirname, '../extension.cjs'));
async function setup(t, trusted) {
	const storage = await fs.mkdtemp(path.join(os.tmpdir(), 'waifu-manager-'));
	const commands = new Map();
	const state = new Map();
	const errors = [];
	const panels = [];
	const information = [];
	let provider;
	const disposable = { dispose() {} };
	function webviewOwner() {
		let incoming;
		let disposed;
		return {
			reveal() {},
			onDidDispose(callback) { disposed = callback; return disposable; },
			dispose() { if (disposed) { const callback = disposed; disposed = undefined; callback(); } },
			async incoming(message) { await incoming(message); },
			webview: {
				cspSource: 'https://unit.invalid',
				messages: [],
				asWebviewUri: uri => `https://unit.invalid/${path.basename(uri.fsPath)}`,
				onDidReceiveMessage(callback) { incoming = callback; return disposable; },
				async postMessage(message) { this.messages.push(message); return true; }
			}
		};
	}
	const vscode = {
		l10n: { t: (text, ...args) => text.replace(/\{(\d+)\}/g, (_, index) => args[Number(index)]) },
		ViewColumn: { One: 1, Active: -1 },
		Uri: { joinPath: (base, ...parts) => ({ fsPath: path.join(base.fsPath, ...parts) }) },
		workspace: { isTrusted: trusted, onDidGrantWorkspaceTrust: () => disposable },
		window: {
			onDidChangeActiveTextEditor: () => disposable,
			createOutputChannel: () => ({ appendLine() {}, dispose() {} }),
			registerWebviewViewProvider: (_, value) => { provider = value; return disposable; },
			showErrorMessage: text => errors.push(text),
			showInformationMessage: text => information.push(text),
			showWarningMessage: async (_, __, action) => action,
			createWebviewPanel: () => { const panel = webviewOwner(); panels.push(panel); return panel; }
		},
		commands: {
			registerCommand: (name, callback) => { assert.ok(!commands.has(name), `Duplicate command ${name}`); commands.set(name, callback); return { dispose() { commands.delete(name); } }; },
			executeCommand: name => commands.get(name)?.()
		}
	};
	const context = {
		globalStorageUri: { fsPath: storage }, extensionUri: { fsPath: path.resolve(__dirname, '..') }, subscriptions: [],
		globalState: { get: (key, fallback) => state.has(key) ? state.get(key) : fallback, update: async (key, value) => state.set(key, value) }
	};
	const sandbox = { exports: {}, require: name => name === 'vscode' ? vscode : extensionRequire(name) };
	vm.runInNewContext(await fs.readFile(path.join(__dirname, '../extension.cjs'), 'utf8'), sandbox);
	const api = await sandbox.exports.activate(context);
	t.after(async () => { context.subscriptions.forEach(item => item.dispose()); await fs.rm(storage, { recursive: true, force: true }); });
	return { api, commands, panels, errors, information, provider, webviewOwner };
}

test('gallery loads its webview and blocks installation in an untrusted workspace', async t => {
	const manager = await setup(t, false);
	assert.match(manager.panels[0].webview.html, /Waifu Code/);
	const view = manager.webviewOwner();
	manager.provider.resolveWebviewView(view);
	await view.incoming({ action: 'ready' });
	assert.match(view.webview.html, /addons.js/);
	assert.match(view.webview.html, /script-src 'nonce-/);
	const state = view.webview.messages.at(-1);
	assert.equal(state.trusted, false);
	assert.equal(state.addons.length, 2);
	assert.ok(state.addons.every(addon => !addon.installed && addon.catalog));
	await manager.commands.get('waifu.addons.install')();
	assert.match(manager.errors[0], /Trust this workspace/);
	await assert.rejects(manager.api.manage({ action: 'install', id: 'hello-waifu' }), /Trust this workspace/);
});

test('gallery installs, executes, disables, enables, and uninstalls a real bundled addon', async t => {
	const manager = await setup(t, true);
	await manager.api.manage({ action: 'install', id: 'hello-waifu' });
	assert.equal((await manager.api.getAddons()).addons.find(addon => addon.id === 'hello-waifu').enabled, true);
	await manager.api.manage({ action: 'run', id: 'hello-waifu', command: 'waifu.hello-waifu.greet' });
	assert.match(manager.information[0], /Waifu Code/);
	await manager.api.manage({ action: 'disable', id: 'hello-waifu' });
	assert.ok(!manager.commands.has('waifu.hello-waifu.greet'));
	await assert.rejects(manager.api.manage({ action: 'run', id: 'hello-waifu', command: 'waifu.hello-waifu.greet' }), /unavailable/);
	await manager.api.manage({ action: 'enable', id: 'hello-waifu' });
	await manager.api.manage({ action: 'details', id: 'hello-waifu' });
	assert.equal(manager.panels.at(-1).title, 'Hello, Waifu!');
	await manager.api.manage({ action: 'uninstall', id: 'hello-waifu' });
	assert.equal((await manager.api.getAddons()).addons.find(addon => addon.id === 'hello-waifu').installed, false);
	assert.ok(!manager.commands.has('waifu.hello-waifu.greet'));
});

test('webview cannot invoke arbitrary editor commands or escape the addon directory', async t => {
	const manager = await setup(t, true);
	await manager.api.manage({ action: 'install', id: 'hello-waifu' });
	await assert.rejects(manager.api.manage({ action: 'run', id: 'hello-waifu', command: 'workbench.action.closeWindow' }), /unavailable/);
	await assert.rejects(manager.api.manage({ action: 'uninstall', id: '../outside' }), /Invalid addon identifier/);
	await assert.rejects(manager.api.manage({ action: 'install', id: 'unknown-addon' }), /not in the bundled catalog/);
});
