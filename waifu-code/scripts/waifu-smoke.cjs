/* Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root. */
'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { installAddon } = require('../extensions/waifu-addons/runtime.cjs');
async function main() {
	const root = path.resolve(__dirname, '..');
	const product = JSON.parse(await fs.readFile(path.join(root, 'product.json'), 'utf8'));
	const runtime = process.argv[2] ? path.resolve(process.argv[2]) : undefined;
	const executable = runtime ? path.join(runtime, 'Waifu Code.exe') : path.join(root, '.build/electron', product.nameShort + '.exe');
	await fs.access(executable);
	const scratch = path.resolve(root, '../../work');
	await fs.mkdir(scratch, { recursive: true });
	const profile = await fs.mkdtemp(path.join(scratch, 'waifu-smoke-'));
	const userData = path.join(profile, 'user-data');
	const harness = path.join(profile, 'test-harness');
	await fs.mkdir(harness, { recursive: true });
	await fs.writeFile(path.join(harness, 'package.json'), JSON.stringify({ name: 'waifu-test-harness', publisher: 'waifu-test', version: '0.0.0', engines: { vscode: '^1.100.0' } }));
	if (runtime) {
		await fs.mkdir(path.join(userData, 'User'), { recursive: true });
		await fs.copyFile(path.join(runtime, 'data/user-data/User/settings.json'), path.join(userData, 'User/settings.json'));
		const settingsFile = path.join(userData, 'User/settings.json');
		const settings = JSON.parse(await fs.readFile(settingsFile, 'utf8'));
		settings['waifuAddons.registryUrl'] = process.env.WAIFU_LIVE_REGISTRY_URL || '';
		await fs.writeFile(settingsFile, JSON.stringify(settings));
	}
	await installAddon(path.join(root, 'extensions/waifu-addons/examples/uppercase'), path.join(userData, 'User/globalStorage/waifu.waifu-addons/addons'));
	await installAddon(path.join(root, 'extensions/waifu-addons/test/fixtures/api-probe'), path.join(userData, 'User/globalStorage/waifu.waifu-addons/addons'));
	const result = await new Promise((resolve, reject) => {
		const environment = { ...process.env, VSCODE_CLI: '1', VSCODE_PORTABLE: profile, WAIFU_API_PROBE_FILE: path.join(profile, 'api-probe.txt') };
		if (runtime) { delete environment.VSCODE_DEV; } else { environment.VSCODE_DEV = '1'; }
		const child = spawn(executable, [...(runtime ? [] : [root]),
			`--user-data-dir=${userData}`, `--extensions-dir=${path.join(profile, 'extensions')}`,
			`--extensionDevelopmentPath=${harness}`,
			`--extensionTestsPath=${path.join(root, 'extensions/waifu-addons/test/editor-smoke.cjs')}`,
			'--skip-welcome', '--skip-release-notes'
		], { cwd: root, env: environment, stdio: 'inherit' });
		const timer = setTimeout(() => { child.kill(); reject(new Error('Editor smoke test timed out.')); }, 120000);
		child.on('error', error => { clearTimeout(timer); reject(error); });
		child.on('exit', code => { clearTimeout(timer); resolve(code ?? 1); });
	});
	console.log(`Smoke test profile: ${profile}`);
	process.exitCode = result;
}
main().catch(error => { console.error(error); process.exitCode = 1; });
