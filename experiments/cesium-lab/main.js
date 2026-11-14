import * as C from 'cesium';
import './style.css';
import { RADIUS, WMS_URL, validateCoordinate, offsetCoordinate, directionEnu, mapImageUrl } from './lunar.mjs';
import metadata from '../../data/processed/site01_connecting_ridge_terrain.json';
import analysis from '../../backend/tests/fixtures/science/site01/analysis_nominal.json';
import binaryUrl from '../../data/processed/site01_connecting_ridge_terrain.bin?url';
import { decodeTerrain, verifyTerrainChecksum } from '../../frontend/src/scene/terrain.mjs';
const $=id=>document.getElementById(id);
C.Ellipsoid.default=new C.Ellipsoid(RADIUS,RADIUS,RADIUS);
const moon=C.Ellipsoid.default;
let viewer, patchPrimitive, patchBounds, patchMode=false, imageryErrors=0;
const rays=[], gridLines=[];
let patchImageMaterial, inspection=false;
const site=metadata.coordinates;
function setHudExpanded(open){
  $('hud-body').hidden=!open;
  $('hud-toggle').setAttribute('aria-expanded',String(open));
  $('hud-toggle').textContent=open?'Hide details ⌄':'Show details ⌃';
  $('hud-toggle').title=open?'Hide observer details':'Show observer details';
}
$('hud-toggle').onclick=()=>setHudExpanded($('hud-body').hidden);
document.addEventListener('keydown',event=>{
  if(['INPUT','TEXTAREA','SELECT'].includes(document.activeElement?.tagName))return;
  if(event.key.toLowerCase()==='h')setHudExpanded($('hud-body').hidden);
});
function status(message){$('imagery-status').textContent=message;}
function point(lon,lat,h=0){return C.Cartesian3.fromDegrees(lon,lat,h,moon);}
function mark(lat,lon,label='Selected lunar coordinate'){
  viewer.entities.removeById('selection');
  viewer.entities.add({id:'selection',position:point(lon,lat,patchMode?site.elevation_m+2:0),point:{pixelSize:10,color:C.Color.AQUAMARINE,outlineColor:C.Color.BLACK,outlineWidth:2,disableDepthTestDistance:Number.POSITIVE_INFINITY}});
  $('selection').textContent=`${label}: ${lat.toFixed(6)}° N, ${lon.toFixed(6)}° E. ${patchMode?'Fixed recorded observer.':'Position on reference sphere; elevation not sampled.'}`;
  $('hud-title').textContent=patchMode?'Connecting Ridge · Site01':'Selected lunar coordinate';
  $('location-title').textContent=patchMode?'Connecting Ridge · Site01':`${lat.toFixed(4)}°, ${lon.toFixed(4)}°`;
  setHudExpanded(true);
  $('latitude').value=String(lat);$('longitude').value=String(lon);
}
function selectMode(local){
  patchMode=local;viewer.scene.globe.show=!local;
  $('hud-title').textContent=local?'Connecting Ridge · Site01':'The Moon, in context.';
  $('data-badge').textContent=local?'CACHED REAL · 2 M':'IMAGERY VIEW';
  const formatHours=value=>value===null?'Unknown':`${value.toFixed(1)} h`;
  $('metric-sun').textContent=local?formatHours(analysis.metrics.sunlight_hours):'—';
  $('metric-earth').textContent=local?(analysis.metrics.earth_visible_fraction===null?'Unknown':`${(analysis.metrics.earth_visible_fraction*100).toFixed(1)}%`):'—';
  $('metric-darkness').textContent=local?formatHours(analysis.metrics.max_darkness_hours):'—';
  setHudExpanded(local);
  if(!local)viewer.camera.lookAtTransform(C.Matrix4.IDENTITY);
  $('mesh').disabled=!local;for(const line of gridLines)line.show=local&&inspection;
  if(patchPrimitive)patchPrimitive.show=local;
  $('patch').setAttribute('aria-pressed',String(local));$('globe').setAttribute('aria-pressed',String(!local));
  $('directions').disabled=!local;$('time').disabled=!local;
  $('mode-label').textContent=local?'Site01 LOLA geometry · true scale':'LROC WAC imagery on a lunar sphere';
  $('mode-note').textContent=local?'This patch uses the matching NASA elevation grid. Its image is a separate LROC mosaic, with baked acquisition lighting. No dynamic terrain-shadow calculation is shown.':'The global view has real imagery but no elevation relief. Imagery contains acquisition lighting; it is not the selected time’s illumination.';
  if(!local){$('directions').checked=false;for(const ray of rays)ray.show=false;$('time-label').textContent='Available in local terrain view.';$('angles').textContent='';}
}
function go(lon,lat,height){viewer.camera.flyTo({destination:point(lon,lat,height),orientation:{heading:0,pitch:-C.Math.PI_OVER_TWO,roll:0},duration:1.2});}
function updateDirections(){
  if(!patchMode)return;
  const sample=analysis.samples[Number($('time').value)];
  $('time-label').textContent=`${sample.utc} · MET +${sample.met_hours} h`;
  $('angles').textContent=`Sun ${sample.sun.azimuth_deg.toFixed(2)}° az / ${sample.sun.elevation_deg.toFixed(2)}° el · Earth ${sample.earth.azimuth_deg.toFixed(2)}° az / ${sample.earth.elevation_deg.toFixed(2)}° el`;
  const origin=point(site.longitude_deg,site.latitude_deg,site.elevation_m+analysis.observer_height_m);
  const matrix=C.Transforms.eastNorthUpToFixedFrame(origin,moon);
  for(const [i,name] of ['sun','earth'].entries()){
    const components=directionEnu(sample[name].azimuth_deg,sample[name].elevation_deg);
    const direction=C.Matrix4.multiplyByPointAsVector(matrix,new C.Cartesian3(...components),new C.Cartesian3());
    C.Cartesian3.multiplyByScalar(direction,650,direction);
    const end=C.Cartesian3.add(origin,direction,new C.Cartesian3());
    rays[i].polyline.positions=[origin,end];rays[i].show=$('directions').checked;
  }
  viewer.scene.requestRender();
}
async function loadPatch(){
  if(patchPrimitive)return;
  if(JSON.stringify(metadata.coordinates)!==JSON.stringify(analysis.coordinates)||analysis.observer_height_m!==2)throw new Error('Recorded observer and terrain metadata disagree');
  const response=await fetch(binaryUrl);if(!response.ok)throw new Error('Local DEM could not load');
  const bytes=await response.arrayBuffer();await verifyTerrainChecksum(bytes,metadata.sha256);
  const decoded=decodeTerrain(bytes,metadata);
  const n=metadata.width*metadata.height;
  const positions=new Float64Array(n*3),normals=new Float32Array(n*3),uv=new Float32Array(n*2),locations=[];
  let west=Infinity,east=-Infinity,south=Infinity,north=-Infinity;
  for(let i=0;i<n;i++){
    const loc=offsetCoordinate(site.latitude_deg,site.longitude_deg,decoded.positions[i*3],-decoded.positions[i*3+2]);
    locations.push(loc);west=Math.min(west,loc.lon);east=Math.max(east,loc.lon);south=Math.min(south,loc.lat);north=Math.max(north,loc.lat);
    const p=point(loc.lon,loc.lat,site.elevation_m+decoded.positions[i*3+1]);
    positions.set([p.x,p.y,p.z],i*3);
    const normal=moon.geodeticSurfaceNormal(p,new C.Cartesian3());normals.set([normal.x,normal.y,normal.z],i*3);
  }
  for(let i=0;i<n;i++){uv[i*2]=(locations[i].lon-west)/(east-west);uv[i*2+1]=(locations[i].lat-south)/(north-south);}
  // Local ENU indices from the checked decoder retain the upward winding.
  const geometry=new C.Geometry({attributes:{position:new C.GeometryAttribute({componentDatatype:C.ComponentDatatype.DOUBLE,componentsPerAttribute:3,values:positions}),normal:new C.GeometryAttribute({componentDatatype:C.ComponentDatatype.FLOAT,componentsPerAttribute:3,values:normals}),st:new C.GeometryAttribute({componentDatatype:C.ComponentDatatype.FLOAT,componentsPerAttribute:2,values:uv})},indices:decoded.indices,primitiveType:C.PrimitiveType.TRIANGLES,boundingSphere:C.BoundingSphere.fromVertices(positions)});
  patchBounds=geometry.boundingSphere;
  patchImageMaterial=C.Material.fromType('Image',{image:mapImageUrl([west,south,east,north])});
  patchPrimitive=viewer.scene.primitives.add(new C.Primitive({geometryInstances:new C.GeometryInstance({geometry}),appearance:new C.MaterialAppearance({material:patchImageMaterial,flat:true,faceForward:true,translucent:false}),asynchronous:false}));
  const valid=new Set(decoded.indices);
  for(let fixed=0;fixed<metadata.width;fixed+=8){
    for(const column of [false,true]){
      let segment=[];
      const flush=()=>{if(segment.length>1)gridLines.push(viewer.entities.add({show:false,polyline:{positions:segment,width:1,material:C.Color.fromCssColorString('#8de8d6')}}));segment=[];};
      for(let moving=0;moving<metadata.width;moving++){
        const i=column?moving*metadata.width+fixed:fixed*metadata.width+moving;
        if(!valid.has(i)){flush();continue;}
        segment.push(point(locations[i].lon,locations[i].lat,site.elevation_m+decoded.positions[i*3+1]+.5));
      }
      flush();
    }
  }
  for(const [name,color] of [['sun',C.Color.GOLD],['earth',C.Color.LIGHTSKYBLUE]])rays.push(viewer.entities.add({id:name,show:false,polyline:{positions:[],width:3,material:new C.PolylineArrowMaterialProperty(color)}}));
}
async function init(){
  viewer=new C.Viewer('viewer',{ellipsoid:moon,terrainProvider:new C.EllipsoidTerrainProvider({ellipsoid:moon}),baseLayer:false,baseLayerPicker:false,geocoder:false,homeButton:false,sceneModePicker:false,timeline:false,animation:false,navigationHelpButton:false,fullscreenButton:false,selectionIndicator:false,infoBox:false,skyBox:false,skyAtmosphere:false,requestRenderMode:true});
  if(viewer.scene.sun)viewer.scene.sun.show=false;if(viewer.scene.moon)viewer.scene.moon.show=false;viewer.scene.globe.showGroundAtmosphere=false;viewer.scene.globe.enableLighting=false;viewer.scene.backgroundColor=C.Color.fromCssColorString('#060b13');
  const provider=new C.WebMapServiceImageryProvider({url:WMS_URL,layers:'luna_wac_global',parameters:{version:'1.1.1',srs:'IAU2000:30100',format:'image/jpeg',transparent:false},tilingScheme:new C.GeographicTilingScheme({ellipsoid:moon}),maximumLevel:10,enablePickFeatures:false,credit:'NASA / GSFC / Arizona State University · LROC WAC via Lunaserv'});
  provider.errorEvent.addEventListener(()=>{imageryErrors++;status('Imagery request failed. The source may be temporarily unavailable; reload to retry.');});
  viewer.imageryLayers.addImageryProvider(provider);
  viewer.scene.globe.tileLoadProgressEvent.addEventListener(pending=>{if(!imageryErrors)status(pending?`Loading LROC imagery (${pending} pending tiles)…`:'LROC imagery loaded · Lunar reference sphere: 1,737,400 m');});
  viewer.camera.setView({destination:point(0,-15,RADIUS*3)});
  const picker=new C.ScreenSpaceEventHandler(viewer.scene.canvas);
  picker.setInputAction(event=>{
    if(patchMode){status('Local view is fixed to the verified Site01 observer; use globe view to explore arbitrary points.');return;}
    const picked=viewer.camera.pickEllipsoid(event.position,moon);if(!picked)return;
    const cart=moon.cartesianToCartographic(picked);mark(C.Math.toDegrees(cart.latitude),C.Math.toDegrees(cart.longitude));
  },C.ScreenSpaceEventType.LEFT_CLICK);
  $('coordinate-form').addEventListener('submit',event=>{event.preventDefault();try{const {lat,lon}=validateCoordinate(Number($('latitude').value),Number($('longitude').value));selectMode(false);mark(lat,lon);$('location-search').open=false;go(lon,lat,150000);}catch(error){$('selection').textContent=error.message;}});
  $('globe').onclick=()=>{selectMode(false);go(0,-15,RADIUS*3);};
  $('pole').onclick=()=>{selectMode(false);go(site.longitude_deg,-89.9,1500000);};
  $('site').onclick=()=>{selectMode(false);mark(site.latitude_deg,site.longitude_deg,'Canonical Connecting Ridge observer');go(site.longitude_deg,site.latitude_deg,35000);};
  $('patch').onclick=async()=>{try{status('Verifying local LOLA asset…');await loadPatch();selectMode(true);mark(site.latitude_deg,site.longitude_deg,'Canonical Connecting Ridge observer');viewer.camera.lookAtTransform(C.Transforms.eastNorthUpToFixedFrame(patchBounds.center,moon),new C.HeadingPitchRange(0,-0.65,patchBounds.radius*3.2));status('Local grid checksum and observer match verified · 129×129 · 20 m spacing · 1× height');updateDirections();}catch(error){status(`Local terrain unavailable: ${error.message}`);}};
  $('mesh').onclick=()=>{
    inspection=!inspection;$('mesh').setAttribute('aria-pressed',String(inspection));
    patchPrimitive.appearance.material=inspection?C.Material.fromType('Color',{color:C.Color.fromCssColorString('#263b4d')}):patchImageMaterial;
    for(const line of gridLines)line.show=inspection;
    viewer.scene.requestRender();
  };
  $('time').oninput=updateDirections;$('directions').onchange=updateDirections;
  window.addEventListener('pagehide',()=>{picker.destroy();if(!viewer.isDestroyed())viewer.destroy();},{once:true});
}
init().catch(error=>{status(`Viewer could not start: ${error.message}. WebGL support is required.`);console.error(error);});
