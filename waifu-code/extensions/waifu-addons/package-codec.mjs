export const MAX_PACKAGE_BYTES = 12 * 1024 * 1024;
export const MAX_FILE_BYTES = 2 * 1024 * 1024;
export const MAX_TOTAL_BYTES = 8 * 1024 * 1024;
export const ID_PATTERN = /^[a-z][a-z0-9-]{1,63}$/;
export const VERSION_PATTERN = /^(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})$/;
export const PERMISSIONS = ['editor.read', 'editor.write', 'ui.panels', 'files.read', 'files.write', 'tasks.background', 'storage.settings', 'storage.secrets'];
export class RegistryError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
export function safePath(name) {
  if (typeof name !== 'string' || name.length > 240 || !name || name.includes('\\') || name.startsWith('/') || name.includes(':') || /[\x00-\x1f\x7f]/.test(name)) { throw new RegistryError(400, 'Недопустимый путь в пакете.'); }
  const parts = name.split('/');
  if (parts.some(part => !part || part === '.' || part === '..' || /[. ]$/.test(part) || /[<>"|?*]/.test(part) || /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(part) || part.startsWith('.') || ['node_modules', '.git'].includes(part.toLowerCase()))) { throw new RegistryError(400, 'Недопустимый путь в пакете.'); }
  return name;
}
export function bytesToBase64(bytes) {
  let text = '';
  for (let index = 0; index < bytes.length; index += 32768) { text += String.fromCharCode(...bytes.subarray(index, index + 32768)); }
  return btoa(text);
}
export function base64ToBytes(text) {
  if (typeof text !== 'string' || text.length > Math.ceil(MAX_FILE_BYTES / 3) * 4 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(text)) { throw new RegistryError(400, 'Некорректные данные файла.'); }
  const decoded = atob(text);
  return Uint8Array.from(decoded, character => character.charCodeAt(0));
}
export async function sha256(value) {
  const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : value;
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}
export function validateManifest(input) {
  if (!input || typeof input !== 'object' || !ID_PATTERN.test(input.id) || !VERSION_PATTERN.test(input.version) || input.apiVersion !== 1 || typeof input.name !== 'string' || !input.name.trim() || input.name.length > 100) { throw new RegistryError(400, 'Проверьте id, name, version и apiVersion в waifu-addon.json.'); }
  safePath(input.main);
  if (!input.main.endsWith('.cjs')) { throw new RegistryError(400, 'main должен указывать на .cjs-файл.'); }
  if (!Array.isArray(input.commands) || input.commands.length > 50 || !input.commands.every(command => command && typeof command.id === 'string' && command.id.startsWith(`waifu.${input.id}.`) && /^[a-zA-Z0-9.-]{1,150}$/.test(command.id) && typeof command.title === 'string' && command.title.trim() && command.title.length <= 100) || new Set(input.commands.map(command => command.id)).size !== input.commands.length) { throw new RegistryError(400, 'Некорректный список команд аддона.'); }
  if (input.permissions !== undefined && (!Array.isArray(input.permissions) || input.permissions.length > PERMISSIONS.length || !input.permissions.every(permission => PERMISSIONS.includes(permission)))) { throw new RegistryError(400, 'Неизвестные разрешения API.'); }
  if (input.description !== undefined && (typeof input.description !== 'string' || input.description.length > 1000)) { throw new RegistryError(400, 'Описание должно быть строкой до 1000 символов.'); }
  return { id: input.id, name: input.name.trim(), version: input.version, apiVersion: 1, main: input.main, description: input.description || '', permissions: [...new Set(input.permissions || [])], commands: input.commands.map(command => ({id:command.id,title:command.title})) };
}
export function validatePackage(input, publisher) {
  if (!input || input.format !== 'waifu-addon-v1' || !Array.isArray(input.files) || !input.files.length || input.files.length > 200) { throw new RegistryError(400, 'Нужен пакет Waifu Addon v1: не более 200 файлов.'); }
  const seen = new Set();
  let size = 0;
  const files = input.files.map(file => {
    const name = safePath(file?.path);
    const key = name.toLowerCase();
    if (seen.has(key)) { throw new RegistryError(400, 'Пакет содержит дублирующиеся пути.'); }
    seen.add(key);
    const bytes = base64ToBytes(file.data);
    if (bytes.length > MAX_FILE_BYTES) { throw new RegistryError(413, 'Файл больше 2 МБ.'); }
    size += bytes.length;
    if (size > MAX_TOTAL_BYTES) { throw new RegistryError(413, 'Распакованный аддон больше 8 МБ.'); }
    return {path:name,data:file.data};
  });
  const paths = [...seen].sort();
  for (const name of paths) { const parts = name.split('/'); for (let index = 1; index < parts.length; index++) { if (seen.has(parts.slice(0, index).join('/'))) { throw new RegistryError(400, 'Файл конфликтует с папкой в пакете.'); } } }
  const manifestFile = files.find(file => file.path === 'waifu-addon.json');
  if (!manifestFile) { throw new RegistryError(400, 'В корне пакета нужен waifu-addon.json.'); }
  let raw;
  try { raw = JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(base64ToBytes(manifestFile.data))); }
  catch { throw new RegistryError(400, 'waifu-addon.json содержит некорректный JSON.'); }
  const manifest = validateManifest(raw);
  const identity = publisher || (typeof raw.publisher === 'string' && ID_PATTERN.test(raw.publisher) ? raw.publisher : undefined);
  if (identity) { manifest.publisher = identity; }
  if (!files.some(file => file.path === manifest.main)) { throw new RegistryError(400, 'Точка входа main отсутствует в пакете.'); }
  manifestFile.data = bytesToBase64(new TextEncoder().encode(JSON.stringify(manifest,null,2)+'\n'));
  files.sort((a,b)=>a.path.localeCompare(b.path));
  return { manifest, bundle: {format:'waifu-addon-v1',files}, size };
}
export function compareVersions(a,b) {
  const aa=a.split('.').map(Number),bb=b.split('.').map(Number);
  for(let index=0;index<3;index++){if(aa[index]!==bb[index]){return aa[index]>bb[index]?1:-1;}}
  return 0;
}
export async function readBoundedBody(request, limit=MAX_PACKAGE_BYTES) {
  if (Number(request.headers.get('content-length')) > limit) { throw new RegistryError(413,'Пакет больше 12 МБ.'); }
  if (!request.body) { return new Uint8Array(); }
  const reader=request.body.getReader();
  const chunks=[];let size=0;
  try { while(true){const {done,value}=await reader.read();if(done){break;}size+=value.length;if(size>limit){await reader.cancel();throw new RegistryError(413,'Пакет больше 12 МБ.');}chunks.push(value);} }
  finally {reader.releaseLock();}
  const bytes=new Uint8Array(size);let offset=0;
  for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  return bytes;
}
