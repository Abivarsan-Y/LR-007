/** Refresh checked-in real imagery deliberately; never runs during a build. */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { mapImageUrl, offsetCoordinate } from '../src/features/map/lunar.mjs';
const root = new URL('../../', import.meta.url);
const metadata = JSON.parse(await readFile(new URL('data/processed/site01_connecting_ridge_terrain.json', root)));
const { latitude_deg: lat, longitude_deg: lon } = metadata.coordinates;
let west=Infinity, south=Infinity, east=-Infinity, north=-Infinity;
for(let row=0;row<metadata.height;row++)for(let col=0;col<metadata.width;col++){
  const p=offsetCoordinate(lat,lon,(col-(metadata.width-1)/2)*metadata.spacing_m,((metadata.height-1)/2-row)*metadata.spacing_m);
  west=Math.min(west,p.lon);east=Math.max(east,p.lon);south=Math.min(south,p.lat);north=Math.max(north,p.lat);
}
const out = new URL('../public/imagery/', import.meta.url);
await mkdir(out,{recursive:true});
const images=[];
for(const [file,bounds,width,height] of [
  ['lroc-global.jpg',[-180,-90,180,90],2048,1024],
  ['lroc-site01.jpg',[west,south,east,north],1024,1024],
]){
  const url=mapImageUrl(bounds,width,height);
  const response=await fetch(url,{signal:AbortSignal.timeout(60000)});
  if(!response.ok||!response.headers.get('content-type')?.startsWith('image/jpeg'))throw new Error(`Imagery download failed: ${response.status}`);
  const bytes=Buffer.from(await response.arrayBuffer());
  if(bytes[0]!==255||bytes[1]!==216)throw new Error('Expected JPEG image');
  await writeFile(new URL(file,out),bytes);
  images.push({file,url,bounds,width,height,sha256:createHash('sha256').update(bytes).digest('hex'),bytes:bytes.length});
}
await writeFile(new URL('sources.json',out),JSON.stringify({retrieved_utc:new Date().toISOString(),credit:'NASA / GSFC / Arizona State University · LROC WAC via Lunaserv',layer:'luna_wac_global',crs:'IAU2000:30100',note:'Imagery only; acquisition lighting is baked into the mosaic. Not a DEM or computed mission shadow map.',terrain_sha256:metadata.sha256,images},null,2)+'\n');
console.log(images.map(({file,bytes})=>({file,bytes})));
