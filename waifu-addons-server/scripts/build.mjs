import fs from 'node:fs/promises';
import path from 'node:path';
const root=path.resolve(new URL('..',import.meta.url).pathname.replace(/^\/([A-Za-z]:)/,'$1'));
const out=path.join(root,'dist');
await fs.mkdir(path.join(out,'server'),{recursive:true});await fs.mkdir(path.join(out,'.openai'),{recursive:true});
const assets={};
for(const name of ['WAIFU-ADDONS-AI-GUIDE.md','WAIFU-ADDONS-API-0.4.md']){assets['/'+name]=await fs.readFile(path.join(root,'docs',name),'utf8');}
for(const [url,file]of [['/index.html','public/index.html'],['/styles.css','public/styles.css'],['/app.mjs','public/app.mjs'],['/package.mjs','shared/package.mjs'],['/mascot.svg','public/mascot.svg']]){assets[url]=await fs.readFile(path.join(root,file),'utf8');}
const strip=source=>source.replace(/^import .*?;\r?\n/gm,'').replace(/^export (class|function|async function|const) /gm,'$1 ');
const codec=strip(await fs.readFile(path.join(root,'shared/package.mjs'),'utf8'));
const registry=strip(await fs.readFile(path.join(root,'shared/registry.mjs'),'utf8'));
const entry=(await fs.readFile(path.join(root,'worker/index.js'),'utf8')).replace(/^import .*?;\r?\n/gm,'').replace('export class R2Store','class R2Store');
await fs.writeFile(path.join(out,'server/index.js'),`const ASSETS=${JSON.stringify(assets)};\n${codec}\n${registry}\n${entry}`);
await fs.copyFile(path.join(root,'.openai/hosting.json'),path.join(out,'.openai/hosting.json'));
console.log('Built portable Worker artifact.');
