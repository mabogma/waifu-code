import fs from 'node:fs/promises';
import path from 'node:path';
import {packDirectory} from '../cli.mjs';
import {defaultDataDirectory} from '../auth.mjs';
import {bytesToBase64,base64ToBytes} from '../shared/package.mjs';
const token=(await fs.readFile(path.join(defaultDataDirectory,'waifu-token.txt'),'utf8')).trim();
const source=path.resolve(new URL('../examples/',import.meta.url).pathname.replace(/^\/([A-Za-z]:)/,'$1'));
for(const [folder,description]of [['hello','Приветствие и первый пример аддона для твоего Waifu Code.'],['uppercase','Преобразуй выделенный текст в верхний регистр одной командой. Поддерживает отмену через Ctrl+Z.']]){
  const bundle=await packDirectory(path.join(source,folder));
  const file=bundle.files.find(item=>item.path==='waifu-addon.json');const manifest=JSON.parse(new TextDecoder().decode(base64ToBytes(file.data)));manifest.description=description;file.data=bytesToBase64(new TextEncoder().encode(JSON.stringify(manifest)));
  const response=await fetch('http://127.0.0.1:4317/api/addons',{method:'POST',headers:{'Authorization':'Bearer '+token,'Content-Type':'application/vnd.waifu.addon+json'},body:JSON.stringify(bundle)});
  if(!response.ok&&response.status!==409){throw new Error(await response.text());}
  console.log('Catalog entry ready: '+manifest.id);
}
