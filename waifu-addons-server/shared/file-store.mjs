import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {sha256,RegistryError} from './package.mjs';
export class FileStore {
  constructor(directory){this.directory=directory;this.queue=Promise.resolve();}
  async init(){await fs.mkdir(path.join(this.directory,'addons'),{recursive:true});await fs.mkdir(path.join(this.directory,'packages'),{recursive:true});}
  async getRecord(id){
    try{const text=await fs.readFile(path.join(this.directory,'addons',id+'.json'),'utf8');return {value:JSON.parse(text),etag:await sha256(text)};}
    catch(error){if(error.code==='ENOENT'){return {value:null,etag:null};}throw error;}
  }
  async list(cursor){
    const offset=cursor===undefined?0:Number(cursor);
    if(!Number.isSafeInteger(offset)||offset<0){throw new RegistryError(400,'Некорректная страница каталога.');}
    const names=(await fs.readdir(path.join(this.directory,'addons'))).filter(name=>/^[a-z][a-z0-9-]{1,63}\.json$/.test(name)).sort();
    const records=await Promise.all(names.slice(offset,offset+100).map(async name=>(await this.getRecord(name.slice(0,-5))).value));
    return {records:records.filter(Boolean),nextCursor:offset+100<names.length?String(offset+100):null};
  }
  async putRecord(id,value,expectedEtag){
    const operation=this.queue.then(async()=>{
      const current=await this.getRecord(id);
      if(current.etag!==expectedEtag){return false;}
      const destination=path.join(this.directory,'addons',id+'.json');
      const temporary=destination+'.'+randomUUID()+'.tmp';
      await fs.writeFile(temporary,JSON.stringify(value));
      await fs.rename(temporary,destination);
      return true;
    });
    this.queue=operation.catch(()=>{});
    return operation;
  }
  async putPackage(id,release,bytes){
    const directory=path.join(this.directory,'packages',id);
    await fs.mkdir(directory,{recursive:true});
    const destination=path.join(directory,release.version+'-'+release.sha256+'.waifu');
    const temporary=destination+'.'+randomUUID()+'.tmp';
    await fs.writeFile(temporary,bytes);await fs.rename(temporary,destination);
  }
  async getPackage(id,release){try{return await fs.readFile(path.join(this.directory,'packages',id,release.version+'-'+release.sha256+'.waifu'));}catch(error){if(error.code==='ENOENT'){return null;}throw error;}}
}
