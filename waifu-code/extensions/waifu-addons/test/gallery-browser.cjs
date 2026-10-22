/* Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root. */
'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { getGalleryHtml } = require('../gallery.cjs');
async function main() {
	const root = path.resolve(__dirname, '../../..');
	const scratch = path.resolve(root, '../../work/addons-gallery-check');
	await fs.mkdir(scratch, { recursive: true });
	const theme = JSON.parse(await fs.readFile(path.join(__dirname, '../themes/midnight.json'), 'utf8'));
	const variables = Object.entries(theme.colors).map(([key, value]) => `--vscode-${key.replaceAll('.', '-')}:${value}`).join(';');
	const vscode = { Uri: { joinPath: (base, ...parts) => ({fsPath:path.join(base.fsPath,...parts)}) } };
	const webview = { cspSource:'file:', asWebviewUri: uri => pathToFileURL(uri.fsPath).href };
	for (const mode of ['sidebar','detail']) {
		let html = getGalleryHtml(webview, {fsPath:path.resolve(__dirname,'..')}, vscode, mode);
		html = html.replace('</head>', `<style>:root{${variables};--vscode-font-family:Segoe UI,sans-serif;--vscode-font-size:13px;--vscode-list-inactiveSelectionBackground:#302439;--vscode-panel-border:#342b43}</style></head>`).replace("style-src file:", "style-src file: 'unsafe-inline'");
		await fs.writeFile(path.join(scratch,mode+'.html'),html);
	}
	const state = {type:'state',trusted:true,detailId:'uppercase',addons:[
		{id:'hello-waifu',name:'Hello, Waifu!',version:'1.0.0',publisher:'Waifu Code',description:'A friendly first addon for your Waifu Code workspace.',installed:true,catalog:true,enabled:true,permissions:[],commands:[{id:'waifu.hello-waifu.greet',title:'Say Hello ♡'}]},
		{id:'uppercase',name:'Waifu Uppercase',version:'1.0.0',publisher:'Waifu Code',description:'Convert selected text to uppercase with a single command. Supports undo.',installed:true,catalog:true,enabled:true,permissions:['editor.read','editor.write'],commands:[{id:'waifu.uppercase.selection',title:'Uppercase Selected Text'}]}
	]};
	const browser = await chromium.launch({headless:true,channel:'chrome'});
	try {
		const page=await browser.newPage({viewport:{width:360,height:720}});
		await page.addInitScript(snapshot => {
			window.messages=[];
			window.acquireVsCodeApi=()=>({getState:()=>undefined,setState:()=>{},postMessage:message=>{
				window.messages.push(message);
				if(message.action==='ready'){queueMicrotask(()=>window.dispatchEvent(new MessageEvent('message',{data:snapshot})));}
			}});
		},state);
		await page.goto(pathToFileURL(path.join(scratch,'sidebar.html')).href);
		await page.locator('.card').last().waitFor();
		assert.equal(await page.locator('.card').count(),2);
		await page.getByRole('searchbox').fill('uppercase');
		assert.equal(await page.locator('.card').count(),1);
		assert.ok(await page.getByRole('searchbox').evaluate(node=>node===document.activeElement));
		await page.getByRole('searchbox').fill('');
		await page.screenshot({path:path.resolve(root,'../waifu-addons-sidebar.png')});
		await page.locator('.card').filter({hasText:'Waifu Uppercase'}).click();
		assert.equal((await page.evaluate(()=>window.messages)).at(-1).action,'details');
		await page.getByRole('button',{name:'Available',exact:false}).click();
		assert.equal(await page.locator('.card').count(),2);
		await page.evaluate(snapshot=>{snapshot.addons[1].installed=false;snapshot.addons[1].enabled=false;window.dispatchEvent(new MessageEvent('message',{data:snapshot}));},state);
		await page.getByRole('button',{name:'Install: Waifu Uppercase',exact:true}).click();
		assert.equal((await page.evaluate(()=>window.messages)).at(-1).action,'install');
		await page.setViewportSize({width:240,height:640});
		assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Sidebar must not overflow horizontally');
		await page.setViewportSize({width:960,height:720});
		await page.goto(pathToFileURL(path.join(scratch,'detail.html')).href);
		await page.getByRole('heading',{name:'Waifu Uppercase',level:1}).waitFor();
		await page.screenshot({path:path.resolve(root,'../waifu-addons-details.png')});
		await page.getByRole('button',{name:'Run: Waifu Uppercase',exact:true}).click();
		assert.equal((await page.evaluate(()=>window.messages)).at(-1).command,'waifu.uppercase.selection');
		const malicious = structuredClone(state); malicious.addons[1].name='<img src=x onerror=alert(1)>';
		await page.evaluate(snapshot=>window.dispatchEvent(new MessageEvent('message',{data:snapshot})),malicious);
		assert.equal(await page.locator('img').count(),0);
		assert.equal(await page.locator('h1').textContent(),malicious.addons[1].name);
		console.log('Gallery browser checks passed: search, focus, navigation, install, run, narrow layout, safe text rendering.');
	} finally { await browser.close(); }
}
main().catch(error=>{console.error(error);process.exitCode=1;});

