import {test} from 'node:test';
import assert from 'node:assert/strict';
import {R2Store} from '../worker/index.js';
import {sha256} from '../shared/package.mjs';
class Bucket {
  objects=new Map();
  async get(key){const item=this.objects.get(key);return item?{etag:item.etag,json:async()=>JSON.parse(new TextDecoder().decode(item.bytes)),arrayBuffer:async()=>item.bytes.buffer.slice(item.bytes.byteOffset,item.bytes.byteOffset+item.bytes.byteLength)}:null;}
  async put(key,value,options={}){
    const current=this.objects.get(key);
    const condition=options.onlyIf;
    if(condition?.etagMatches&&condition.etagMatches!==current?.etag){return null;}
    if(condition?.etagDoesNotMatch==='*'&&current){return null;}
    const bytes=typeof value==='string'?new TextEncoder().encode(value):new Uint8Array(value);
    const etag=await sha256(bytes);this.objects.set(key,{etag,bytes});return {etag};
  }
  async list({prefix,limit,cursor}){const keys=[...this.objects.keys()].filter(key=>key.startsWith(prefix)).sort();const offset=Number(cursor||0);return {objects:keys.slice(offset,offset+limit).map(key=>({key})),truncated:offset+limit<keys.length,cursor:String(offset+limit)};}
}
test('R2 compare-and-set rejects stale metadata and duplicate initial claims',async()=>{
  const store=new R2Store(new Bucket());const first={id:'test-addon',publisher:'waifu',versions:[{version:'1.0.0'}]};
  assert.equal(await store.putRecord('test-addon',first,null),true);
  assert.equal(await store.putRecord('test-addon',{...first,publisher:'other'},null),false);
  const current=await store.getRecord('test-addon');
  assert.equal(await store.putRecord('test-addon',{...first,versions:[...first.versions,{version:'1.1.0'}]},current.etag),true);
  assert.equal(await store.putRecord('test-addon',first,current.etag),false);
  const list=await store.list();assert.equal(list.records[0].versions[0].version,'1.1.0');
});
