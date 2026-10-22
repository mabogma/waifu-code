/* Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root. */
'use strict';
const vscode = require('vscode');
const fs = require('node:fs/promises');
const path = require('node:path');
const { readManifest, installAddon, AddonHost } = require('./runtime.cjs');
const { createAddonGallery } = require('./gallery.cjs');
const { DEFAULT_REGISTRY, fetchCatalog, registryUrl, inspectPackage, installPackage, installRegistryAddon } = require('./registry.cjs');
const { createAddonServices } = require('./api-host.cjs');
let activeStop;

async function activate(context) {
	const storage = path.join(context.globalStorageUri.fsPath, 'addons');
	await fs.rm(path.join(context.globalStorageUri.fsPath, 'panel-images'), { recursive: true, force: true });
	const output = vscode.window.createOutputChannel('Waifu Addons');
	context.subscriptions.push(output);
	let gallery;
	let lastTextEditor = vscode.window.activeTextEditor;
	context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(editor => { if (editor) { lastTextEditor = editor; } }));
	const catalog = new Map();
	for (const folder of ['hello', 'uppercase']) {
		const addon = await readManifest(path.join(context.extensionUri.fsPath, 'examples', folder));
		catalog.set(addon.manifest.id, addon);
	}
	let remoteCatalog = new Map();
	let registryAddress = '';
	let registryError = '';
	async function syncRegistry() {
		const configured = vscode.workspace.getConfiguration?.('waifuAddons').get('registryUrl', DEFAULT_REGISTRY) || '';
		if (!configured) { remoteCatalog = new Map(); registryAddress = ''; registryError = ''; return; }
		try { registryAddress = registryUrl(configured); remoteCatalog = await fetchCatalog(registryAddress); registryError = ''; }
		catch (error) { remoteCatalog = new Map(); registryError = error.message; output.appendLine('Registry: ' + error.message); }
	}
	let entries = [];
	let sessions = [];
	const disabled = () => new Set(context.globalState.get('disabledAddons', []));
	const stop = async () => { const previous = sessions; sessions = []; await Promise.allSettled(previous.map(disposable => disposable.dispose())); };
	activeStop = stop;
	context.subscriptions.push({ dispose: stop });
	const notifyError = error => { output.appendLine(String(error.stack || error)); void vscode.window.showErrorMessage(vscode.l10n.t('Waifu Addons: {0}', error.message)); };
	async function reload() {
		await stop();
		entries = [];
		await fs.mkdir(storage, { recursive: true });
		for (const entry of await fs.readdir(storage, { withFileTypes: true })) {
			if (!entry.isDirectory() || entry.name.startsWith('.')) { continue; }
			try {
				const addon = await readManifest(path.join(storage, entry.name));
				if (addon.manifest.id !== entry.name) { throw new Error('Addon folder and manifest ID differ.'); }
				entries.push(addon);
				if (disabled().has(addon.manifest.id) || !vscode.workspace.isTrusted) { continue; }
				let host;
				const services = createAddonServices(vscode, context, addon, message => host?.notify(message), notifyError);
				host = new AddonHost(addon.main, message => {
					if (message.type === 'information') { void vscode.window.showInformationMessage(message.text); }
					else if (message.type === 'log') { output.appendLine(`[${addon.manifest.id}] ${message.text}`); }
				}, notifyError, async (action, value) => {
					if (!action.startsWith('editor.')) { return services.request(action, value); }
					const permission = action === 'editor.getSelectedText' ? 'editor.read' : 'editor.write';
					if (!(addon.manifest.permissions || []).includes(permission)) { throw new Error(vscode.l10n.t('Addon did not declare permission: {0}', permission)); }
					if (!vscode.workspace.isTrusted) { throw new Error(vscode.l10n.t('The workspace is not trusted.')); }
					const editor = vscode.window.activeTextEditor || lastTextEditor;
					if (!editor || editor.document.isClosed) { throw new Error(vscode.l10n.t('Open a text editor first.')); }
					if (action === 'editor.getSelectedText') { return editor.document.getText(editor.selection); }
					if (typeof value !== 'string' || value.length > 1000000) { throw new Error(vscode.l10n.t('Invalid replacement text.')); }
					return editor.edit(builder => builder.replace(editor.selection, value));
				});
				sessions.push({ async dispose() { try { await services.dispose(); } finally { await host.dispose(); } } });
				host.worker.once('exit', () => { void services.dispose().catch(notifyError); });
				for (const command of addon.manifest.commands) {
					sessions.push(vscode.commands.registerCommand(command.id, () => host.execute(command.id).catch(notifyError)));
				}
			} catch (error) { notifyError(error); }
		}
		if (gallery) { await gallery.refresh(); }
	}
	async function getGalleryState() {
		const installed = new Map(entries.map(addon => [addon.manifest.id, addon]));
		const combined = new Map([...catalog, ...remoteCatalog, ...installed]);
		const addons = [];
		for (const [id, addon] of combined) {
			const manifest = addon.manifest;
			let readme = '';
			try {
				if (!addon.root) { throw Object.assign(new Error('No local README'), { code: 'ENOENT' }); }
				const file = path.join(addon.root, 'README.md');
				const stat = await fs.lstat(file);
				if (stat.isFile() && !stat.isSymbolicLink() && stat.size <= 65536) { readme = await fs.readFile(file, 'utf8'); }
			} catch (error) { if (error.code !== 'ENOENT') { output.appendLine(String(error.message)); } }
			const descriptions = {
				'hello-waifu': vscode.l10n.t('A friendly first addon for your Waifu Code workspace.'),
				uppercase: vscode.l10n.t('Convert selected text to uppercase with a single command. Supports undo.')
			};
			addons.push({
				id, name: manifest.name, version: manifest.version,
				publisher: typeof manifest.publisher === 'string' ? manifest.publisher.slice(0, 100) : remoteCatalog.has(id) ? remoteCatalog.get(id).manifest.publisher : catalog.has(id) ? 'Waifu Code' : vscode.l10n.t('Local addon'),
				description: typeof manifest.description === 'string' ? manifest.description.slice(0, 1000) : remoteCatalog.get(id)?.manifest.description || descriptions[id] || vscode.l10n.t('A local addon for Waifu Code.'),
				installed: installed.has(id), catalog: catalog.has(id) || remoteCatalog.has(id), registry: remoteCatalog.has(id), source: remoteCatalog.has(id) ? registryAddress : undefined, enabled: installed.has(id) && !disabled().has(id),
				permissions: manifest.permissions || [], commands: manifest.commands, readme
			});
		}
		return { trusted: vscode.workspace.isTrusted, registry: { url: registryAddress, error: registryError }, addons: addons.sort((a, b) => a.name.localeCompare(b.name)) };
	}
	function requireTrust() {
		if (!vscode.workspace.isTrusted) { throw new Error(vscode.l10n.t('Trust this workspace before changing addons.')); }
	}
	async function changeAddon(message) {
		requireTrust();
		const addon = entries.find(entry => entry.manifest.id === message.id);
		if (message.action === 'install') {
			const networkAddon = remoteCatalog.get(message.id);
			const available = networkAddon || catalog.get(message.id);
			if (!available) { throw new Error(vscode.l10n.t('This addon is not in the bundled catalog.')); }
			if (networkAddon) {
				const install = vscode.l10n.t('Install');
				const consent = await vscode.window.showWarningMessage(vscode.l10n.t('Install {0} by {1} from {2}? Addons run Node.js code with your user permissions. Only install addons you trust.', available.manifest.name, available.manifest.publisher, registryAddress), { modal: true }, install);
				if (consent !== install) { return; }
				await installRegistryAddon(networkAddon, storage);
			} else { await installAddon(available.root, storage); }
			const state = disabled(); state.delete(message.id);
			await context.globalState.update('disabledAddons', [...state]);
		} else {
			if (!addon) { throw new Error(vscode.l10n.t('This addon is not installed.')); }
			if (message.action === 'enable' || message.action === 'disable') {
				const state = disabled();
				message.action === 'disable' ? state.add(message.id) : state.delete(message.id);
				await context.globalState.update('disabledAddons', [...state]);
			} else if (message.action === 'uninstall') {
				const remove = vscode.l10n.t('Uninstall');
				const consent = await vscode.window.showWarningMessage(vscode.l10n.t('Uninstall {0}?', addon.manifest.name), { modal: true }, remove);
				if (consent !== remove) { return; }
				await stop();
				await fs.rm(addon.root, { recursive: true });
				const state = disabled(); state.delete(message.id);
				await context.globalState.update('disabledAddons', [...state]);
			} else if (message.action === 'run') {
				if (disabled().has(message.id) || !addon.manifest.commands.some(command => command.id === message.command)) { throw new Error(vscode.l10n.t('This addon command is unavailable.')); }
				if (!vscode.window.activeTextEditor && lastTextEditor && !lastTextEditor.document.isClosed) {
					const selection = lastTextEditor.selection;
					const editor = await vscode.window.showTextDocument(lastTextEditor.document, { viewColumn: lastTextEditor.viewColumn });
					editor.selection = selection;
				}
				return vscode.commands.executeCommand(message.command);
			} else { throw new Error(vscode.l10n.t('Unknown addon action.')); }
		}
		await reload();
	}
	let mutations = Promise.resolve();
	async function dispatch(message) {
		if (!message || typeof message.action !== 'string') { throw new Error(vscode.l10n.t('Invalid addon action.')); }
		if (message.action === 'website' || message.action === 'publish') {
			const address = registryAddress || registryUrl(vscode.workspace.getConfiguration?.('waifuAddons').get('registryUrl', DEFAULT_REGISTRY) || DEFAULT_REGISTRY);
			return vscode.env.openExternal(vscode.Uri.parse(address + (message.action === 'publish' ? '/#publish' : '/')));
		}
		if (message.action === 'installPackage') { return vscode.commands.executeCommand('waifu.addons.installPackage'); }
		if (message.action === 'installFolder') { return vscode.commands.executeCommand('waifu.addons.install'); }
		if (typeof message.id !== 'string' || !/^[a-z][a-z0-9-]{1,63}$/.test(message.id)) { throw new Error(vscode.l10n.t('Invalid addon identifier.')); }
		if (message.action === 'details') {
			if (!catalog.has(message.id) && !remoteCatalog.has(message.id) && !entries.some(addon => addon.manifest.id === message.id)) { throw new Error(vscode.l10n.t('This addon was not found.')); }
			return gallery.showDetails(message.id);
		}
		if (!['install', 'enable', 'disable', 'uninstall', 'run'].includes(message.action)) { throw new Error(vscode.l10n.t('Unknown addon action.')); }
		const operation = mutations.then(() => changeAddon(message));
		mutations = operation.catch(() => {});
		return operation;
	}
	gallery = createAddonGallery(vscode, context, getGalleryState, dispatch, notifyError);
	context.subscriptions.push(vscode.commands.registerCommand('waifu.addons.install', async () => {
		try {
			requireTrust();
			const selection = await vscode.window.showOpenDialog({ canSelectFolders: true, canSelectFiles: false, canSelectMany: false, openLabel: vscode.l10n.t('Select Addon Folder') });
			if (!selection) { return; }
			const { manifest } = await readManifest(selection[0].fsPath);
			const install = vscode.l10n.t('Install');
			const consent = await vscode.window.showWarningMessage(vscode.l10n.t('Install {0}? Waifu Addons run Node.js code with your user permissions, including access to files and the network. Only install addons you trust.', manifest.name), { modal: true }, install);
			if (consent !== install) { return; }
			const operation = mutations.then(async () => { await installAddon(selection[0].fsPath, storage); await reload(); });
			mutations = operation.catch(() => {});
			await operation;
		} catch (error) { notifyError(error); }
	}));
	context.subscriptions.push(vscode.commands.registerCommand('waifu.addons.manage', () => vscode.commands.executeCommand('waifu.addons.focus')));
	context.subscriptions.push(vscode.commands.registerCommand('waifu.addons.refresh', async () => { try { await syncRegistry(); await reload(); } catch (error) { notifyError(error); } }));
	context.subscriptions.push(vscode.commands.registerCommand('waifu.addons.details', id => dispatch({ action: 'details', id }).catch(notifyError)));


	context.subscriptions.push(vscode.commands.registerCommand('waifu.addons.website', () => dispatch({ action: 'website' }).catch(notifyError)));
	context.subscriptions.push(vscode.commands.registerCommand('waifu.addons.publish', () => dispatch({ action: 'publish' }).catch(notifyError)));
	context.subscriptions.push(vscode.commands.registerCommand('waifu.addons.installPackage', async () => {
		try {
			requireTrust();
			const selection = await vscode.window.showOpenDialog({ canSelectFiles: true, canSelectFolders: false, canSelectMany: false, filters: { 'Waifu Addon': ['waifu'] }, openLabel: vscode.l10n.t('Install Package') });
			if (!selection) { return; }
			if ((await fs.stat(selection[0].fsPath)).size > 12 * 1024 * 1024) { throw new Error(vscode.l10n.t('Package exceeds 12 MB.')); }
			const bytes = await fs.readFile(selection[0].fsPath);
			const { manifest } = await inspectPackage(bytes);
			const install = vscode.l10n.t('Install');
			const consent = await vscode.window.showWarningMessage(vscode.l10n.t('Install {0} from a local package? Addons run Node.js code with your user permissions. Only install addons you trust.', manifest.name), { modal: true }, install);
			if (consent !== install) { return; }
			const operation = mutations.then(async () => { await installPackage(bytes, storage); await reload(); });
			mutations = operation.catch(() => {}); await operation;
		} catch (error) { notifyError(error); }
	}));
	if (vscode.workspace.onDidChangeConfiguration) { context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(event => { if (event.affectsConfiguration('waifuAddons.registryUrl')) { void syncRegistry().then(() => gallery.refresh()).catch(notifyError); } })); }

	context.subscriptions.push(vscode.workspace.onDidGrantWorkspaceTrust(() => { void reload().catch(notifyError); }));
	context.subscriptions.push(vscode.commands.registerCommand('waifu.welcome', async () => {
		const panel = vscode.window.createWebviewPanel('waifu.welcome', 'Waifu Code', vscode.ViewColumn.One, { enableScripts: false, localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'media')] });
		context.subscriptions.push(panel);
		const mascot = panel.webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, 'media', 'mascot.svg'));
		panel.webview.html = `<!doctype html><html><head><meta charset="UTF-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${panel.webview.cspSource}; style-src 'unsafe-inline'"><style>
		body{margin:0;background:var(--vscode-editor-background);color:var(--vscode-editor-foreground);font-family:var(--vscode-font-family)}main{max-width:960px;margin:8vh auto;padding:32px;display:flex;align-items:center;gap:40px}section{flex:1}.eyebrow{color:#f4a7c5;font-size:12px;letter-spacing:.2em}h1{font-size:48px;letter-spacing:-.04em;margin:16px 0}p{color:var(--vscode-descriptionForeground);font-size:16px;line-height:1.8}img{width:36%;max-width:320px}.pill{display:inline-block;border:1px solid #594263;border-radius:9999px;padding:8px 16px;color:#edb4df}kbd{border:1px solid #594263;border-radius:4px;padding:2px 6px}.hint{font-size:13px}footer{border-top:1px solid #342d43;padding-top:24px;margin-top:32px}@media(max-width:650px){main{flex-direction:column-reverse}img{width:50%}h1{font-size:36px}}</style></head><body><main><section><div class="eyebrow">YOUR LITTLE CODING UNIVERSE</div><h1>Waifu Code <span style="color:#f4a7c5">♡</span></h1><p>A quiet place for big ideas.<br>Your editor. Your aesthetic. Your addons.</p><span class="pill">Waifu Midnight · Code OSS</span><footer><p class="hint">Open a folder to begin. Find <b>Waifu Addons</b> in the heart sidebar to install your own addons.</p><p class="hint">Command palette: <kbd>Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>P</kbd><br>Search for <b>Waifu Addons: Manage Installed Addons</b>.</p></footer></section><img src="${mascot}" alt="Waifu Code mascot with lilac hair and a pink bow"></main></body></html>`;
	}));
	await syncRegistry();
	await reload();
	if (!context.globalState.get('welcomed')) {
		await vscode.commands.executeCommand('waifu.welcome');
		await context.globalState.update('welcomed', true);
	}
	return Object.freeze({ getAddons: getGalleryState, manage: dispatch });
}
exports.activate = activate;
exports.deactivate = () => activeStop?.();
