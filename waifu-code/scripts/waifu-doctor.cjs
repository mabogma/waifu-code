/* Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root. */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const required = fs.readFileSync('.nvmrc', 'utf8').trim();
let failed = false;
function check(label, okay, detail) { console.log(`${okay ? 'OK' : 'MISSING'} ${label}: ${detail}`); if (!okay) { failed = true; } }
const actual = process.versions.node.split('.').map(Number);
const wanted = required.split('.').map(Number);
check('Node.js', actual[0] === wanted[0] && (actual[1] > wanted[1] || actual[1] === wanted[1] && actual[2] >= wanted[2]), `${process.versions.node}; required ${required}`);
if (!process.argv.includes('--prerequisites')) {
	check('Dependencies', fs.existsSync('node_modules/gulp'), 'npm run install-fast');
	check('Compiled editor', fs.existsSync('out/main.js'), 'npm run build-fast');
	check('Electron', fs.existsSync('.build/electron'), 'npm run electron');
}
const product = JSON.parse(fs.readFileSync('product.json', 'utf8'));
check('Brand', product.nameShort === 'Waifu Code', product.nameShort);
check('Waifu Addons', fs.existsSync('extensions/waifu-addons/extension.cjs'), 'built-in addon manager');
if (process.platform === 'win32') {
	const vswhere = `${process.env['ProgramFiles(x86)']}/Microsoft Visual Studio/Installer/vswhere.exe`;
	const visualStudio = fs.existsSync(vswhere) ? cp.spawnSync(vswhere, ['-latest', '-products', '*', '-requires', 'Microsoft.VisualStudio.Component.VC.Tools.x86.x64', '-property', 'installationPath'], { encoding: 'utf8' }).stdout.trim() : '';
	check('Visual C++ Build Tools', !!visualStudio, visualStudio || 'Install C++ Build Tools and Windows SDK');
	if (visualStudio) {
		const version = fs.readFileSync(path.join(visualStudio, 'VC/Auxiliary/Build/Microsoft.VCToolsVersion.default.txt'), 'utf8').trim();
		check('MSVC Spectre libraries', fs.existsSync(path.join(visualStudio, 'VC/Tools/MSVC', version, 'lib/spectre/x64/libcmt.lib')), `MSVC ${version}; add Spectre libraries through Visual Studio Installer`);
	}
}
process.exitCode = failed ? 1 : 0;
