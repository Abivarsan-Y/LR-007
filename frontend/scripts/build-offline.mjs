import { readdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const root=new URL('../dist/',import.meta.url);
async function walk(dir=''){
  const entries=await readdir(new URL(dir,root),{withFileTypes:true});
  return (await Promise.all(entries.map(e=>e.isDirectory()?walk(`${dir}${e.name}/`):`${dir}${e.name}`))).flat();
}
const files=(await walk()).filter(f=>f!=='sw.js').sort();
const hash=createHash('sha256');
for(const file of files){hash.update(file);hash.update(await readFile(new URL(file,root)));}
const version=hash.digest('hex').slice(0,16);
const sw=`// Generated from the complete production build; no API or external tile caching.
const CACHE='horizon-ops-${version}';
const FILES=${JSON.stringify(files)};
const urls=FILES.map(path=>new URL(path,self.registration.scope).href);
const allowed=new Set(urls);
self.addEventListener('install',event=>event.waitUntil((async()=>{
  const cache=await caches.open(CACHE);
  // Small batches avoid hundreds of simultaneous requests to static hosts.
  for(let i=0;i<urls.length;i+=16)await cache.addAll(urls.slice(i,i+16));
})()));
self.addEventListener('activate',event=>event.waitUntil((async()=>{
  for(const key of await caches.keys())if(key.startsWith('horizon-ops-')&&key!==CACHE)await caches.delete(key);
  await self.clients.claim();
})()));
self.addEventListener('fetch',event=>{
  const request=event.request,url=new URL(request.url);
  if(request.method!=='GET'||url.origin!==self.location.origin||url.pathname.includes('/api/'))return;
  if(request.mode==='navigate'){
    event.respondWith(fetch(request).catch(()=>caches.open(CACHE).then(cache=>cache.match(new URL('index.html',self.registration.scope).href))));
  }else if(allowed.has(url.href)){
    event.respondWith(caches.open(CACHE).then(async cache=>(await cache.match(request))||fetch(request)));
  }
});
`;
await writeFile(new URL('sw.js',root),sw);
console.log(`Offline build ${version}: ${files.length} local files; API and live tiles excluded.`);
