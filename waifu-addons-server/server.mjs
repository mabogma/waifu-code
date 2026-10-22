import http from 'node:http';
import fs from 'node:fs/promises';
import {fileURLToPath,pathToFileURL} from 'node:url';
import path from 'node:path';
import {FileStore} from './shared/file-store.mjs';
import {createRegistry} from './shared/registry.mjs';
import {MAX_PACKAGE_BYTES} from './shared/package.mjs';
import {defaultDataDirectory,loadPublishers} from './auth.mjs';
export async function startServer({port=Number(process.env.PORT||4317),host=process.env.HOST||'127.0.0.1',directory=process.env.WAIFU_DATA_DIR||defaultDataDirectory}={}){
  const store=new FileStore(directory);await store.init();await loadPublishers(directory);
  const assets={};
  for(const name of ['WAIFU-ADDONS-AI-GUIDE.md','WAIFU-ADDONS-API-0.4.md']){assets['/'+name]=await fs.readFile(new URL('docs/'+name,import.meta.url),'utf8');}
  for(const [url,file] of [['/index.html','public/index.html'],['/styles.css','public/styles.css'],['/app.mjs','public/app.mjs'],['/package.mjs','shared/package.mjs'],['/mascot.svg','public/mascot.svg']]){assets[url]=await fs.readFile(new URL(file,import.meta.url),'utf8');}
  const server=http.createServer(async(req,res)=>{
    try{
      if((host==='127.0.0.1'||host==='localhost')&&!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(req.headers.host||'')){res.writeHead(400);res.end('Invalid host');return;}
      const chunks=[];let size=0;
      for await(const chunk of req){size+=chunk.length;if(size>MAX_PACKAGE_BYTES){res.writeHead(413,{'Content-Type':'application/json'});res.end(JSON.stringify({error:'Пакет больше 12 МБ.'}));return;}chunks.push(chunk);}
      const headers=new Headers();for(const [key,value]of Object.entries(req.headers)){if(typeof value==='string'){headers.set(key,value);}}
      const request=new Request(`http://${req.headers.host||'localhost'}${req.url}`,{method:req.method,headers,...(!['GET','HEAD'].includes(req.method)?{body:Buffer.concat(chunks)}:{})});
      const handler=createRegistry({store,publishers:await loadPublishers(directory),assets});
      const response=await handler(request);res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));
    }catch(error){console.error('Local server error:',error.message);if(!res.headersSent){res.writeHead(500,{'Content-Type':'application/json'});}res.end(JSON.stringify({error:'Ошибка локального сервера.'}));}
  });
  server.requestTimeout=30000;server.headersTimeout=15000;
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,host,resolve);});
  const address=server.address();
  return {server,store,url:`http://${host}:${address.port}`,directory};
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url){
  const instance=await startServer();
  console.log(`Waifu Addons: ${instance.url}`);
  console.log(`Publisher key is stored locally in ${path.join(instance.directory,'waifu-token.txt')}`);
  for(const signal of ['SIGINT','SIGTERM']){process.on(signal,()=>instance.server.close(()=>process.exit(0)));}
}
