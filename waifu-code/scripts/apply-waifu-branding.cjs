/* Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root. */
'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
async function applyBranding(target, resourceEditor) {
	const root = path.resolve(__dirname, '..');
	const app = path.join(target, 'resources/app');
	const logo = await fs.readFile(path.join(root, 'extensions/waifu-addons/media/waifu-logo.svg'));
	const changed = [];
	async function walk(folder) {
		for (const entry of await fs.readdir(folder, { withFileTypes: true })) {
			const file = path.join(folder, entry.name);
			if (entry.isDirectory()) { await walk(file); }
			else if (/^(?:code-icon|vscode-icon|letterpress(?:-sessions)?-(?:dark|light|hcDark|hcLight)|sessions-logo-(?:dark|light))\.svg$/.test(entry.name)) {
				await fs.writeFile(file, logo); changed.push(path.relative(path.join(app, 'out'), file).replaceAll('\\', '/'));
			}
		}
	}
	await walk(path.join(app, 'out'));
	for (const name of ['code.ico', 'code_70x70.png', 'code_150x150.png']) {
		await fs.copyFile(path.join(root, 'resources/win32', name), path.join(app, 'resources/win32', name));
	}
	for (const name of ['default.ico', 'sessions.ico']) { await fs.copyFile(path.join(root, 'resources/win32/code.ico'), path.join(app, 'resources/win32', name)); }
	const manifest = '<Application xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><VisualElements BackgroundColor="#191522" ShowNameOnSquare150x150Logo="on" Square150x150Logo="resources\\app\\resources\\win32\\code_150x150.png" Square70x70Logo="resources\\app\\resources\\win32\\code_70x70.png" ForegroundText="light" ShortDisplayName="Waifu Code" /></Application>\n';
	await fs.writeFile(path.join(target, 'Waifu Code.VisualElementsManifest.xml'), manifest);
	await fs.rm(path.join(target, 'VSCodium.VisualElementsManifest.xml'), { force: true });
	const jsRelative = 'vs/workbench/workbench.desktop.main.js';
	const jsFile = path.join(app, 'out', jsRelative);
	let js = await fs.readFile(jsFile, 'utf8');
	if (!js.includes('/* WAIFU THEMES FIRST */')) {
		const start = js.lastIndexOf('="workbench.action.selectTheme"');
		const end = js.indexOf('="workbench.action.selectIconTheme"', start);
		const section = js.slice(start, end);
		const matches = [...section.matchAll(/await (\w+)\.openQuickPick\((\w+),(\w+)\)/g)];
		if (start < 0 || end < start || matches.length !== 1) { throw new Error('Unsupported editor base: Color Theme picker could not be identified safely.'); }
		const [match, picker, picks, theme] = matches[0];
		const first = `${picks}=[{type:"separator",label:"Waifu Code"},...${picks}.filter(x=>x.theme?.extensionData?.extensionId==="waifu.waifu-addons").sort((a,b)=>a.label.localeCompare(b.label)),...${picks}.filter(x=>x.theme?.extensionData?.extensionId!=="waifu.waifu-addons")];/* WAIFU THEMES FIRST */await ${picker}.openQuickPick(${picks},${theme})`;
		js = js.slice(0,start) + section.replace(match,first) + js.slice(end);
		await fs.writeFile(jsFile, js);
	}
	changed.push(jsRelative);
	const productFile = path.join(app, 'product.json');
	const product = JSON.parse(await fs.readFile(productFile, 'utf8'));
	for (const relative of changed) {
		if (product.checksums && relative in product.checksums) {
			product.checksums[relative] = crypto.createHash('sha256').update(await fs.readFile(path.join(app, 'out', relative))).digest('base64').replace(/=+$/, '');
		}
	}
	await fs.writeFile(productFile, JSON.stringify(product, null, '\t') + '\n');
	const editor = resourceEditor || path.join(root, 'node_modules/rcedit/bin/rcedit.exe');
	execFileSync(editor, [path.join(target, 'Waifu Code.exe'), '--set-icon', path.join(root, 'resources/win32/code.ico'), '--set-version-string', 'ProductName', 'Waifu Code', '--set-version-string', 'FileDescription', 'Waifu Code', '--set-version-string', 'CompanyName', 'Waifu Code', '--set-version-string', 'OriginalFilename', 'Waifu Code.exe', '--set-version-string', 'InternalName', 'Waifu Code'], { windowsHide: true });
}
module.exports = { applyBranding };
if (require.main === module) { applyBranding(path.resolve(process.argv[2]), process.argv[3]).catch(error => { console.error(error); process.exitCode = 1; }); }
