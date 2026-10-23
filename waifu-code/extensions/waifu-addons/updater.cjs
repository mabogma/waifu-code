/* Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root. */
'use strict';
const fs = require('node:fs/promises');
const { createReadStream } = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { spawn } = require('node:child_process');
const RELEASES = 'https://github.com/mabogma/waifu-code/releases';
const API = 'https://api.github.com/repos/mabogma/waifu-code/releases/latest';
function version(value) {
	const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(value);
	if (!match) { throw new Error('Invalid stable update version'); }
	return match.slice(1).map(Number);
}
function isNewer(candidate, current) {
	const a = version(candidate), b = version(current);
	for (let i = 0; i < 3; i++) { if (a[i] !== b[i]) { return a[i] > b[i]; } }
	return false;
}
function releaseAsset(release, current) {
	if (release.draft || release.prerelease || !isNewer(release.tag_name, current)) { return undefined; }
	const next = release.tag_name.replace(/^v/, '');
	const name = `WaifuCodeUserSetup-x64-${next}.exe`;
	const asset = release.assets?.find(item => item.name === name);
	if (!asset || asset.state !== 'uploaded' || !Number.isSafeInteger(asset.size) || asset.size < 1 || asset.size > 1024 * 1024 * 1024 || !/^sha256:[a-f0-9]{64}$/.test(asset.digest || '')) { throw new Error('Release is missing a verified Windows installer'); }
	const expected = `${RELEASES}/download/${release.tag_name}/${name}`;
	if (asset.browser_download_url !== expected) { throw new Error('Unexpected update download URL'); }
	return { name, version: next, size: asset.size, sha256: asset.digest.slice(7), url: expected };
}
async function sha256(file) {
	const hash = createHash('sha256');
	for await (const data of createReadStream(file)) { hash.update(data); }
	return hash.digest('hex');
}
async function downloadAsset(asset, directory, signal, report, fetcher = fetch) {
	await fs.mkdir(directory, { recursive: true });
	const destination = path.join(directory, asset.name);
	try { if ((await fs.stat(destination)).size === asset.size && await sha256(destination) === asset.sha256) { return destination; } } catch (error) { if (error.code !== 'ENOENT') { throw error; } }
	const temporary = destination + '.' + require('node:crypto').randomUUID() + '.partial';
	let handle;
	try {
		let url = asset.url, response;
		for (let redirects = 0; redirects < 6; redirects++) {
			const parsed = new URL(url);
			if (parsed.protocol !== 'https:' || parsed.username || parsed.password || !['github.com', 'release-assets.githubusercontent.com', 'objects.githubusercontent.com'].includes(parsed.hostname)) { throw new Error('Untrusted update redirect'); }
			response = await fetcher(url, { signal, redirect: 'manual', headers: { 'User-Agent': 'WaifuCode-Updater' } });
			if ([301,302,303,307,308].includes(response.status)) { const location = response.headers.get('location'); await response.body?.cancel(); if (!location) { throw new Error('Invalid redirect'); } url = new URL(location,url).href; continue; }
			break;
		}
		if (!response?.ok || !response.body) { throw new Error('Update download failed'); }
		handle = await fs.open(temporary, 'wx');
		let received = 0, percent = 0;
		const hash = createHash('sha256');
		for await (const chunk of response.body) {
			signal?.throwIfAborted(); received += chunk.length;
			if (received > asset.size) { throw new Error('Update exceeds declared size'); }
			hash.update(chunk); await handle.writeFile(chunk);
			const next = Math.floor(received / asset.size * 100); report?.(next - percent); percent = next;
		}
		if (received !== asset.size || hash.digest('hex') !== asset.sha256) { throw new Error('Update SHA-256 or size mismatch'); }
		await handle.close(); handle = undefined;
		await fs.rename(temporary, destination);
		return destination;
	} finally { await handle?.close(); await fs.rm(temporary, { force: true }); }
}
function installerScript(installer, executable) {
	const quote = value => "'" + value.replaceAll("'", "''") + "'";
	return `$ErrorActionPreference='Stop'; Start-Sleep -Seconds 2; $deadline=[DateTime]::UtcNow.AddMinutes(2); while(Get-Process -Name 'Waifu Code' -ErrorAction SilentlyContinue){if([DateTime]::UtcNow -gt $deadline){exit}; Start-Sleep -Milliseconds 500}; $update=Start-Process -FilePath ${quote(installer)} -ArgumentList @('/SILENT','/NORESTART') -PassThru -Wait; if($update.ExitCode -eq 0){Start-Process -FilePath ${quote(executable)}}`;
}
function registerUpdater(vscode, context) {
	if (!vscode.env?.appRoot || process.platform !== 'win32') { return; }
	let active, disposed = false;
	const output = vscode.window.createOutputChannel('Waifu Updates');
	context.subscriptions.push(output);
	async function check(manual) {
		if (active || disposed) { return; }
		active = new AbortController();
		try {
			const product = JSON.parse(await fs.readFile(path.join(vscode.env.appRoot, 'product.json'), 'utf8'));
			if (product.target !== 'user') {
				if (manual) { await vscode.env.openExternal(vscode.Uri.parse(RELEASES)); }
				return;
			}
			const response = await fetch(API, { headers: { 'User-Agent': 'WaifuCode-Updater', Accept: 'application/vnd.github+json' }, signal: AbortSignal.any([active.signal, AbortSignal.timeout(30000)]) });
			if (!response.ok) { throw new Error(`GitHub HTTP ${response.status}`); }
			const asset = releaseAsset(await response.json(), context.extension.packageJSON.version);
			if (!asset) { if (manual) { await vscode.window.showInformationMessage(vscode.l10n.t('Waifu Code is up to date.')); } return; }
			const installer = await vscode.window.withProgress({ location: vscode.ProgressLocation.Window, title: vscode.l10n.t('Downloading Waifu Code {0}', asset.version), cancellable: true }, async (progress, token) => {
				const cancel = token.onCancellationRequested(() => active?.abort());
				try { return await downloadAsset(asset, path.join(context.globalStorageUri.fsPath, 'updates'), AbortSignal.any([active.signal, AbortSignal.timeout(900000)]), increment => progress.report({ increment })); }
				finally { cancel.dispose(); }
			});
			if (disposed || active.signal.aborted) { return; }
			const button = vscode.l10n.t('Restart and Update');
			if (await vscode.window.showInformationMessage(vscode.l10n.t('Waifu Code {0} is ready. Save your work before updating.', asset.version), button) !== button || disposed) { return; }
			await vscode.commands.executeCommand('workbench.action.files.saveAll');
			if (vscode.workspace.textDocuments.some(document => document.isDirty) || vscode.workspace.notebookDocuments.some(document => document.isDirty)) { return; }
			// The downloaded file is checked again immediately before scheduling installation.
			if (await sha256(installer) !== asset.sha256) { throw new Error('Update file changed after verification'); }
			const executable = path.resolve(vscode.env.appRoot, '../../Waifu Code.exe');
			const script = Buffer.from(installerScript(installer, executable), 'utf16le').toString('base64');
			const powershell = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe');
			const helper = spawn(powershell, ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-EncodedCommand', script], { detached: true, windowsHide: true, stdio: 'ignore' });
			await new Promise((resolve,reject) => { helper.once('spawn',resolve); helper.once('error',reject); });
			helper.unref();
			await vscode.commands.executeCommand('workbench.action.quit');
		} catch (error) {
			if (!disposed && !active.signal.aborted) { output.appendLine(String(error.message)); if (manual) { await vscode.window.showWarningMessage(vscode.l10n.t('Waifu Code update failed: {0}', error.message)); } }
		} finally { active = undefined; }
	}
	context.subscriptions.push(vscode.commands.registerCommand('waifu.updates.check', () => check(true)));
	const enabled = () => vscode.workspace.getConfiguration('waifuUpdates').get('enabled', true);
	const start = setTimeout(() => { if (enabled()) { void check(false); } }, 30000);
	const periodic = setInterval(() => { if (enabled()) { void check(false); } }, 6 * 60 * 60 * 1000);
	start.unref(); periodic.unref();
	context.subscriptions.push({ dispose() { disposed = true; active?.abort(); clearTimeout(start); clearInterval(periodic); } });
}
module.exports = { isNewer, releaseAsset, downloadAsset, installerScript, registerUpdater };
