/* Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root. */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { isNewer, releaseAsset, downloadAsset, installerScript } = require('../updater.cjs');
const bytes = Buffer.from('verified installer fixture');
const digest = createHash('sha256').update(bytes).digest('hex');
const asset = { name: 'WaifuCodeUserSetup-x64-0.4.3.exe', state: 'uploaded', size: bytes.length, digest: 'sha256:' + digest, browser_download_url: 'https://github.com/mabogma/waifu-code/releases/download/v0.4.3/WaifuCodeUserSetup-x64-0.4.3.exe' };
const release = { tag_name: 'v0.4.3', assets: [asset] };
test('updates compare stable versions numerically and never downgrade', () => {
	assert.ok(isNewer('v0.4.10','0.4.2')); assert.equal(isNewer('0.4.2','0.4.2'),false);
	assert.equal(releaseAsset(release,'0.5.0'),undefined);
	assert.equal(releaseAsset({...release,prerelease:true},'0.4.2'),undefined);
	assert.throws(() => isNewer('0.4.3-beta','0.4.2'));
});
test('updates require a pinned repository asset with SHA-256', () => {
	assert.equal(releaseAsset(release,'0.4.2').sha256,digest);
	assert.throws(() => releaseAsset({...release,assets:[{...asset,digest:undefined}]},'0.4.2'));
	assert.throws(() => releaseAsset({...release,assets:[{...asset,browser_download_url:'https://example.com/file.exe'}]},'0.4.2'));
});
test('verified downloads are atomic, cached and reject corrupt data and redirects', async t => {
	const directory = await fs.mkdtemp(path.join(os.tmpdir(),'waifu-update-'));
	t.after(() => fs.rm(directory,{recursive:true,force:true}));
	const update=releaseAsset(release,'0.4.2'); let requests=0;
	const fetcher=async()=>{requests++;return new Response(bytes);};
	const file=await downloadAsset(update,directory,undefined,undefined,fetcher);
	assert.deepEqual(await fs.readFile(file),bytes);
	await downloadAsset(update,directory,undefined,undefined,fetcher);assert.equal(requests,1);
	await fs.unlink(file);
	await assert.rejects(downloadAsset(update,directory,undefined,undefined,async()=>new Response(Buffer.alloc(bytes.length))),/SHA-256/);
	await assert.rejects(downloadAsset(update,directory,undefined,undefined,async()=>new Response(null,{status:302,headers:{location:'http://127.0.0.1/installer'}})),/Untrusted/);
	assert.deepEqual(await fs.readdir(directory),[]);
});
test('cancelled updates leave no installer or partial file',async t=>{
	const directory=await fs.mkdtemp(path.join(os.tmpdir(),'waifu-update-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));
	const controller=new AbortController();controller.abort();
	await assert.rejects(downloadAsset(releaseAsset(release,'0.4.2'),directory,controller.signal,undefined,async()=>new Response(bytes)));
	assert.deepEqual(await fs.readdir(directory),[]);
});
test('installer restart script quotes paths and waits for the editor to close',()=>{
	const script=installerScript("C:\\test's folder\\setup.exe",'C:\\Waifu Code\\Waifu Code.exe');
	assert.ok(script.includes("'C:\\test''s folder\\setup.exe'"));assert.match(script,/while\(Get-Process/);assert.match(script,/ExitCode -eq 0/);
});
