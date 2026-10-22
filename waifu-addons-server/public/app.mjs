import {validatePackage,bytesToBase64,MAX_PACKAGE_BYTES,MAX_TOTAL_BYTES} from '/package.mjs';
const main=document.getElementById('main');
const homeHtml=main.innerHTML;
const dialog=document.getElementById('publish-dialog');
const form=document.getElementById('publish-form');
const publishStatus=document.getElementById('publish-status');
const submit=document.getElementById('publish-submit');
const tokenInput=document.getElementById('publisher-token');
let catalog=[];
let filter='all';
let query='';
let bundle;
let publishing=false;
function node(tag,className,text){const value=document.createElement(tag);if(className){value.className=className;}if(text!==undefined){value.textContent=text;}return value;}
function setStatus(element,text,error=false){element.textContent=text;element.classList.toggle('error',error);}
function icon(addon){const value=node('span','addon-icon',addon.id==='uppercase'?'Aa':addon.id==='hello-waifu'?'♡':addon.name.charAt(0).toLocaleUpperCase());value.setAttribute('aria-hidden','true');return value;}
async function api(url,options){const response=await fetch(url,{redirect:'error',...options});let data;try{data=await response.json();}catch{throw new Error('Сервер вернул неожиданный ответ.');}if(!response.ok){throw new Error(data.error||'Запрос не выполнен.');}return data;}
function download(addon,className='download-link',text='↓'){
  const link=node('a',className,text);link.href=addon.downloadPath;link.download=`${addon.id}-${addon.version}.waifu`;link.setAttribute('aria-label',`Скачать ${addon.name} ${addon.version}`);return link;
}
function detailLink(addon){const link=node('a','','Подробнее ↗');link.href='/addons/'+addon.id;link.addEventListener('click',event=>{event.preventDefault();navigate(link.href);});return link;}
function renderCards(){
  const grid=document.getElementById('addon-grid');if(!grid){return;}
  grid.replaceChildren();
  const search=query.trim().toLocaleLowerCase();
  const items=catalog.filter(addon=>[addon.name,addon.id,addon.publisher,addon.description].join(' ').toLocaleLowerCase().includes(search)&&(filter==='all'||filter==='editor'&&addon.permissions.length>0||filter==='commands'&&addon.commands.length>0));
  document.getElementById('total').textContent=String(catalog.length);
  document.getElementById('results-count').textContent=`Найдено: ${items.length}`;
  for(const addon of items){
    const card=node('article','addon-card');
    const heading=node('div','card-heading');
    const title=node('div');title.append(node('h3','',addon.name),node('div','publisher',addon.publisher));heading.append(icon(addon),title);
    const meta=node('div','card-meta');meta.append(node('span','badge',addon.permissions.length?'Для редактора':'Команды'),node('span','version','v'+addon.version));
    const actions=node('div','card-actions');actions.append(detailLink(addon),download(addon));
    card.append(heading,node('p','',addon.description||'Дополнение для твоего Waifu Code.'),meta,actions);grid.append(card);
  }
  if(!items.length){grid.append(node('p','empty-state',catalog.length?'Ничего не найдено. Попробуй другой запрос.':'Здесь появятся опубликованные аддоны. Стань первым автором!'));}
}
function bindHome(){
  const search=document.getElementById('search');search.value=query;search.addEventListener('input',()=>{query=search.value;renderCards();});
  for(const button of document.querySelectorAll('[data-filter]')){button.classList.toggle('active',button.dataset.filter===filter);button.setAttribute('aria-pressed',String(button.dataset.filter===filter));button.addEventListener('click',()=>{filter=button.dataset.filter;bindFilterStyles();renderCards();});}
  document.getElementById('publish-bottom').addEventListener('click',openPublish);
}
function bindFilterStyles(){for(const button of document.querySelectorAll('[data-filter]')){button.classList.toggle('active',button.dataset.filter===filter);button.setAttribute('aria-pressed',String(button.dataset.filter===filter));}}
async function loadCatalog(){
  let cursor;const results=[];const visited=new Set();
  do{
    const data=await api('/api/addons'+(cursor?'?cursor='+encodeURIComponent(cursor):''));
    if(!Array.isArray(data.addons)){throw new Error('Каталог недоступен.');}
    results.push(...data.addons);cursor=data.nextCursor;
    if(cursor){if(visited.has(cursor)||visited.size>100){throw new Error('Слишком много страниц каталога.');}visited.add(cursor);}
  }while(cursor);
  catalog=results.sort((a,b)=>b.publishedAt.localeCompare(a.publishedAt));
}
function renderHome(){main.innerHTML=homeHtml;bindHome();setStatus(document.getElementById('catalog-status'),'');renderCards();}
function metadata(rows){const list=node('dl');for(const [label,value]of rows){list.append(node('dt','',label),node('dd','',value));}return list;}
async function showDetail(id){
  main.replaceChildren(node('p','detail-page status','Загружаем аддон…'));
  try{
    const addon=await api('/api/addons/'+encodeURIComponent(id));
    if(location.pathname!=='/addons/'+id){return;}
    const article=node('article','detail-page');
    const back=node('a','breadcrumb','← Все аддоны');back.href='/#catalog';back.addEventListener('click',event=>{event.preventDefault();navigate(back.href);});
    const header=node('header','detail-head');const title=node('div','detail-title');const heading=node('div');heading.append(node('h1','',addon.name),node('div','publisher',`${addon.publisher} · v${addon.version} · Waifu API ${addon.apiVersion}`));title.append(icon(addon),heading);header.append(title,download(addon,'button','Скачать .waifu ↓'));
    const body=node('div','detail-body');const description=node('section');description.append(node('h2','','Об аддоне'),node('p','',addon.description||'Дополнение для Waifu Code.'));
    description.append(node('h3','','Команды'));
    for(const command of addon.commands){const row=node('div','command-item');row.append(node('span','',command.title),node('code','',command.id));description.append(row);}
    description.append(node('h3','','Как установить'),node('p','','В Waifu Code открой Waifu Addons → Available и нажми Install. Скачанный пакет .waifu также можно установить через команду Waifu Addons: Install Package.'));
    description.append(node('h3','','Версии'));
    const table=node('table','versions');const head=node('thead');const headRow=node('tr');for(const label of ['Версия','Опубликована','Пакет']){headRow.append(node('th','',label));}head.append(headRow);const rows=node('tbody');
    for(const release of [...addon.versions].reverse()){const row=node('tr');row.append(node('td','',release.version),node('td','',new Date(release.publishedAt).toLocaleDateString('ru-RU')));const cell=node('td');cell.append(download({...release,name:addon.name,id:addon.id},'','Скачать ↓'));row.append(cell);rows.append(row);}table.append(head,rows);description.append(table);
    const aside=node('aside','detail-aside');aside.append(metadata([['Издатель',addon.publisher],['Идентификатор',addon.id],['Версия',addon.version],['Размер пакета',(addon.size/1024).toFixed(1)+' КБ'],['Разрешения API',addon.permissions.join(', ')||'Не требуются']]));aside.append(node('h3','','SHA-256'),node('pre','code',addon.sha256));body.append(description,aside);article.append(back,header,body);main.replaceChildren(article);document.title=addon.name+' — Waifu Addons';
  }catch(error){main.replaceChildren(node('p','detail-page status error',error.message));}
}
function navigate(url){history.pushState({},'',url);showRoute();window.scrollTo(0,0);}
async function showRoute(){const match=/^\/addons\/([a-z][a-z0-9-]{1,63})$/.exec(location.pathname);if(match){await showDetail(match[1]);}else{document.title='Waifu Addons — дополнения для твоего редактора';renderHome();if(location.hash==='#publish'){openPublish();}if(location.hash==='#catalog'){document.getElementById('catalog').scrollIntoView();}}}
function openPublish(){setStatus(publishStatus,'');dialog.showModal();}
function closePublish(){if(!publishing){dialog.close();tokenInput.value='';}}
async function choosePackage(file){
  bundle=undefined;submit.disabled=true;setStatus(publishStatus,'');
  if(!file){return;}
  try{if(file.size>MAX_PACKAGE_BYTES){throw new Error('Пакет больше 12 МБ.');}const validated=validatePackage(JSON.parse(await file.text()));bundle=validated.bundle;previewPackage(validated.manifest,file.name);}
  catch(error){setStatus(publishStatus,error.message,true);}
}
async function chooseFolder(files){
  bundle=undefined;submit.disabled=true;setStatus(publishStatus,'Читаем папку…');
  try{
    const selected=Array.from(files).filter(file=>!(file.webkitRelativePath||file.name).split('/').some(part=>part.startsWith('.')||part==='node_modules'));
    if(!selected.length||selected.length>200){throw new Error('Выбери папку аддона, содержащую не более 200 файлов.');}
    const prefix=selected[0].webkitRelativePath?.split('/')[0];const entries=[];let total=0;
    for(const file of selected){if(file.size>2*1024*1024){throw new Error('Один из файлов больше 2 МБ.');}total+=file.size;if(total>MAX_TOTAL_BYTES){throw new Error('Аддон больше 8 МБ.');}const name=file.webkitRelativePath&&prefix?file.webkitRelativePath.slice(prefix.length+1):file.name;entries.push({path:name,data:bytesToBase64(new Uint8Array(await file.arrayBuffer()))});}
    const validated=validatePackage({format:'waifu-addon-v1',files:entries});bundle=validated.bundle;previewPackage(validated.manifest,prefix||'Папка аддона');setStatus(publishStatus,'');
  }catch(error){setStatus(publishStatus,error.message,true);}
}
function previewPackage(manifest,name){const preview=document.getElementById('package-preview');preview.hidden=false;preview.textContent=`${manifest.name} · v${manifest.version}\n${manifest.id} · ${bundle.files.length} файлов`;document.getElementById('package-label').textContent=name;submit.disabled=false;}
for(const id of ['publish-open']){document.getElementById(id)?.addEventListener('click',openPublish);}
document.getElementById('publish-close').addEventListener('click',closePublish);
dialog.addEventListener('cancel',event=>{if(publishing){event.preventDefault();}else{tokenInput.value='';}});
document.getElementById('package-file').addEventListener('change',event=>choosePackage(event.target.files[0]));
document.getElementById('package-folder').addEventListener('change',event=>chooseFolder(event.target.files));
for(const label of document.querySelectorAll('.file-options label')){label.addEventListener('keydown',event=>{if(['Enter',' '].includes(event.key)){event.preventDefault();label.querySelector('input').click();}});}
const drop=document.getElementById('drop-zone');drop.addEventListener('dragover',event=>{event.preventDefault();drop.classList.add('dragging');});drop.addEventListener('dragleave',()=>drop.classList.remove('dragging'));drop.addEventListener('drop',event=>{event.preventDefault();drop.classList.remove('dragging');choosePackage(event.dataTransfer.files[0]);});
form.addEventListener('submit',async event=>{
  event.preventDefault();if(!bundle||publishing){return;}publishing=true;submit.disabled=true;setStatus(publishStatus,'Публикуем аддон…');
  try{const result=await api('/api/addons',{method:'POST',headers:{'Content-Type':'application/vnd.waifu.addon+json','Authorization':'Bearer '+tokenInput.value.trim()},body:JSON.stringify(bundle)});tokenInput.value='';publishing=false;dialog.close();bundle=undefined;form.reset();document.getElementById('package-preview').hidden=true;document.getElementById('package-label').textContent='Перетащи сюда пакет .waifu';await loadCatalog();navigate('/addons/'+result.addon.id);}
  catch(error){setStatus(publishStatus,error.message,true);}
  finally{publishing=false;submit.disabled=!bundle;}
});
window.addEventListener('popstate',showRoute);
document.querySelectorAll('.site-header a, footer a').forEach(link=>link.addEventListener('click',event=>{event.preventDefault();navigate(link.href);}));
window.addEventListener('keydown',event=>{if(event.key==='/'&&!dialog.open&&!['INPUT','TEXTAREA'].includes(document.activeElement.tagName)){const search=document.getElementById('search');if(search){event.preventDefault();search.focus();}}});
bindHome();
try{await loadCatalog();await showRoute();}catch(error){const status=document.getElementById('catalog-status');if(status){setStatus(status,error.message,true);}else{main.replaceChildren(node('p','detail-page status error',error.message));}}
