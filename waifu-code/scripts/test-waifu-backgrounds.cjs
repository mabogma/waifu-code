/* Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root. */
'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { chromium } = require('playwright');
async function main() {
	if (!process.argv[2]) { throw new Error('Usage: node test-waifu-backgrounds.cjs <Windows application folder> [result directory]'); }
	const app = path.resolve(process.argv[2], 'resources/app');
	const output = path.resolve(process.argv[3] || path.join(__dirname, '../../work/theme-rendering'));
	await fs.mkdir(output, { recursive: true });
	const manifest = JSON.parse(await fs.readFile(path.join(app, 'extensions/waifu-addons/package.json'), 'utf8'));
	let html = '';
	const requests = [];
	const server = http.createServer(async (request, response) => {
		try {
			const url = new URL(request.url, 'http://localhost');
			if (url.pathname === '/') { response.setHeader('Content-Type', 'text/html'); response.end(html); return; }
			const file = path.resolve(app, '.' + decodeURIComponent(url.pathname));
			if (!file.startsWith(app + path.sep) || !/\.(css|png)$/.test(file)) { response.writeHead(404).end(); return; }
			const data = await fs.readFile(file);
			requests.push(url.pathname);
			response.setHeader('Content-Type', file.endsWith('.css') ? 'text/css' : 'image/png');
			response.end(data);
		} catch { response.writeHead(404).end(); }
	});
	await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
	let browser;
	const results = [];
	try {
		browser = await chromium.launch({ headless: true, executablePath: process.env.WAIFU_TEST_BROWSER || undefined });
		const page = await browser.newPage({ viewport: { width: 1200, height: 800 }, deviceScaleFactor: 1 });
		for (const entry of manifest.contributes.themes) {
			const id = path.basename(entry.path, '.json');
			const theme = JSON.parse(await fs.readFile(path.join(app, 'extensions/waifu-addons', entry.path), 'utf8'));
			const variables = Object.entries(theme.colors).map(([key, value]) => '--vscode-' + key.replaceAll('.', '-') + ':' + value).join(';');
			for (const floating of [false, true]) {
				const label = id + (floating ? '-floating' : '-standard');
				// This matches the workbench's grid -> editor structure. Floating panels add
				// an opaque shell background in the shipped stylesheet: the 0.4.2 regression.
				html = `<!doctype html><html><head><link rel="stylesheet" href="/out/vs/workbench/workbench.desktop.main.css"><style>html,body{width:100%;height:100%;margin:0}:root{${variables};--modern-ui-shell-background:${theme.colors['sideBar.background']}}.monaco-workbench{width:100vw;height:100vh}.monaco-grid-view,.part.editor,.part.editor>.content{width:100%;height:100%}p{margin:0;padding:30px;font-size:18px;color:${theme.colors['editor.foreground']}}</style></head><body><div class="monaco-workbench windows ${entry.uiTheme} modern-ui ${floating ? 'floating-panels' : ''} waifu-waifu-addons-themes-${id}-json"><div class="monaco-grid-view"><section class="part editor" style="background-color:${theme.colors['editor.background']}"><div class="content"><div class="editor-group-container"><div class="editor-instance"><p>const greeting = 'Hello, Waifu!';</p></div></div></div></section></div><div class="quick-input-widget" style="position:absolute;left:30px;top:90px;padding:10px;background-color:${theme.colors['sideBar.background']}">Readable popup</div></div></body></html>`;
				requests.length = 0;
				await page.goto('http://127.0.0.1:' + server.address().port, { waitUntil: 'networkidle' });
				assert.ok(requests.some(url => url.endsWith('/backgrounds/' + id + '.png')), label + ': image must load');
				const withImage = await page.screenshot({ path: path.join(output, label + '.png'), animations: 'disabled' });
				const colors = await page.evaluate(() => ({ grid: getComputedStyle(document.querySelector('.monaco-grid-view')).backgroundColor, popup: getComputedStyle(document.querySelector('.quick-input-widget')).backgroundColor }));
				assert.equal(colors.grid, 'rgba(0, 0, 0, 0)', label + ': grid must expose wallpaper');
				assert.notEqual(colors.popup, 'rgba(0, 0, 0, 0)', label + ': popup must remain readable');
				// Inline !important is intentional: a weaker stylesheet selector would lose
				// to the theme rule and make this pixel comparison a false positive.
				await page.evaluate(() => document.querySelector('.monaco-workbench').style.setProperty('background-image', 'none', 'important'));
				const withoutImage = await page.screenshot({ animations: 'disabled' });
				assert.ok(!withImage.equals(withoutImage), label + ': wallpaper must contribute visible pixels');
				results.push({ theme: entry.label, floating, visible: true });
			}
		}
		await page.evaluate(() => {
			const root = document.querySelector('.monaco-workbench');
			root.className = 'monaco-workbench windows vs modern-ui floating-panels'; root.style.removeProperty('background-image');
		});
		assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('.monaco-workbench')).backgroundImage), 'none', 'Stock themes must not get a Waifu wallpaper');
		assert.notEqual(await page.evaluate(() => getComputedStyle(document.querySelector('.monaco-grid-view')).backgroundColor), 'rgba(0, 0, 0, 0)', 'Stock floating panels must keep their shell background');
		const cssSha256 = createHash('sha256').update(await fs.readFile(path.join(app, 'out/vs/workbench/workbench.desktop.main.css'))).digest('hex');
		await fs.writeFile(path.join(output, 'result.json'), JSON.stringify({ passed: true, version: manifest.version, cssSha256, cases: results, stockThemeUnaffected: true }, null, 2));
		console.log(`Wallpaper rendering passed: ${results.length} theme/layout combinations; stock themes and opaque popups preserved.`);
	} finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
