import {ID_PATTERN,VERSION_PATTERN,RegistryError,validatePackage,readBoundedBody,sha256,compareVersions} from './package.mjs';
const SECURITY_HEADERS = {'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','X-Frame-Options':'SAMEORIGIN','Permissions-Policy':'camera=(), microphone=(), geolocation=()'};
function json(data,status=200,headers={}) {return new Response(JSON.stringify(data),{status,headers:{...SECURITY_HEADERS,'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',...headers}});}
function publicRelease(record,release) {
  return {...release.manifest,publisher:record.publisher,sha256:release.sha256,size:release.size,publishedAt:release.publishedAt,downloadPath:`/api/addons/${record.id}/${release.version}/package`};
}
async function authenticate(request,publishers) {
  const header=request.headers.get('authorization')||'';
  const match=/^Bearer ([A-Za-z0-9_-]{32,128})$/.exec(header);
  if(!match){throw new RegistryError(401,'Нужен ключ издателя.');}
  const publisher=publishers[await sha256(match[1])];
  if(typeof publisher!=='string'||!ID_PATTERN.test(publisher)){throw new RegistryError(401,'Ключ издателя не принят.');}
  return publisher;
}
export function createRegistry({store,publishers={},assets={}}) {
  return async function handle(request) {
    try {
      const url=new URL(request.url);
      if(request.method==='GET'&&url.pathname==='/api/health'){return json({ok:true,service:'waifu-addons',format:'waifu-addon-v1'});}
      if(request.method==='GET'&&url.pathname==='/api/addons'){
        const page=await store.list(url.searchParams.get('cursor')||undefined);
        return json({addons:page.records.map(record=>publicRelease(record,record.versions.at(-1))),nextCursor:page.nextCursor||null});
      }
      const match=/^\/api\/addons\/([a-z][a-z0-9-]{1,63})(?:\/(\d+\.\d+\.\d+)\/package)?$/.exec(url.pathname);
      if(request.method==='GET'&&match){
        const {value:record}=await store.getRecord(match[1]);
        if(!record){throw new RegistryError(404,'Аддон не найден.');}
        if(match[2]){
          const release=record.versions.find(item=>item.version===match[2]);
          if(!release){throw new RegistryError(404,'Версия не найдена.');}
          const bytes=await store.getPackage(record.id,release);
          if(!bytes){throw new RegistryError(404,'Файл пакета не найден.');}
          return new Response(bytes,{headers:{...SECURITY_HEADERS,'Content-Type':'application/vnd.waifu.addon+json','Content-Disposition':`attachment; filename="${record.id}-${release.version}.waifu"`,'Cache-Control':'public, max-age=3600, immutable','ETag':`"${release.sha256}"`,'Content-Length':String(bytes.byteLength)}});
        }
        return json({...publicRelease(record,record.versions.at(-1)),versions:record.versions.map(release=>publicRelease(record,release))});
      }
      if(request.method==='POST'&&url.pathname==='/api/addons'){
        const publisher=await authenticate(request,publishers);
        const bytes=await readBoundedBody(request);
        let input;try{input=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{throw new RegistryError(400,'Файл .waifu должен содержать корректный JSON.');}
        const {manifest,bundle}=validatePackage(input,publisher);
        const existing=await store.getRecord(manifest.id);
        if(existing.value&&existing.value.publisher!==publisher){throw new RegistryError(403,'Этот id закреплён за другим издателем.');}
        if(existing.value&&compareVersions(manifest.version,existing.value.versions.at(-1).version)<=0){throw new RegistryError(409,'Новая версия должна быть выше опубликованной. Версии нельзя перезаписывать.');}
        const payload=new TextEncoder().encode(JSON.stringify(bundle));
        const release={version:manifest.version,sha256:await sha256(payload),size:payload.length,publishedAt:new Date().toISOString(),manifest};
        const record={id:manifest.id,publisher,versions:[...(existing.value?.versions||[]),release]};
        if(record.versions.length>100){throw new RegistryError(409,'Достигнут лимит 100 версий этого аддона.');}
        await store.putPackage(record.id,release,payload);
        const saved=await store.putRecord(record.id,record,existing.etag);
        if(!saved){throw new RegistryError(409,'Аддон обновился во время публикации. Обновите страницу и повторите.');}
        return json({addon:publicRelease(record,release)},201);
      }
      if(request.method==='GET'&&(url.pathname==='/'||url.pathname.startsWith('/addons/'))){return assetResponse(assets['/index.html'],'text/html; charset=utf-8');}
      if(request.method==='GET'&&Object.hasOwn(assets,url.pathname)){return assetResponse(assets[url.pathname],url.pathname.endsWith('.css')?'text/css; charset=utf-8':url.pathname.endsWith('.svg')?'image/svg+xml':url.pathname.endsWith('.mjs')||url.pathname.endsWith('.js')?'text/javascript; charset=utf-8':'text/plain');}
      throw new RegistryError(404,'Страница не найдена.');
    }catch(error){if(!(error instanceof RegistryError)){console.error('Registry request failed:',error.message);}return json({error:error instanceof RegistryError?error.message:'Внутренняя ошибка сервера.'},error.status||500);}
  };
}
function assetResponse(body,contentType){
  if(body===undefined){return json({error:'Страница ещё не собрана.'},503);}
  return new Response(body,{headers:{...SECURITY_HEADERS,'Content-Type':contentType,'Cache-Control':'no-cache','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'self'"}});
}
