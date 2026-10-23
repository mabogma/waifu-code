/* Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root. */
'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
async function exists(file) { try { await fs.access(file); return true; } catch { return false; } }
async function main() {
	if (!process.argv[2]) { throw new Error('Usage: node scripts/package-waifu-portable.cjs <extracted VSCodium folder> [release metadata JSON]'); }
	const root = path.resolve(__dirname, '..');
	const target = path.resolve(process.argv[2]);
	const app = path.join(target, 'resources/app');
	const productFile = path.join(app, 'product.json');
	const product = JSON.parse(await fs.readFile(productFile, 'utf8'));
	const baseName = product.nameShort;
	const baseVersion = JSON.parse(await fs.readFile(path.join(app, 'package.json'), 'utf8')).version;
	const brand = JSON.parse(await fs.readFile(path.join(root, 'product.json'), 'utf8'));
	for (const key of [
		'nameShort', 'nameLong', 'applicationName', 'dataFolderName', 'sharedDataFolderName',
		'win32MutexName', 'win32DirName', 'win32NameVersion', 'win32RegValueName', 'win32AppUserModelId',
		'win32ShellNameShort', 'win32x64AppId', 'win32arm64AppId', 'win32x64UserAppId', 'win32arm64UserAppId', 'urlProtocol'
	]) { product[key] = brand[key]; }
	// A custom distribution must not be overwritten by the upstream automatic updater.
	for (const key of ['updateUrl', 'downloadUrl', 'releaseNotesUrl', 'reportIssueUrl']) { delete product[key]; }
	await fs.writeFile(productFile, JSON.stringify(product, null, '\t') + '\n');
	const executable = path.join(target, 'Waifu Code.exe');
	const original = path.join(target, `${baseName}.exe`);
	if (original !== executable && await exists(original)) { await fs.rename(original, executable); }
	if (!await exists(executable)) { throw new Error('Editor executable is missing.'); }
	const extensionTarget = path.join(app, 'extensions/waifu-addons');
	await fs.cp(path.join(root, 'extensions/waifu-addons'), extensionTarget, { recursive: true, filter: file => path.basename(file) !== 'test' });
	await require('./apply-waifu-backgrounds.cjs').applyBackgrounds(app);
	await require('./apply-waifu-branding.cjs').applyBranding(target);
	await fs.mkdir(path.join(app, 'resources/win32'), { recursive: true });
	await fs.copyFile(path.join(root, 'resources/win32/code.ico'), path.join(app, 'resources/win32/code.ico'));
	await fs.copyFile(path.join(root, 'extensions/waifu-addons/media/waifu-code.png'), path.join(target, 'waifu-code.png'));
	const settingsFile = path.join(target, 'data/user-data/User/settings.json');
	await fs.mkdir(path.dirname(settingsFile), { recursive: true });
	if (!await exists(settingsFile)) {
		await fs.writeFile(settingsFile, JSON.stringify({
			'workbench.colorTheme': 'Waifu Midnight', 'workbench.preferredDarkColorTheme': 'Waifu Midnight',
			'workbench.startupEditor': 'none', 'update.mode': 'none', 'telemetry.telemetryLevel': 'off'
		}, null, '\t') + '\n');
	}
	const addonStorage = path.join(path.dirname(settingsFile), 'globalStorage/waifu.waifu-addons/addons');
	await fs.mkdir(addonStorage, { recursive: true });
	for (const [folder, id] of [['hello', 'hello-waifu'], ['uppercase', 'uppercase']]) {
		const addonTarget = path.join(addonStorage, id);
		if (!await exists(addonTarget)) { await fs.cp(path.join(extensionTarget, 'examples', folder), addonTarget, { recursive: true }); }
	}
	const bin = path.join(target, 'bin');
	await fs.mkdir(bin, { recursive: true });
	await fs.writeFile(path.join(bin, 'waifu-code.cmd'), '@echo off\r\nsetlocal\r\nset ELECTRON_RUN_AS_NODE=1\r\n"%~dp0..\\Waifu Code.exe" "%~dp0..\\resources\\app\\out\\cli.js" %*\r\n');
	await fs.writeFile(path.join(target, 'Start-Waifu.cmd'), '@echo off\r\nstart "" "%~dp0Waifu Code.exe" %*\r\n');
	const metadata = process.argv[3] ? JSON.parse(await fs.readFile(process.argv[3], 'utf8')) : {};
	await fs.writeFile(path.join(target, 'WAIFU-BUILD.json'), JSON.stringify({
		product: 'Waifu Code', addonSystem: 'Waifu Addons', addonApiVersion: 1,
		baseDistribution: baseName, baseVersion, baseAsset: metadata.name, baseDigest: metadata.digest,
		baseDownloadUrl: metadata.browser_download_url,
		note: 'Portable distribution assembled from the official VSCodium Code OSS binary with Waifu branding and bundled Waifu Addons. The separate source fork tracks a newer Code OSS development snapshot.'
	}, null, '\t') + '\n');
	await fs.writeFile(path.join(target, 'README-WAIFU.txt'), [
		'WAIFU CODE', '',
		'Запуск: Waifu Code.exe или Start-Waifu.cmd. Установка и Node.js не нужны.',
		'Все настройки и аддоны хранятся в папке data рядом с приложением.', '',
		'Waifu Midnight — тёмная тема с розово-лиловыми акцентами.',
		'Стартовая страница: Ctrl+Shift+P → Waifu Code: Welcome.',
		'Waifu Addons: нажмите сердце в левой панели.',
		'В комплекте: Hello, Waifu! и Uppercase Selected Text.',
		'Для проверки Uppercase выделите текст в редакторе и нажмите команду в панели аддонов. Ctrl+Z отменяет изменение.',
		'Добавление: кнопка + в панели Waifu Addons → папка с waifu-addon.json.',
		'Управление: Ctrl+Shift+P → Waifu Addons: Manage Installed Addons.', '',
		'Аддоны выполняют Node.js-код с правами пользователя. Устанавливайте доверенные аддоны.',
		'Сетевой каталог Waifu Addons настроен. Автообновления доступны в Windows User Setup с версии 0.4.2; portable обновляется вручную через страницу Releases.', '',
		'Основа portable-версии: официальная открытая сборка Code OSS от VSCodium.',
		'Это сборка с изменёнными настройками продукта и встроенными расширениями, не результат локальной компиляции отдельного форка.',
		'Сведения о версии и происхождении: WAIFU-BUILD.json. Исходные лицензии сохранены.',
		'Отдельные изменённые исходники Code OSS и сценарии сборки находятся в соседней папке waifu-code.'
	].join('\r\n'));
	console.log(`Waifu Code portable prepared: ${executable}`);
}
main().catch(error => { console.error(error); process.exitCode = 1; });
