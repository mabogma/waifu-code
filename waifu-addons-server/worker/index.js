import {createRegistry} from '../shared/registry.mjs';
export class R2Store {
  constructor(bucket){if(!bucket){throw new Error('R2 storage is not configured.');}this.bucket=bucket;}
  async getRecord(id){const object=await this.bucket.get('addons/'+id+'.json');return object?{value:await object.json(),etag:object.etag}:{value:null,etag:null};}
  async list(cursor){const page=await this.bucket.list({prefix:'addons/',limit:20,...(cursor?{cursor}:{})});const records=[];for(let index=0;index<page.objects.length;index+=10){records.push(...await Promise.all(page.objects.slice(index,index+10).map(async object=>{const value=(await this.getRecord(object.key.slice(7,-5))).value;return value?{...value,versions:[value.versions.at(-1)]}:null;})));}return {records:records.filter(Boolean),nextCursor:page.truncated?page.cursor:null};}
  async putRecord(id,value,etag){const result=await this.bucket.put('addons/'+id+'.json',JSON.stringify(value),{onlyIf:etag?{etagMatches:etag}:{etagDoesNotMatch:'*'},httpMetadata:{contentType:'application/json'}});return result!==null;}
  key(id,release){return 'packages/'+id+'/'+release.version+'-'+release.sha256+'.waifu';}
  async putPackage(id,release,bytes){await this.bucket.put(this.key(id,release),bytes,{httpMetadata:{contentType:'application/vnd.waifu.addon+json'}});}
  async getPackage(id,release){const object=await this.bucket.get(this.key(id,release));return object?new Uint8Array(await object.arrayBuffer()):null;}
}
export default {
  async fetch(request,env){
    let publishers={};
    try{publishers=JSON.parse(env.WAIFU_PUBLISHERS_JSON||'{}');}catch{return new Response('Registry authentication is not configured.',{status:503});}
    if(!env.BUCKET&&new URL(request.url).pathname.startsWith('/api/')){return new Response(JSON.stringify({error:'Хранилище каталога ещё не подключено.'}),{status:503,headers:{'Content-Type':'application/json'}});}
    const store=env.BUCKET?new R2Store(env.BUCKET):null;
    return createRegistry({store,publishers,assets:ASSETS})(request);
  }
};
