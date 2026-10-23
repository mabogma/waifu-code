/* Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root. */
'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
async function applyBackgrounds(app) {
	const relative = 'vs/workbench/workbench.desktop.main.css';
	const file = path.join(app, 'out', relative);
	const marker = '/* WAIFU WALLPAPERS */';
	const original = (await fs.readFile(file, 'utf8')).split(marker)[0].trimEnd();
	const wallpaperCss = await fs.readFile(path.join(app, 'extensions/waifu-addons/media/backgrounds.css'), 'utf8');
	const content = original + '\n' + marker + '\n' + wallpaperCss;
	await fs.writeFile(file, content);
	const jsRelative = 'vs/workbench/workbench.desktop.main.js';
	const jsFile = path.join(app, 'out', jsRelative);
	let js = await fs.readFile(jsFile, 'utf8');
	if (!js.includes('/* WAIFU WEBVIEW BACKGROUNDS */')) {
		const pattern = /this\._cachedWebViewThemeData=\{styles:([\w$]+),activeTheme:([\w$]+),themeLabel:([\w$]+)\.label,themeId:\3\.settingsId\}/g;
		if ([...js.matchAll(pattern)].length !== 1) { throw new Error('Unsupported webview theme provider'); }
		js = js.replace(pattern, (_, styles, active, theme) => `this._cachedWebViewThemeData={styles:(${theme}.settingsId.startsWith("Waifu ")?Object.assign(${styles},{"vscode-editor-background":"transparent","vscode-sideBar-background":"transparent","vscode-panel-background":"transparent"}):${styles}),activeTheme:${active},themeLabel:${theme}.label,themeId:${theme}.settingsId}`) + '\n/* WAIFU WEBVIEW BACKGROUNDS */\n';
		await fs.writeFile(jsFile, js);
	}
	if (!js.includes('/* WAIFU TERMINAL TRANSPARENCY */')) {
		const initial = /allowTransparency:[\w$]+\.enableImages/g;
		const update = /\.raw\.options\.allowTransparency=[\w$]+\.enableImages/g;
		if ([...js.matchAll(initial)].length !== 1 || [...js.matchAll(update)].length !== 1) { throw new Error('Unsupported terminal renderer base'); }
		js = js.replace(initial, 'allowTransparency:!0').replace(update, '.raw.options.allowTransparency=!0') + '\n/* WAIFU TERMINAL TRANSPARENCY */\n';
		await fs.writeFile(jsFile, js);
	}
	const productFile = path.join(app, 'product.json');
	const product = JSON.parse(await fs.readFile(productFile, 'utf8'));
	if (product.checksums && relative in product.checksums) {
		product.checksums[relative] = crypto.createHash('sha256').update(content).digest('base64').replace(/=+$/, '');
		await fs.writeFile(productFile, JSON.stringify(product, null, '\t') + '\n');
	}
	if (product.checksums && jsRelative in product.checksums) {
		product.checksums[jsRelative] = crypto.createHash('sha256').update(js).digest('base64').replace(/=+$/, '');
		await fs.writeFile(productFile, JSON.stringify(product, null, '\t') + '\n');
	}
}
module.exports = { applyBackgrounds };
if (require.main === module) {
	if (!process.argv[2]) { throw new Error('Usage: node apply-waifu-backgrounds.cjs <resources/app>'); }
	applyBackgrounds(path.resolve(process.argv[2])).catch(error => { console.error(error); process.exitCode = 1; });
}
