import {createRequire} from 'node:module';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {startServer} from '../server.mjs';
import {packDirectory} from '../cli.mjs';
import {sha256} from '../shared/package.mjs';
const require=createRequire(new URL('../../waifu-code/package.json',import.meta.url));
const {chromium}=require('playwright');
const directory=await fs.mkdtemp(path.join(os.tmpdir(),'waifu-site-test-'));
const instance=await startServer({port:0,directory:path.join(directory,'data')});
const token=(await fs.readFile(path.join(directory,'data/waifu-token.txt'),'utf8')).trim();
for(const folder of ['hello','uppercase']){
  const bundle=await packDirectory(new URL('../../waifu-code/extensions/waifu-addons/examples/'+folder,import.meta.url));
  const response=await fetch(instance.url+'/api/addons',{method:'POST',headers:{Authorization:'Bearer '+token},body:JSON.stringify(bundle)});assert.equal(response.status,201);
}
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
  const page=await browser.newPage({viewport:{width:1280,height:1000}});const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto(instance.url);await page.locator('.addon-card').last().waitFor();assert.equal(await page.locator('.addon-card').count(),2);
  await page.screenshot({path:new URL('../../waifu-marketplace-desktop.png',import.meta.url).pathname.replace(/^\/([A-Za-z]:)/,'$1'),fullPage:true});
  await page.getByRole('searchbox').fill('uppercase');assert.equal(await page.locator('.addon-card').count(),1);
  await page.getByRole('link',{name:'Подробнее ↗'}).click();await page.getByRole('heading',{name:'Waifu Uppercase',level:1}).waitFor();
  assert.equal(await page.locator('.versions tbody tr').count(),1);
  await page.setViewportSize({width:390,height:844});await page.goto(instance.url);await page.locator('.addon-card').last().waitFor();assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.screenshot({path:new URL('../../waifu-marketplace-mobile.png',import.meta.url).pathname.replace(/^\/([A-Za-z]:)/,'$1'),fullPage:true});
  await page.setViewportSize({width:1280,height:1000});
  await page.getByRole('button',{name:'＋ Опубликовать'}).click();
  const folder=path.join(directory,'browser-addon');await fs.mkdir(folder);
  const manifest={id:'browser-addon',name:'Browser Publication',version:'1.0.0',apiVersion:1,main:'main.cjs',description:'Published through the real upload form.',commands:[{id:'waifu.browser-addon.run',title:'Run'}]};
  await fs.writeFile(path.join(folder,'waifu-addon.json'),JSON.stringify(manifest));await fs.writeFile(path.join(folder,'main.cjs'),'exports.activate = api => api.commands.register("waifu.browser-addon.run", () => {});');
  await page.locator('#package-folder').setInputFiles(folder);
  await page.locator('#package-preview').filter({hasText:'Browser Publication'}).waitFor();
  await page.screenshot({path:new URL('../../waifu-marketplace-publish.png',import.meta.url).pathname.replace(/^\/([A-Za-z]:)/,'$1')});
  await page.locator('#publisher-token').fill('x'.repeat(43));await page.locator('#publish-submit').click();await page.locator('#publish-status').filter({hasText:'Ключ издателя не принят'}).waitFor();
  await page.locator('#publisher-token').fill(token);await page.locator('#publish-submit').click();await page.getByRole('heading',{name:'Browser Publication',level:1}).waitFor();
  const [download]=await Promise.all([page.waitForEvent('download'),page.getByRole('link',{name:'Скачать Browser Publication 1.0.0',exact:true}).first().click()]);
  assert.equal(download.suggestedFilename(),'browser-addon-1.0.0.waifu');const downloaded=path.join(directory,'downloaded.waifu');await download.saveAs(downloaded);
  const metadata=await(await fetch(instance.url+'/api/addons/browser-addon')).json();assert.equal(await sha256(await fs.readFile(downloaded)),metadata.sha256);
  assert.deepEqual(errors,[]);
  console.log('Website browser checks passed: desktop/mobile layout, search, details, folder upload, bad token rejection, publication, download and SHA-256.');
}finally{await browser.close();await new Promise(resolve=>instance.server.close(resolve));await fs.rm(directory,{recursive:true,force:true});}
