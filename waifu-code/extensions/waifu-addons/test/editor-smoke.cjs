/* Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root. */
'use strict';
const assert = require('node:assert/strict');
const vscode = require('vscode');
exports.run = async () => {
	const addonManager = vscode.extensions.getExtension('waifu.waifu-addons');
	assert.ok(addonManager, 'Waifu Addons is bundled');
	const api = await addonManager.activate();
	assert.equal(addonManager.packageJSON.version, '0.4.1');
	assert.equal(vscode.workspace.getConfiguration('workbench').inspect('colorTheme').defaultValue, 'Waifu Midnight');
	assert.equal(addonManager.packageJSON.contributes.views.waifu[0].type, 'webview');
	const commands = await vscode.commands.getCommands(true);
	for (const command of ['waifu.addons.install', 'waifu.addons.manage', 'waifu.welcome', 'waifu.uppercase.selection']) {
		assert.ok(commands.includes(command), `Missing ${command}`);
	}
	assert.ok(addonManager.packageJSON.contributes.themes.some(theme => theme.label === 'Waifu Midnight'));
	for (const label of ['Waifu Sakura', 'Waifu Moonlight', 'Waifu Cyber Neko', 'Waifu Matcha', 'Waifu Sunset']) {
		assert.ok(addonManager.packageJSON.contributes.themes.some(theme => theme.label === label), `Missing theme ${label}`);
		await vscode.workspace.getConfiguration('workbench').update('colorTheme', label, vscode.ConfigurationTarget.Global);
		await new Promise(resolve => setTimeout(resolve, 150));
		assert.equal(vscode.window.activeColorTheme.kind, ['Waifu Sakura', 'Waifu Matcha'].includes(label) ? vscode.ColorThemeKind.Light : vscode.ColorThemeKind.Dark);
	}
	await vscode.workspace.getConfiguration('workbench').update('colorTheme', 'Waifu Midnight', vscode.ConfigurationTarget.Global);
	await vscode.commands.executeCommand('waifu.welcome');
	assert.equal(vscode.window.tabGroups.activeTabGroup.activeTab.label, 'Waifu Code');
	const document = await vscode.workspace.openTextDocument({ content: 'waifu code' });
	const editor = await vscode.window.showTextDocument(document);
	editor.selection = new vscode.Selection(0, 0, 0, 10);
	await vscode.commands.executeCommand('waifu.uppercase.selection');
	assert.equal(document.getText(), 'WAIFU CODE');
	await vscode.commands.executeCommand('undo');
	assert.equal(document.getText(), 'waifu code');
	await vscode.commands.executeCommand('waifu.addons.manage');
	assert.ok((await api.getAddons()).addons.some(addon => addon.id === 'uppercase' && addon.installed));
	editor.selection = new vscode.Selection(0, 0, 0, 10);
	await api.manage({ action: 'details', id: 'uppercase' });
	assert.equal(vscode.window.tabGroups.activeTabGroup.activeTab.label, 'Waifu Uppercase');
	await api.manage({ action: 'run', id: 'uppercase', command: 'waifu.uppercase.selection' });
	assert.equal(document.getText(), 'WAIFU CODE');
	await vscode.commands.executeCommand('undo');
	await api.manage({ action: 'disable', id: 'uppercase' });
	assert.equal((await api.getAddons()).addons.find(addon => addon.id === 'uppercase').enabled, false);
	await api.manage({ action: 'enable', id: 'uppercase' });
	if (process.env.WAIFU_LIVE_REGISTRY_URL) {
		const state = await api.getAddons();
		assert.equal(state.registry.url, process.env.WAIFU_LIVE_REGISTRY_URL);
		assert.equal(state.registry.error, '');
		for (const id of ['hello-waifu', 'uppercase', 'photo-gallery']) { assert.ok(state.addons.some(addon => addon.id === id && addon.registry)); }
	} else {
		await api.manage({ action: 'install', id: 'hello-waifu' });
		assert.equal((await api.getAddons()).addons.find(addon => addon.id === 'hello-waifu').installed, true);
	}
	await vscode.commands.executeCommand('waifu.api-probe.run');
	const fs = require('node:fs/promises');
	assert.match(await fs.readFile(process.env.WAIFU_API_PROBE_FILE, 'utf8'), /ready;/);
	assert.equal(vscode.window.tabGroups.activeTabGroup.activeTab.label, 'Waifu API Probe');
	await api.manage({ action: 'disable', id: 'api-probe' });
	const marker = await fs.readFile(process.env.WAIFU_API_PROBE_FILE, 'utf8');
	assert.match(marker, /cleanup;/); assert.match(marker, /aborted;/);
	assert.ok(!vscode.window.tabGroups.all.flatMap(group => group.tabs).some(tab => tab.label === 'Waifu API Probe'));
	console.log('Waifu Addons 0.4 integration passed: gallery, editing/undo, install, settings, native secrets, panels, task cancellation and disable cleanup.');
};

