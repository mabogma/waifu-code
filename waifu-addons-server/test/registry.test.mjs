import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {FileStore} from '../shared/file-store.mjs';
import {createRegistry} from '../shared/registry.mjs';
import {validatePackage,bytesToBase64,sha256,MAX_PACKAGE_BYTES} from '../shared/package.mjs';
const tokenA='a'.repeat(43),tokenB='b'.repeat(43);
function bundle(id='test-addon',version='1.0.0'){
  const manifest={id,name:'Test Addon',version,apiVersion:1,main:'main.cjs',description:'Real test addon',commands:[{id:`waifu.${id}.run`,title:'Run'}]};
  return {format:'waifu-addon-v1',files:[{path:'waifu-addon.json',data:bytesToBase64(new TextEncoder().encode(JSON.stringify(manifest)))},{path:'main.cjs',data:bytesToBase64(new TextEncoder().encode('exports.activate = () => {};'))}]};
}
async function setup(t){const directory=await fs.mkdtemp(path.join(os.tmpdir(),'waifu-registry-'));const store=new FileStore(directory);await store.init();t.after(()=>fs.rm(directory,{recursive:true,force:true}));const handle=createRegistry({store,publishers:{[await sha256(tokenA)]:'alice',[await sha256(tokenB)]:'bob'}});const request=(url,options)=>handle(new Request('https://catalog.example'+url,options));const publish=(data,token=tokenA)=>request('/api/addons',{method:'POST',headers:{Authorization:'Bearer '+token},body:JSON.stringify(data)});return {request,publish,store};}
test('publish, list, download, verify digest, release a new version, preserve old packages',async t=>{
  const {request,publish}=await setup(t);
  const first=await publish(bundle());assert.equal(first.status,201);const metadata=(await first.json()).addon;
  assert.equal(metadata.publisher,'alice');
  const listed=await(await request('/api/addons')).json();assert.equal(listed.addons.length,1);
  const download=await request(metadata.downloadPath);assert.equal(download.status,200);const bytes=new Uint8Array(await download.arrayBuffer());assert.equal(await sha256(bytes),metadata.sha256);assert.equal(validatePackage(JSON.parse(new TextDecoder().decode(bytes))).manifest.publisher,'alice');
  assert.equal((await publish(bundle('test-addon','1.1.0'))).status,201);
  const details=await(await request('/api/addons/test-addon')).json();assert.deepEqual(details.versions.map(item=>item.version),['1.0.0','1.1.0']);
  assert.equal((await request(metadata.downloadPath)).status,200);
});
test('authentication, ownership, immutable versions and downgrade protection',async t=>{
  const {request,publish}=await setup(t);
  assert.equal((await request('/api/addons',{method:'POST',body:'{}'})).status,401);
  assert.equal((await publish(bundle(),'invalid')).status,401);
  assert.equal((await publish(bundle())).status,201);
  assert.equal((await publish(bundle())).status,409);
  assert.equal((await publish(bundle('test-addon','0.9.0'))).status,409);
  assert.equal((await publish(bundle('test-addon','1.1.0'),tokenB)).status,403);
});
test('concurrent first publications cannot steal an addon id',async t=>{
  const {publish,request}=await setup(t);
  const results=await Promise.all([publish(bundle(),tokenA),publish(bundle(),tokenB)]);
  assert.equal(results.filter(result=>result.status===201).length,1);
  const winner=(await(await request('/api/addons/test-addon')).json()).publisher;
  assert.equal((await publish(bundle('test-addon','2.0.0'),winner==='alice'?tokenB:tokenA)).status,403);
});
test('path traversal, Windows aliases, case collisions, file-directory conflicts and absent main are rejected',()=>{
  for(const name of ['../escape.cjs','/absolute.cjs','C:/escape.cjs','folder\\escape.cjs','CON.txt','folder/aux.cjs','file.']){
    const data=bundle();data.files.push({path:name,data:''});assert.throws(()=>validatePackage(data));
  }
  const collision=bundle();collision.files.push({path:'MAIN.CJS',data:''});assert.throws(()=>validatePackage(collision),/дублирующиеся/);
  const conflict=bundle();conflict.files.push({path:'folder',data:''},{path:'folder/file',data:''});assert.throws(()=>validatePackage(conflict),/конфликтует/);
  const absent=bundle();absent.files.pop();assert.throws(()=>validatePackage(absent),/main отсутствует/);
});
test('oversized requests are rejected before parsing and HTML metadata remains plain JSON',async t=>{
  const {request,publish}=await setup(t);
  const response=await request('/api/addons',{method:'POST',headers:{Authorization:'Bearer '+tokenA,'Content-Length':String(MAX_PACKAGE_BYTES+1)},body:'{}'});assert.equal(response.status,413);
  const data=bundle();const manifest=JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(data.files[0].data),character=>character.charCodeAt(0))));manifest.name='<img src=x onerror=alert(1)>';data.files[0].data=bytesToBase64(new TextEncoder().encode(JSON.stringify(manifest)));
  assert.equal((await publish(data)).status,201);const listing=await request('/api/addons');assert.match(listing.headers.get('Content-Type'),/application\/json/);assert.equal((await listing.json()).addons[0].name,manifest.name);
});
