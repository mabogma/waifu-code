/* Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root. */
'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const {pathToFileURL}=require('node:url');
const {fetchCatalog,installRegistryAddon,installPackage,registryUrl}=require('../registry.cjs');
const {AddonHost}=require('../runtime.cjs');

test('publish to a real HTTP registry, browse it, download, verify and run the installed addon',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'waifu-client-'));
  const serverModule=await import(pathToFileURL(path.resolve(__dirname,'../../../../waifu-addons-server/server.mjs')).href);
  const cli=await import(pathToFileURL(path.resolve(__dirname,'../../../../waifu-addons-server/cli.mjs')).href);
  const instance=await serverModule.startServer({port:0,directory:path.join(root,'server')});
  t.after(async()=>{await new Promise(resolve=>instance.server.close(resolve));await fs.rm(root,{recursive:true,force:true});});
  const token=(await fs.readFile(path.join(root,'server/waifu-token.txt'),'utf8')).trim();
  const bundle=await cli.packDirectory(path.resolve(__dirname,'../examples/hello'));
  const publication=await fetch(instance.url+'/api/addons',{method:'POST',headers:{Authorization:'Bearer '+token},body:JSON.stringify(bundle)});
  assert.equal(publication.status,201);
  const catalog=await fetchCatalog(instance.url);
  const entry=catalog.get('hello-waifu');
  assert.equal(entry.manifest.publisher,'waifu');
  const storage=path.join(root,'installed');
  await installRegistryAddon(entry,storage);
  const messages=[];
  const host=new AddonHost(path.join(storage,'hello-waifu/main.cjs'),message=>messages.push(message),error=>assert.fail(error));
  try{await host.execute('waifu.hello-waifu.greet');assert.match(messages[0].text,/Waifu Code/);}finally{host.dispose();}
  await assert.rejects(installRegistryAddon({...entry,sha256:'0'.repeat(64)},path.join(root,'tampered')),/SHA-256/);
  const malicious=JSON.stringify({format:'waifu-addon-v1',files:[{path:'../escape.cjs',data:''}]});
  await assert.rejects(installPackage(Buffer.from(malicious),storage),/путь/);
});
test('registry URLs reject credentials, non-HTTPS remote servers and unsafe schemes',()=>{
  assert.equal(registryUrl('http://localhost:4317/'),'http://localhost:4317');
  assert.equal(registryUrl('http://132.243.115.51:4853/'),'http://132.243.115.51:4853');
  for(const url of ['http://example.com','http://132.243.115.51:4854','http://132.243.115.51.evil.example:4853','http://user:secret@132.243.115.51:4853','https://secret:password@example.com','file:///etc/passwd','https://example.com/?token=secret']){assert.throws(()=>registryUrl(url));}
});
