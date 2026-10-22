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
	const productFile = path.join(app, 'product.json');
	const product = JSON.parse(await fs.readFile(productFile, 'utf8'));
	if (product.checksums && relative in product.checksums) {
		product.checksums[relative] = crypto.createHash('sha256').update(content).digest('base64').replace(/=+$/, '');
		await fs.writeFile(productFile, JSON.stringify(product, null, '\t') + '\n');
	}
}
module.exports = { applyBackgrounds };
if (require.main === module) {
	if (!process.argv[2]) { throw new Error('Usage: node apply-waifu-backgrounds.cjs <resources/app>'); }
	applyBackgrounds(path.resolve(process.argv[2])).catch(error => { console.error(error); process.exitCode = 1; });
}
