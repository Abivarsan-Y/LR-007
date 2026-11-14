import test from 'node:test';
import assert from 'node:assert/strict';
import { RADIUS, validateCoordinate, offsetCoordinate, directionEnu, mapImageUrl, observerMatches, isCanonicalTerrain } from './lunar.mjs';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
test('lunar radius and longitude normalization', () => {
  assert.equal(RADIUS, 1737400);
  assert.deepEqual(validateCoordinate(-89,222),{lat:-89,lon:-138});
  assert.throws(()=>validateCoordinate(91,0));
  assert.throws(()=>validateCoordinate(0,NaN));
});
test('local offsets preserve centre and north/east directions',()=>{
  const lat=-89.46315775697231,lon=-137.50198490762307;
  assert.deepEqual(offsetCoordinate(lat,lon,0,0),{lat,lon});
  assert.ok(offsetCoordinate(lat,lon,0,100).lat>lat);
  assert.ok(offsetCoordinate(lat,lon,100,0).lon>lon);
  assert.ok(Math.abs(offsetCoordinate(0,0,100,0).lon-100/RADIUS*180/Math.PI)<1e-10);
});
test('directions use ENU, north clockwise',()=>{
  const close=(a,b)=>a.every((v,i)=>Math.abs(v-b[i])<1e-12);
  assert.ok(close(directionEnu(0,0),[0,1,0]));
  assert.ok(close(directionEnu(90,0),[1,0,0]));
  assert.ok(close(directionEnu(0,90),[0,0,1]));
});
test('imagery requests use lunar CRS and lon-lat axis order',()=>{
  const url=new URL(mapImageUrl([-140,-90,-135,-88]));
  assert.equal(url.searchParams.get('srs'),'IAU2000:30100');
  assert.equal(url.searchParams.get('bbox'),'-140,-90,-135,-88');
});
test('local grid matches canonical recorded observer and checksum',async()=>{
  const root=new URL('../../../../',import.meta.url);
  const json=async name=>JSON.parse(await readFile(new URL(name,root)));
  const meta=await json('data/processed/site01_connecting_ridge_terrain.json');
  const analysis=await json('backend/tests/fixtures/science/site01/analysis_nominal.json');
  const bytes=await readFile(new URL(meta.asset_path,root));
  assert.equal(createHash('sha256').update(bytes).digest('hex'),meta.sha256);
  assert.deepEqual(meta.coordinates,analysis.coordinates);
  assert.equal(meta.width,129);assert.equal(meta.height,129);
  assert.equal(bytes.readFloatLE((64*129+64)*4),analysis.coordinates.elevation_m);
  assert.equal(analysis.observer_height_m,2);
});

test('celestial overlays reject other observers, heights, frames and preview data',()=>{
  const c={latitude_deg:-89.4,longitude_deg:-137.5,elevation_m:1944,frame:'MOON_ME_DE421',reference_radius_m:RADIUS};
  const meta={coordinates:c,provenance:{data_kind:'cached_real'}};
  assert.equal(isCanonicalTerrain(meta,c),true);
  assert.equal(observerMatches(meta,c,2,2,'cached_real'),true);
  assert.equal(observerMatches(meta,c,2,5,'cached_real'),false);
  assert.equal(observerMatches(meta,c,2,2,'synthetic'),false);
  assert.equal(observerMatches(meta,{...c,latitude_deg:-88},2,2,'cached_real'),false);
  assert.equal(observerMatches(meta,{...c,elevation_m:1850},2,2,'cached_real'),false);
  assert.equal(observerMatches(meta,{...c,frame:'unknown'},2,2,'cached_real'),false);
  assert.equal(isCanonicalTerrain({...meta,provenance:{data_kind:'synthetic'}},c),false);
});
