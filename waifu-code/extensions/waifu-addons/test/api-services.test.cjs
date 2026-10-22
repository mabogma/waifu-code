/* Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root. */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { createAddonServices, PERMISSIONS } = require('../api-host.cjs');
const { AddonHost } = require('../runtime.cjs');
async function setup(t) {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), 'waifu-services-'));
	const state = new Map(), secrets = new Map(), events = [], errors = [], panels = [], progress = [];
	let selected, save;
	const uri = file => ({ fsPath: file, toString: () => `https://resource.invalid/${path.basename(file)}` });
	const disposable = { dispose() {} };
	const vscode = {
		workspace: { isTrusted: true }, l10n: { t: (text, ...args) => text.replace(/\{(\d+)\}/g, (_, n) => args[n]) },
		Uri: { file: uri }, ViewColumn: { One: 1 }, ProgressLocation: { Notification: 15 },
		window: {
			showOpenDialog: async () => selected, showSaveDialog: async () => save,
			createWebviewPanel(type, title, column, options) {
				let disposed, receive;
				const item = { options, title, closed: false, onDidDispose(fn) { disposed = fn; return disposable; }, dispose() { if (!this.closed) { this.closed = true; disposed?.(); } },
					webview: { cspSource: 'https://resource.invalid', asWebviewUri: value => value, onDidReceiveMessage(fn) { receive = fn; return disposable; }, postMessage: async value => { item.last = value; return true; } }, receive: message => receive(message) };
				panels.push(item); return item;
			},
			async withProgress(options, fn) {
				const task = { reports: [] }; progress.push(task);
				await fn({ report: value => task.reports.push(value) }, { isCancellationRequested: false, onCancellationRequested(callback) { task.cancel = callback; return disposable; } }); task.done = true;
			}
		}
	};
	const context = { globalStorageUri: uri(path.join(root, 'storage')), globalState: { get: (key, fallback) => state.has(key) ? state.get(key) : fallback, keys: () => [...state.keys()], update: async (key, value) => { if (value === undefined) { state.delete(key); } else { state.set(key, value); } } }, secrets: { get: async key => secrets.get(key), store: async (key, value) => secrets.set(key, value), delete: async key => secrets.delete(key) } };
	const create = (id = 'test-addon', permissions = PERMISSIONS) => createAddonServices(vscode, context, { manifest: { id, name: id, permissions } }, event => events.push(event), error => errors.push(error));
	const service = create();
	t.after(async () => { await service.dispose(); await fs.rm(root, { recursive: true, force: true }); });
	return { root, service, create, context, state, secrets, vscode, events, errors, panels, progress, select(files) { selected = files.map(uri); }, save(file) { save = uri(file); } };
}
test('file grants reject arbitrary handles, traversal, non-image resources and writes without Save As', async t => {
	const x = await setup(t), folder = path.join(x.root, 'photos'); await fs.mkdir(folder);
	await fs.writeFile(path.join(folder, 'photo.png'), Buffer.from([137, 80, 78, 71])); await fs.writeFile(path.join(folder, 'token.txt'), 'private');
	x.select([folder]); const grant = await x.service.request('files.pickFolder');
	assert.ok((await x.service.request('files.list', { handle: grant.handle })).some(file => file.image));
	assert.equal((await x.service.request('files.read', { handle: grant.handle, path: 'token.txt' })).length, 7);
	await assert.rejects(x.service.request('files.read', { handle: grant.handle, path: '../outside' }), /relative path/);
	await assert.rejects(x.service.request('files.read', { handle: 'invented' }), /handle/);
	await assert.rejects(x.service.request('files.write', { handle: grant.handle, bytes: new Uint8Array(1) }), /denied/);
	const panel = await x.service.request('panels.create', { title: 'Photos', html: '<h1>Photos</h1>', script: 'void 0' });
	assert.deepEqual(x.panels[0].options.localResourceRoots, []);
	assert.match(x.panels[0].webview.html, /connect-src 'none'/); assert.match(x.panels[0].webview.html, /script-src 'nonce-/);
	await assert.rejects(x.service.request('panels.image', { id: panel, handle: grant.handle, path: 'token.txt' }), /raster image/);
	await x.service.request('panels.image', { id: panel, handle: grant.handle, path: 'photo.png' });
	const cache = x.panels[0].webview.options.localResourceRoots[0].fsPath;
	assert.ok(!cache.startsWith(folder)); assert.equal((await fs.readdir(cache)).length, 1);
	const output = path.join(x.root, 'saved.png'); x.save(output); const destination = await x.service.request('files.saveDialog', { name: 'photo.png' });
	await x.service.request('files.write', { handle: destination.handle, bytes: new Uint8Array([1, 2]) }); assert.deepEqual([...await fs.readFile(output)], [1, 2]);
	await x.service.dispose(); assert.equal(x.panels[0].closed, true); await assert.rejects(fs.access(cache));
});
test('settings and secrets are separate, namespaced and permission protected', async t => {
	const x = await setup(t), other = x.create('other-addon'), denied = x.create('no-access', []); t.after(() => other.dispose()); t.after(() => denied.dispose());
	await x.service.request('settings.set', { key: 'size', value: 180 }); await x.service.request('secrets.set', { key: 'token', value: 'private-token' });
	assert.equal(await x.service.request('settings.get', { key: 'size' }), 180);
	assert.equal(await x.service.request('secrets.get', { key: 'token' }), 'private-token');
	assert.equal(await other.request('secrets.get', { key: 'token' }), undefined); assert.equal(await other.request('settings.get', { key: 'size', fallback: 1 }), 1);
	assert.ok(!JSON.stringify([...x.state]).includes('private-token'));
	await assert.rejects(denied.request('secrets.get', { key: 'token' }), /permission/);
	await assert.rejects(x.service.request('settings.set', { key: '../bad', value: true }), /key/);
	await assert.rejects(x.service.request('settings.set', { key: 'large', value: 'x'.repeat(70000) }), /large/);
	x.vscode.workspace.isTrusted = false; await assert.rejects(x.service.request('settings.get', { key: 'size' }), /trusted/);
});
test('progress cancellation and session shutdown close tasks and panels', async t => {
	const x = await setup(t); await x.service.request('tasks.begin', { id: 'one', title: 'Download' }); await x.service.request('tasks.report', { id: 'one', message: 'Half', increment: 50 });
	assert.equal(x.progress[0].reports[0].increment, 50); x.progress[0].cancel();
	assert.ok(x.events.some(event => event.type === 'task-cancel' && event.id === 'one'));
	await x.service.request('tasks.begin', { id: 'two', title: 'Preload' }); await x.service.request('panels.create', { title: 'Panel' });
	await x.service.dispose(); await new Promise(resolve => setImmediate(resolve));
	assert.ok(x.progress.every(task => task.done)); assert.ok(x.panels.every(panel => panel.closed));
	await assert.rejects(x.service.request('tasks.begin', { id: 'three', title: 'No' }), /stopped/);
});
test('real Worker runs background work beyond 10 seconds, cancels, and executes deactivate cleanup', async t => {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), 'waifu-worker-api-')), main = path.join(root, 'main.cjs'), marker = path.join(root, 'cleanup.txt');
	await fs.writeFile(main, `exports.activate = api => { api.commands.register('start', async () => { await api.tasks.start('Background', async ({signal,report}) => { await report('started', 1); await new Promise(resolve => { if(signal.aborted)return resolve(); signal.addEventListener('abort', resolve, {once:true}); }); api.log('aborted'); }); }); api.lifecycle.onDispose(() => require('node:fs').appendFileSync(${JSON.stringify(marker)}, 'hook;')); }; exports.deactivate=()=>require('node:fs').appendFileSync(${JSON.stringify(marker)}, 'deactivate;');`);
	const messages = [], requests = [], errors = [];
	const host = new AddonHost(main, message => messages.push(message), error => errors.push(error), async (action, value) => { requests.push({ action, value }); return value.id || true; });
	t.after(async () => { await host.dispose(); await fs.rm(root, { recursive: true, force: true }); });
	await host.execute('start'); await new Promise(resolve => setTimeout(resolve, 10500));
	assert.equal(host.stopped, undefined); assert.ok(requests.some(request => request.action === 'tasks.report'));
	host.notify({ type: 'task-cancel', id: requests.find(request => request.action === 'tasks.begin').value.id });
	for (let n = 0; n < 50 && !messages.some(message => message.text === 'aborted'); n++) { await new Promise(resolve => setTimeout(resolve, 10)); }
	assert.ok(messages.some(message => message.text === 'aborted')); await host.dispose();
	assert.match(await fs.readFile(marker, 'utf8'), /hook;/); assert.match(await fs.readFile(marker, 'utf8'), /deactivate;/); assert.deepEqual(errors, []);
});
