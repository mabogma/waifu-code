/* Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root. */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { readManifest, installAddon, AddonHost } = require('../runtime.cjs');
const example = path.join(__dirname, '../examples/hello');
async function temporary(t) {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), 'waifu-test-'));
	t.after(() => fs.rm(root, { recursive: true, force: true }));
	return root;
}
test('install, reload manifest, execute a real addon, and reject overwrite', async t => {
	const root = await temporary(t);
	await installAddon(example, root);
	const addon = await readManifest(path.join(root, 'hello-waifu'));
	const messages = [];
	const host = new AddonHost(addon.main, message => messages.push(message), error => assert.fail(error));
	t.after(() => host.dispose());
	await host.execute('waifu.hello-waifu.greet');
	assert.equal(messages[0].type, 'information');
	assert.match(messages[0].text, /Waifu Code/);
	await assert.rejects(installAddon(example, root), /already installed/);
});
test('reject path traversal and foreign command namespaces', async t => {
	const root = await temporary(t);
	await fs.writeFile(path.join(root, 'outside.cjs'), '');
	const folder = path.join(root, 'addon');
	await fs.mkdir(folder);
	const manifest = { id: 'test-addon', name: 'Test', version: '1.0.0', apiVersion: 1, main: '../outside.cjs', commands: [] };
	await fs.writeFile(path.join(folder, 'waifu-addon.json'), JSON.stringify(manifest));
	await assert.rejects(readManifest(folder), /inside its folder/);
	manifest.main = 'main.cjs';
	manifest.commands = [{ id: 'workbench.action.closeWindow', title: 'Bad' }];
	await fs.writeFile(path.join(folder, 'main.cjs'), '');
	await fs.writeFile(path.join(folder, 'waifu-addon.json'), JSON.stringify(manifest));
	await assert.rejects(readManifest(folder), /Invalid addon commands/);
});
test('activation errors return to host without taking down the editor', async t => {
	const root = await temporary(t);
	const main = path.join(root, 'bad.cjs');
	await fs.writeFile(main, 'exports.activate = () => { throw new Error("broken addon"); };');
	const host = new AddonHost(main, () => {}, error => assert.fail(error));
	t.after(() => host.dispose());
	await assert.rejects(host.execute('waifu.bad.run'), /broken addon/);
});
test('worker termination rejects in-flight commands', async t => {
	const root = await temporary(t);
	const main = path.join(root, 'slow.cjs');
	await fs.writeFile(main, 'exports.activate = api => api.commands.register("waifu.slow.run", () => new Promise(() => {}));');
	const host = new AddonHost(main, () => {}, error => assert.fail(error));
	const result = host.execute('waifu.slow.run');
	host.dispose();
	await assert.rejects(result, /stopped/);
});

test('malformed addon messages cannot crash the manager', async t => {
	const root = await temporary(t);
	const main = path.join(root, 'messages.cjs');
	await fs.writeFile(main, `exports.activate = api => {
		const port = require('node:worker_threads').parentPort;
		port.postMessage(null);
		port.postMessage({type:'information',text:{invalid:true}});
		api.commands.register('waifu.messages.run', () => api.window.showInformationMessage('valid'));
	};`);
	const messages = [];
	const host = new AddonHost(main, message => messages.push(message), error => assert.fail(error));
	t.after(() => host.dispose());
	await host.execute('waifu.messages.run');
	assert.deepEqual(messages, [{ type: 'information', text: 'valid' }]);
});

test('editor API performs round trips across the worker boundary', async t => {
	const addon = await readManifest(path.join(__dirname, '../examples/uppercase'));
	const edits = [];
	const host = new AddonHost(addon.main, () => {}, error => assert.fail(error), async (action, value) => {
		if (action === 'editor.getSelectedText') { return 'waifu code'; }
		edits.push(value);
		return true;
	});
	t.after(() => host.dispose());
	await host.execute('waifu.uppercase.selection');
	assert.deepEqual(edits, ['WAIFU CODE']);
});

test('editor API failures propagate to the addon command', async t => {
	const addon = await readManifest(path.join(__dirname, '../examples/uppercase'));
	const host = new AddonHost(addon.main, () => {}, error => assert.fail(error), async () => { throw new Error('permission denied'); });
	t.after(() => host.dispose());
	await assert.rejects(host.execute('waifu.uppercase.selection'), /permission denied/);
});
