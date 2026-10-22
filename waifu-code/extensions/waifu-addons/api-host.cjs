/* Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root. */
'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID, randomBytes } = require('node:crypto');
const PERMISSIONS = ['editor.read', 'editor.write', 'ui.panels', 'files.read', 'files.write', 'tasks.background', 'storage.settings', 'storage.secrets'];
const ACTION_PERMISSIONS = {
	'panels.create': 'ui.panels', 'panels.postMessage': 'ui.panels', 'panels.dispose': 'ui.panels', 'panels.image': 'ui.panels',
	'files.pickFolder': 'files.read', 'files.pickImages': 'files.read', 'files.list': 'files.read', 'files.read': 'files.read',
	'files.saveDialog': 'files.write', 'files.write': 'files.write',
	'tasks.begin': 'tasks.background', 'tasks.report': 'tasks.background', 'tasks.end': 'tasks.background',
	'settings.get': 'storage.settings', 'settings.set': 'storage.settings',
	'secrets.get': 'storage.secrets', 'secrets.set': 'storage.secrets', 'secrets.delete': 'storage.secrets'
};
const IMAGE = /\.(png|jpe?g|webp|gif|bmp)$/i;
const MAX_BYTES = 20 * 1024 * 1024;
function text(value, max = 200) {
	if (typeof value !== 'string' || !value.trim() || value.length > max) { throw new Error('Invalid text value.'); }
	return value;
}
function json(value, max = 65536) {
	const result = JSON.stringify(value);
	if (result === undefined || Buffer.byteLength(result) > max) { throw new Error('JSON value is missing or too large.'); }
	return JSON.parse(result);
}
function key(value) { if (typeof value !== 'string' || !/^[a-zA-Z0-9_.-]{1,100}$/.test(value)) { throw new Error('Invalid storage key.'); } return value; }
function inside(root, target) { const relative = path.relative(root, target); return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative)); }

