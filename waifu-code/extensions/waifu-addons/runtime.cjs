/* Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root. */
'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { Worker } = require('node:worker_threads');
const { ACTION_PERMISSIONS, PERMISSIONS } = require('./api-host.cjs');

async function readManifest(directory) {
	const root = await fs.realpath(directory);
	const manifest = JSON.parse(await fs.readFile(path.join(root, 'waifu-addon.json'), 'utf8'));
	if (!/^[a-z][a-z0-9-]{1,63}$/.test(manifest.id) || typeof manifest.name !== 'string' || !/^\d+\.\d+\.\d+$/.test(manifest.version) || manifest.apiVersion !== 1) {
		throw new Error('Invalid Waifu Addon identity, version, or API version.');
	}
	if (typeof manifest.main !== 'string' || path.isAbsolute(manifest.main)) { throw new Error('Addon entry must be a relative path.'); }
	const main = await fs.realpath(path.resolve(root, manifest.main));
	const relative = path.relative(root, main);
	if (relative.startsWith('..') || path.isAbsolute(relative) || !main.endsWith('.cjs')) { throw new Error('Addon entry must be a .cjs file inside its folder.'); }
	if (!Array.isArray(manifest.commands) || manifest.commands.length > 50 || !manifest.commands.every(c => typeof c.id === 'string' && c.id.startsWith(`waifu.${manifest.id}.`) && /^[a-zA-Z0-9.-]+$/.test(c.id) && typeof c.title === 'string')) {
		throw new Error('Invalid addon commands. IDs must start with waifu.<addon-id>.');
	}
	if (manifest.permissions !== undefined && (!Array.isArray(manifest.permissions) || !manifest.permissions.every(p => PERMISSIONS.includes(p)))) { throw new Error('Unsupported addon API permission.'); }
	if (new Set(manifest.commands.map(c => c.id)).size !== manifest.commands.length) { throw new Error('Duplicate addon command.'); }
	return { manifest, main, root };
}

async function installAddon(source, destination) {
	const { manifest, root } = await readManifest(source);
	await fs.mkdir(destination, { recursive: true });
	const target = path.join(destination, manifest.id);
	const stage = await fs.mkdtemp(path.join(destination, '.install-'));
	try {
		await fs.cp(root, stage, { recursive: true, dereference: false, filter: async item => {
			if ((await fs.lstat(item)).isSymbolicLink()) { throw new Error('Symbolic links are not supported in addons.'); }
			return !['node_modules', '.git'].includes(path.basename(item));
		} });
		await readManifest(stage);
		// Never overwrite an existing addon silently.
		try { await fs.lstat(target); throw new Error('Addon already installed. Uninstall it before installing a new version.'); }
		catch (error) { if (error.code !== 'ENOENT') { throw error; } }
		await fs.rename(stage, target);
		return manifest;
	} finally { await fs.rm(stage, { recursive: true, force: true }); }
}

class AddonHost {
	constructor(main, onMessage, onError, onRequest = async () => { throw new Error('Editor API is not available.'); }) {
		this.pending = new Map();
		this.sequence = 0;
		this.worker = new Worker(path.join(__dirname, 'worker.cjs'), { workerData: { main }, resourceLimits: { maxOldGenerationSizeMb: 128 } });
		this.worker.on('message', message => {
			if (!message || typeof message !== 'object') { return; }
			if (message.type === 'api-request' && Number.isSafeInteger(message.id) && (['editor.getSelectedText', 'editor.replaceSelection'].includes(message.action) || Object.hasOwn(ACTION_PERMISSIONS, message.action))) {
				void this.handleRequest(message, onRequest);
			} else if (message.type === 'result' && typeof message.request === 'number' && (message.error === undefined || typeof message.error === 'string')) {
				const pending = this.pending.get(message.request);
				if (pending) { clearTimeout(pending.timer); this.pending.delete(message.request); message.error ? pending.reject(new Error(message.error)) : pending.resolve(); }
			} else if (['information', 'log'].includes(message.type) && typeof message.text === 'string') { onMessage({ type: message.type, text: message.text.slice(0, 10000) }); }
		});
		this.worker.on('error', error => { this.fail(error); onError(error); });
		this.worker.on('exit', code => { this.exited = true; this.stopped = true; this.fail(new Error(`Addon worker exited (${code}).`)); });
	}
	async handleRequest(message, onRequest) {
		let response;
		const interactive = ['files.pickFolder', 'files.pickImages', 'files.saveDialog'].includes(message.action);
		if (interactive) { this.dialogs = (this.dialogs || 0) + 1; this.resetDeadlines(130000); }
		try { response = { type: 'api-result', id: message.id, value: await onRequest(message.action, message.value) }; }
		catch (error) { response = { type: 'api-result', id: message.id, error: String(error.message || error) }; }
		finally { if (interactive && --this.dialogs === 0) { this.resetDeadlines(10000); } }
		if (!this.exited) { this.worker.postMessage(response); }
	}
	resetDeadlines(milliseconds) { for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.timer = setTimeout(pending.expire, milliseconds); } }
	fail(error) { for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(error); } this.pending.clear(); }
	execute(command) {
		if (this.stopped) { return Promise.reject(new Error('Addon stopped. Disable and enable it to restart.')); }
		return new Promise((resolve, reject) => {
			const request = ++this.sequence;
			const expire = () => { this.pending.delete(request); reject(new Error('Addon command timed out.')); void this.dispose(); };
			const timer = setTimeout(expire, this.dialogs ? 130000 : 10000);
			this.pending.set(request, { resolve, reject, timer, expire });
			this.worker.postMessage({ command, request });
		});
	}
	notify(message) { if (!this.stopped) { this.worker.postMessage(message); } }
	dispose() {
		if (this.disposal) { return this.disposal; }
		if (this.exited) { return Promise.resolve(); }
		this.stopped = true; this.fail(new Error('Addon stopped.'));
		this.disposal = new Promise(resolve => {
			const timer = setTimeout(() => { void this.worker.terminate().finally(resolve); }, 1500);
			this.worker.once('exit', () => { clearTimeout(timer); resolve(); });
			this.worker.postMessage({ type: 'shutdown' });
		});
		return this.disposal;
	}
}
module.exports = { readManifest, installAddon, AddonHost };
