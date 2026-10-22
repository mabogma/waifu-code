import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {bytesToBase64,validatePackage,safePath} from './shared/package.mjs';
import {createPublisher,defaultDataDirectory} from './auth.mjs';
export async function packDirectory(directory){
  const root=await fs.realpath(directory);const files=[];
  async function visit(folder){for(const entry of await fs.readdir(folder,{withFileTypes:true})){
    if(entry.name.startsWith('.')||['node_modules','.git'].includes(entry.name)){continue;}
    if(entry.isSymbolicLink()){throw new Error('Symbolic links are not allowed in addon packages.');}
    const source=path.join(folder,entry.name);
    if(entry.isDirectory()){await visit(source);}else if(entry.isFile()){
      const relative=safePath(path.relative(root,source).split(path.sep).join('/'));
      const stat=await fs.stat(source);if(stat.size>2*1024*1024){throw new Error('An addon file exceeds 2 MB.');}
      files.push({path:relative,data:bytesToBase64(await fs.readFile(source))});
      if(files.length>200){throw new Error('Too many addon files.');}
    }
  }}
  await visit(root);return validatePackage({format:'waifu-addon-v1',files}).bundle;
}
async function main(){
  const [command,arg,destination]=process.argv.slice(2);
  if(command==='publisher'){console.log('Publisher key saved to '+await createPublisher(process.env.WAIFU_DATA_DIR||defaultDataDirectory,arg||'waifu'));return;}
  if(command==='pack'){
    if(!arg){throw new Error('Usage: node cli.mjs pack <addon-folder> [output.waifu]');}
    const bundle=await packDirectory(arg);const file=path.resolve(destination||arg+'.waifu');await fs.writeFile(file,JSON.stringify(bundle));console.log('Package saved to '+file);return;
  }
  throw new Error('Commands: publisher <id>; pack <addon-folder> [output.waifu]');
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url){main().catch(error=>{console.error(error.message);process.exitCode=1;});}
