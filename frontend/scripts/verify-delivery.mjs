import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import vm from 'node:vm';
const dist=new URL('../dist/',import.meta.url);
const json=async path=>JSON.parse(await readFile(new URL(path,dist)));
const sources=await json('imagery/sources.json');
for(const image of sources.images){
  const bytes=await readFile(new URL(`imagery/${image.file}`,dist));
  assert.equal(createHash('sha256').update(bytes).digest('hex'),image.sha256,`Imagery checksum: ${image.file}`);
}
const terrain=JSON.parse(await readFile(new URL('../../data/processed/site01_connecting_ridge_terrain.json',import.meta.url)));
assert.equal(sources.terrain_sha256,terrain.sha256,'Cached local image must correspond to the current terrain crop');
const listeners={},stores=new Map([['unrelated-cache',new Map()],['horizon-ops-old',new Map()]]);
const caches={
  keys:async()=>[...stores.keys()], delete:async key=>stores.delete(key),
  open:async name=>{
    if(!stores.has(name))stores.set(name,new Map());
    const cache=stores.get(name);
    return {addAll:async urls=>{for(const url of urls){const path=new URL(url).pathname.slice(1);await readFile(new URL(path,dist));cache.set(url,{url});}},match:async request=>cache.get(typeof request==='string'?request:request.url)};
  },
};
const scope='https://demo.example/';
const context={URL,Set,caches,fetch:async()=>{throw new Error('offline');},self:{registration:{scope},location:{origin:'https://demo.example'},clients:{claim:async()=>{}},addEventListener:(name,fn)=>listeners[name]=fn}};
vm.runInNewContext(await readFile(new URL('sw.js',dist),'utf8'),context);
let work;
listeners.install({waitUntil:p=>work=p});await work;
listeners.activate({waitUntil:p=>work=p});await work;
assert.equal(stores.has('unrelated-cache'),true);assert.equal(stores.has('horizon-ops-old'),false);
const saved=[...stores.entries()].find(([key])=>key.startsWith('horizon-ops-'))[1];
assert.ok(saved.has(`${scope}imagery/lroc-site01.jpg`));
const assets=await readdir(new URL('assets/',dist));
for(const file of assets)assert.ok(saved.has(`${scope}assets/${file}`),`Offline asset missing: ${file}`);
async function request(path,mode='cors'){
  let response;
  listeners.fetch({request:{method:'GET',url:scope+path,mode},respondWith:p=>response=p});
  return response?await response:null;
}
assert.equal((await request('','navigate')).url,`${scope}index.html`,'Offline navigation must open the app shell');
assert.equal((await request('imagery/lroc-site01.jpg')).url,`${scope}imagery/lroc-site01.jpg`);
assert.equal(await request('api/analyze'),null,'Scientific API calls must never receive cached static responses');
console.log(`Delivery verified: real imagery checksums, ${saved.size} offline files, navigation fallback, cache isolation and API exclusion.`);
