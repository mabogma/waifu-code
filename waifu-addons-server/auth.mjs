import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomBytes} from 'node:crypto';
import {sha256,ID_PATTERN} from './shared/package.mjs';
export const defaultDataDirectory=path.resolve(fileURLToPath(new URL('./.private/data/',import.meta.url)));
export async function createPublisher(directory,id){
  if(!ID_PATTERN.test(id)){throw new Error('Publisher id must be 2–64 lowercase letters, numbers or hyphens.');}
  await fs.mkdir(directory,{recursive:true});
  const keyPath=path.join(directory,id+'-token.txt');
  try{await fs.access(keyPath);throw new Error('Publisher key already exists.');}catch(error){if(error.code!=='ENOENT'){throw error;}}
  let publishers={};
  const authFile=path.join(directory,'publishers.json');
  try{publishers=JSON.parse(await fs.readFile(authFile,'utf8'));}catch(error){if(error.code!=='ENOENT'){throw error;}}
  const token=randomBytes(32).toString('base64url');
  publishers[await sha256(token)]=id;
  await fs.writeFile(keyPath,token+'\n',{mode:0o600,flag:'wx'});
  await fs.writeFile(authFile,JSON.stringify(publishers,null,2),{mode:0o600});
  return keyPath;
}
export async function loadPublishers(directory){
  try{return JSON.parse(await fs.readFile(path.join(directory,'publishers.json'),'utf8'));}
  catch(error){if(error.code!=='ENOENT'){throw error;}await createPublisher(directory,'waifu');return loadPublishers(directory);}
}