/** Editor-side services for exactly one addon session. File and panel handles never cross sessions. */
function createAddonServices(vscode, context, addon, notify, onError) {
	const grants = new Map(), panels = new Map(), tasks = new Map(), imageOperations = new Set();
	const prefix = `addon.${addon.manifest.id}.`;
	let stopped = false;
	let settingsQueue = Promise.resolve();
	let imageQueue = Promise.resolve();
	let disposal;
	function requirePermission(permission) {
		if (!(addon.manifest.permissions || []).includes(permission)) { throw new Error(`Addon did not declare permission: ${permission}`); }
	}
	async function grant(file, mode, folder = false) {
		const id = randomUUID();
		const resolved = mode === 'save' ? path.join(await fs.realpath(path.dirname(file)), path.basename(file)) : await fs.realpath(file);
		if (stopped) { throw new Error('Addon stopped.'); }
		grants.set(id, { file: resolved, mode, folder });
		return { handle: id, name: path.basename(resolved), directory: folder };
	}
	async function resolveFile(handle, relative = '', write = false) {
		const entry = grants.get(handle);
		if (!entry || (write && entry.mode !== 'save')) { throw new Error('Unknown file handle or access denied.'); }
		if (relative && (!entry.folder || typeof relative !== 'string' || relative.includes('\\') || relative.includes(':') || relative.split('/').some(part => !part || part === '.' || part === '..'))) { throw new Error('Invalid relative path.'); }
		const target = relative ? path.resolve(entry.file, relative) : entry.file;
		if (entry.folder && !inside(entry.file, target)) { throw new Error('File is outside the selected folder.'); }
		// Read grants follow only targets which remain inside the original selected root.
		if (!write) {
			const real = await fs.realpath(target);
			if (entry.folder ? !inside(entry.file, real) : real !== entry.file) { throw new Error('File escaped the selected location.'); }
			return real;
		}
		return target;
	}
	function panel(id) { const value = panels.get(id); if (!value) { throw new Error('Panel is closed or unavailable.'); } return value; }
	function finishTask(id) {
		const task = tasks.get(id);
		if (task) { tasks.delete(id); task.subscription?.dispose(); task.finish(); }
	}
	async function request(action, input = {}) {
		if (stopped || !vscode.workspace.isTrusted) { throw new Error('Addon stopped or workspace is not trusted.'); }
		const permission = ACTION_PERMISSIONS[action];
		if (!permission) { throw new Error('Unknown addon API action.'); }
		requirePermission(permission);
		switch (action) {
			case 'files.pickFolder': {
				const selected = await vscode.window.showOpenDialog({ canSelectFolders: true, canSelectFiles: false, canSelectMany: false, title: vscode.l10n.t('Select folder for {0}', addon.manifest.name) });
				return selected?.length ? grant(selected[0].fsPath, 'read', true) : null;
			}
			case 'files.pickImages': {
				const selected = await vscode.window.showOpenDialog({ canSelectFolders: false, canSelectFiles: true, canSelectMany: true, filters: { Images: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'] }, title: vscode.l10n.t('Select images for {0}', addon.manifest.name) });
				if ((selected?.length || 0) > 500) { throw new Error('Select at most 500 images.'); }
				return Promise.all((selected || []).filter(uri => IMAGE.test(uri.fsPath)).map(uri => grant(uri.fsPath, 'read')));
			}
			case 'files.saveDialog': {
				const name = text(input.name || 'image.png', 100);
				if (/[\\/:\x00-\x1f]/.test(name) || name === '.' || name === '..') { throw new Error('Invalid suggested filename.'); }
				const chosen = await vscode.window.showSaveDialog({ defaultUri: vscode.Uri.file(path.join(require('node:os').homedir(), name)), title: vscode.l10n.t('Save file from {0}', addon.manifest.name) });
				return chosen ? grant(chosen.fsPath, 'save') : null;
			}
			case 'files.list': {
				const directory = await resolveFile(input.handle, input.path);
				const entries = await fs.readdir(directory, { withFileTypes: true });
				if (entries.length > 2000) { throw new Error('Folder has more than 2000 entries. Select a smaller folder.'); }
				return entries.filter(entry => !entry.isSymbolicLink()).map(entry => ({ name: entry.name, directory: entry.isDirectory(), image: entry.isFile() && IMAGE.test(entry.name) }));
			}
			case 'files.read': {
				const file = await resolveFile(input.handle, input.path);
				if ((await fs.stat(file)).size > MAX_BYTES) { throw new Error('File exceeds 20 MiB.'); }
				const bytes = await fs.readFile(file);
				if (bytes.length > MAX_BYTES) { throw new Error('File exceeds 20 MiB.'); }
				return new Uint8Array(bytes);
			}
			case 'files.write': {
				const file = await resolveFile(input.handle, '', true);
				if (!(input.bytes instanceof Uint8Array) || input.bytes.length > MAX_BYTES) { throw new Error('Expected bytes up to 20 MiB.'); }
				// Never follow an existing symbolic link, and replace only the exact path approved by Save As.
				try { if ((await fs.lstat(file)).isSymbolicLink()) { throw new Error('Cannot replace a symbolic link.'); } } catch (error) { if (error.code !== 'ENOENT') { throw error; } }
				const temporary = path.join(path.dirname(file), `.waifu-${randomUUID()}.tmp`);
				try {
					await fs.writeFile(temporary, input.bytes, { flag: 'wx' });
					if (stopped) { throw new Error('Addon stopped.'); }
					await fs.rename(temporary, file);
				} finally { await fs.rm(temporary, { force: true }); }
				return true;
			}
			case 'panels.create': {
				if (panels.size >= 5) { throw new Error('An addon can open at most 5 panels.'); }
				const title = text(input.title, 100);
				for (const field of ['html', 'script', 'style']) { if (input[field] !== undefined && (typeof input[field] !== 'string' || input[field].length > 200000)) { throw new Error('Panel content is too large.'); } }
				const id = randomUUID();
				const item = vscode.window.createWebviewPanel(`waifu.addon.${addon.manifest.id}`, title, vscode.ViewColumn.One, { enableScripts: true, localResourceRoots: [] });
				const nonce = randomBytes(24).toString('hex');
				item.webview.html = `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${item.webview.cspSource} blob:; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}'; connect-src 'none'; base-uri 'none'; form-action 'none';"><style nonce="${nonce}">${(input.style || '').replace(/<\/style/gi, '<\\/style')}</style></head><body>${input.html || ''}<script nonce="${nonce}">${(input.script || '').replace(/<\/script/gi, '<\\/script')}</script></body></html>`;
				const subscriptions = [];
				panels.set(id, { item, roots: new Map(), subscriptions, bytes: 0 });
				subscriptions.push(item.webview.onDidReceiveMessage(message => { try { notify({ type: 'panel-message', panel: id, value: json(message) }); } catch (error) { onError(error); } }));
				subscriptions.push(item.onDidDispose(() => {
					panels.delete(id); for (const subscription of subscriptions) { subscription.dispose(); } notify({ type: 'panel-disposed', panel: id });
					void Promise.allSettled([...imageOperations]).then(() => fs.rm(path.join(context.globalStorageUri.fsPath, 'panel-images', addon.manifest.id, id), { recursive: true, force: true })).catch(onError);
				}));
				return id;
			}
			case 'panels.postMessage': return panel(input.id).item.webview.postMessage(json(input.message));
			case 'panels.dispose': panel(input.id).item.dispose(); return true;
			case 'panels.image': {
				requirePermission('files.read');
				const file = await resolveFile(input.handle, input.path);
				if (!IMAGE.test(file) || (await fs.stat(file)).size > MAX_BYTES) { throw new Error('Expected a raster image up to 20 MiB.'); }
				const entry = panel(input.id);
				// Snapshot grants into an isolated cache; webview roots never expose the selected folder.
				const directory = path.join(context.globalStorageUri.fsPath, 'panel-images', addon.manifest.id, input.id);
				if (!entry.roots.has(file) && entry.roots.size >= 200) { throw new Error('A panel can expose at most 200 images.'); }
				if (entry.roots.has(file)) { return entry.item.webview.asWebviewUri(vscode.Uri.file(entry.roots.get(file))).toString(); }
				await fs.mkdir(directory, { recursive: true });
				const destination = entry.roots.get(file) || path.join(directory, randomUUID() + path.extname(file).toLowerCase());
				const bytes = await fs.readFile(file);
				if (bytes.length > MAX_BYTES) { throw new Error('Image exceeds 20 MiB.'); }
				if (entry.bytes + bytes.length > 64 * 1024 * 1024) { throw new Error('Panel image cache exceeds 64 MiB.'); }
				if (stopped || !panels.has(input.id)) { throw new Error('Panel is closed.'); }
				await fs.writeFile(destination, bytes);
				entry.bytes += bytes.length;
				entry.roots.set(file, destination);
				entry.item.webview.options = { enableScripts: true, localResourceRoots: [vscode.Uri.file(directory)] };
				return entry.item.webview.asWebviewUri(vscode.Uri.file(destination)).toString();
			}
			case 'tasks.begin': {
				if (tasks.size >= 8 || tasks.has(input.id)) { throw new Error('Too many background tasks or duplicate id.'); }
				text(input.id, 100); text(input.title, 100);
				let finish;
				const completion = new Promise(resolve => { finish = resolve; });
				const task = { finish, subscription: undefined, progress: undefined };
				tasks.set(input.id, task);
				void vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `${addon.manifest.name}: ${input.title}`, cancellable: true }, async (progress, token) => {
					task.progress = progress;
					task.subscription = token.onCancellationRequested(() => { notify({ type: 'task-cancel', id: input.id }); finishTask(input.id); });
					if (token.isCancellationRequested) { notify({ type: 'task-cancel', id: input.id }); finishTask(input.id); }
					try { await completion; } finally { task.subscription?.dispose(); }
				}).catch(error => { finishTask(input.id); onError(error); });
				return input.id;
			}
			case 'tasks.report': {
				const task = tasks.get(input.id);
				if (!task) { return false; }
				const increment = input.increment;
				if (increment !== undefined && (!Number.isFinite(increment) || increment < 0 || increment > 100)) { throw new Error('Invalid progress increment.'); }
				task.progress?.report({ message: typeof input.message === 'string' ? input.message.slice(0, 200) : '', increment });
				return true;
			}
			case 'tasks.end': finishTask(input.id); return true;
			case 'settings.get': return context.globalState.get(prefix + key(input.key), input.fallback);
			case 'settings.set': {
				const storageKey = prefix + key(input.key);
				const value = input.value === undefined ? undefined : json(input.value);
				const operation = settingsQueue.then(async () => {
					const keys = context.globalState.keys().filter(value => value.startsWith(prefix));
					if (!keys.includes(storageKey) && keys.length >= 100 && value !== undefined) { throw new Error('Settings key limit reached.'); }
					await context.globalState.update(storageKey, value);
				});
				settingsQueue = operation.catch(() => {}); await operation; return true;
			}
			case 'secrets.get': return context.secrets.get(prefix + key(input.key));
			case 'secrets.set': text(input.value, 16000); await context.secrets.store(prefix + key(input.key), input.value); return true;
			case 'secrets.delete': await context.secrets.delete(prefix + key(input.key)); return true;
		}
	}
	async function dispose() {
		stopped = true;
		for (const id of tasks.keys()) { notify({ type: 'task-cancel', id }); finishTask(id); }
		for (const value of [...panels.values()]) { value.item.dispose(); }
		panels.clear(); grants.clear();
		await settingsQueue;
		await Promise.allSettled([...imageOperations]);
		await fs.rm(path.join(context.globalStorageUri.fsPath, 'panel-images', addon.manifest.id), { recursive: true, force: true });
	}
	return { request(action, input) {
		const operation = action === 'panels.image' ? imageQueue.then(() => request(action, input)) : request(action, input);
		if (action === 'panels.image') { imageQueue = operation.catch(() => {}); }
		if (action === 'panels.image') { imageOperations.add(operation); void operation.finally(() => imageOperations.delete(operation)).catch(() => {}); }
		return operation;
	}, dispose() { if (!disposal) { disposal = dispose(); } return disposal; } };
}
module.exports = { createAddonServices, ACTION_PERMISSIONS, PERMISSIONS };
