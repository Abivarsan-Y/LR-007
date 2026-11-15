import { useEffect, useRef, useState } from 'react'
import * as C from 'cesium'
import 'cesium/Build/Cesium/Widgets/widgets.css'
import type { AnalysisSample, CatalogSiteEntry, ContractRecommendDocument, Coordinates, DecodedDemSiteTerrain } from '../../api/types'
import { RADIUS, WMS_URL, offsetCoordinate, directionEnu, mapImageUrl, observerMatches, isCanonicalTerrain } from './lunar.mjs'
import canonical from '../../../../backend/tests/fixtures/science/site01/site.json'

export type TerrainOverlayMode = 'albedo' | 'slope'
export type SurfaceCameraPreset = 'OBLIQUE' | 'HORIZON'
export interface SurfacePickEvent {
  latitude_deg: number; longitude_deg: number; elevation_m: number; slope_deg: number | null
  matchedCatalogSite: CatalogSiteEntry | null; label: string; horizonAnglesDeg: number[]
}
interface Props {
  catalogSites: CatalogSiteEntry[]; selectedSiteId: string | null
  focusCoordinates: { latitude_deg: number; longitude_deg: number } | null
  hasSelection: boolean; desiredCameraMode: 'ORBITAL' | 'SURFACE'
  surfacePreset?: SurfaceCameraPreset; useNasaTrekImagery?: boolean; cameraPresetNonce: number
  demTerrain: DecodedDemSiteTerrain | null; currentSample: AnalysisSample | null
  analysisCoordinates: Coordinates | null; analysisObserverHeightM: number | null; analysisDataKind: string | null
  recommendations: ContractRecommendDocument | null; highlightedCandidateId: string | null
  overlayMode: TerrainOverlayMode; showWireframe: boolean; verticalScale: number; observerHeightM: 2 | 5
  onCameraModeChange: (mode: 'ORBITAL' | 'SURFACE') => void
  onPickPoint: (pick: SurfacePickEvent) => void; onSelectCatalogSite: (site: CatalogSiteEntry) => void
  onNasaImageryStatusChange?: (status: 'loading' | 'loaded' | 'offline') => void
}
interface Runtime {
  viewer: C.Viewer; patch: C.Primitive | null; wire: C.PolylineCollection | null
  imageMaterial: C.Material | null; bounds: C.BoundingSphere | null; local: boolean
  rays: C.Entity[]; target: C.Entity | null; catalog: C.Entity[]; provider: C.WebMapServiceImageryProvider
  patchCentre: C.Cartesian3 | null
}
const MOON = new C.Ellipsoid(RADIUS, RADIUS, RADIUS)
function position(lon: number, lat: number, height=0) { return C.Cartesian3.fromDegrees(lon,lat,height,MOON) }
function discardPatch(rt: Runtime) {
  if (rt.patch) rt.viewer.scene.primitives.remove(rt.patch)
  if (rt.wire) rt.viewer.scene.primitives.remove(rt.wire)
  rt.patch=null;rt.wire=null;rt.bounds=null;rt.patchCentre=null
}
function makePatch(rt: Runtime, dem: DecodedDemSiteTerrain, scale: number, slope: boolean) {
  discardPatch(rt)
  const {metadata,indices}=dem, origin=metadata.coordinates, count=metadata.width*metadata.height
  const vertices=new Float64Array(count*3),normals=new Float32Array(count*3),uv=new Float32Array(count*2),colors=new Uint8Array(count*4)
  const locations:{lat:number;lon:number}[]=[]
  let west=Infinity,east=-Infinity,south=Infinity,north=-Infinity
  for(let i=0;i<count;i++){
    const loc=offsetCoordinate(origin.latitude_deg,origin.longitude_deg,dem.positions[i*3],-dem.positions[i*3+2])
    locations.push(loc);west=Math.min(west,loc.lon);east=Math.max(east,loc.lon);south=Math.min(south,loc.lat);north=Math.max(north,loc.lat)
    const p=position(loc.lon,loc.lat,origin.elevation_m+dem.positions[i*3+1]*scale)
    vertices.set([p.x,p.y,p.z],i*3)
    const normal=MOON.geodeticSurfaceNormal(p,new C.Cartesian3());normals.set([normal.x,normal.y,normal.z],i*3)
    const angle=dem.slopeDegPerVertex[i]
    const color=!Number.isFinite(angle)?C.Color.SLATEGRAY:angle<8?C.Color.fromCssColorString('#3eaa89'):angle<=15?C.Color.fromCssColorString('#d6b06b'):C.Color.fromCssColorString('#d67878')
    colors.set(color.toBytes(),i*4)
  }
  for(let i=0;i<count;i++){uv[i*2]=(locations[i].lon-west)/(east-west);uv[i*2+1]=(locations[i].lat-south)/(north-south)}
  const geometry=new C.Geometry({attributes:Object.assign(new C.GeometryAttributes(),{
    position:new C.GeometryAttribute({componentDatatype:C.ComponentDatatype.DOUBLE,componentsPerAttribute:3,values:vertices}),
    normal:new C.GeometryAttribute({componentDatatype:C.ComponentDatatype.FLOAT,componentsPerAttribute:3,values:normals}),
    st:new C.GeometryAttribute({componentDatatype:C.ComponentDatatype.FLOAT,componentsPerAttribute:2,values:uv}),
    color:new C.GeometryAttribute({componentDatatype:C.ComponentDatatype.UNSIGNED_BYTE,componentsPerAttribute:4,normalize:true,values:colors}),
  }),indices,primitiveType:C.PrimitiveType.TRIANGLES,boundingSphere:C.BoundingSphere.fromVertices(vertices)})
  rt.bounds=geometry.boundingSphere ?? null
  rt.patchCentre=position(origin.longitude_deg,origin.latitude_deg,origin.elevation_m)
  rt.imageMaterial=C.Material.fromType('Image',{image:mapImageUrl([west,south,east,north])})
  const appearance=slope?new C.PerInstanceColorAppearance({flat:true,translucent:false,closed:false}):new C.MaterialAppearance({material:rt.imageMaterial,flat:true,faceForward:true,translucent:false})
  rt.patch=rt.viewer.scene.primitives.add(new C.Primitive({geometryInstances:new C.GeometryInstance({geometry}),appearance,asynchronous:false}))
  const valid=new Set(indices),wire=new C.PolylineCollection()
  for(let fixed=0;fixed<metadata.width;fixed+=4)for(const column of [false,true]){
    let segment:C.Cartesian3[]=[]
    const flush=()=>{if(segment.length>1)wire.add({positions:segment,width:1,material:C.Material.fromType('Color',{color:C.Color.fromCssColorString('#9bd8d0')})});segment=[]}
    for(let moving=0;moving<metadata.width;moving++){
      const i=column?moving*metadata.width+fixed:fixed*metadata.width+moving
      if(!valid.has(i)){flush();continue}
      segment.push(position(locations[i].lon,locations[i].lat,origin.elevation_m+dem.positions[i*3+1]*scale+.5))
    }
    flush()
  }
  rt.wire=rt.viewer.scene.primitives.add(wire)
}

/** Cesium viewer adapter. No procedural global heights or invented local terrain. */
export function CesiumLunarStage(props: Props) {
  const host=useRef<HTMLDivElement>(null), runtime=useRef<Runtime|null>(null), latest=useRef(props)
  latest.current=props
  const [ready,setReady]=useState(0),[error,setError]=useState(''),[message,setMessage]=useState('Loading LROC imagery…')
  const focusMatches=!!props.focusCoordinates && Math.abs(props.focusCoordinates.latitude_deg-canonical.coordinates.latitude_deg)<1e-7 && Math.abs(props.focusCoordinates.longitude_deg-canonical.coordinates.longitude_deg)<1e-7
  const verified=focusMatches&&isCanonicalTerrain(props.demTerrain?.metadata,canonical.coordinates)
  const matching=verified&&observerMatches(props.demTerrain?.metadata,props.analysisCoordinates,props.analysisObserverHeightM,props.observerHeightM,props.analysisDataKind)
  useEffect(()=>{
    if(!host.current)return
    let rt:Runtime|null=null,picker:C.ScreenSpaceEventHandler|undefined,alive=true,failed=false
    try{
      C.Ellipsoid.default=MOON
      const viewer=new C.Viewer(host.current,{ellipsoid:MOON,terrainProvider:new C.EllipsoidTerrainProvider({ellipsoid:MOON}),baseLayer:false,baseLayerPicker:false,geocoder:false,homeButton:false,sceneModePicker:false,timeline:false,animation:false,navigationHelpButton:false,fullscreenButton:false,selectionIndicator:false,infoBox:false,skyBox:false,skyAtmosphere:false,requestRenderMode:true})
      if(viewer.scene.sun)viewer.scene.sun.show=false
      if(viewer.scene.moon)viewer.scene.moon.show=false
      viewer.scene.globe.showGroundAtmosphere=false;viewer.scene.globe.enableLighting=false
      viewer.scene.backgroundColor=C.Color.fromCssColorString('#050507')
      const provider=new C.WebMapServiceImageryProvider({url:WMS_URL,layers:'luna_wac_global',parameters:{version:'1.1.1',srs:'IAU2000:30100',format:'image/jpeg',transparent:false},tilingScheme:new C.GeographicTilingScheme({ellipsoid:MOON}),maximumLevel:10,enablePickFeatures:false,credit:'NASA / GSFC / ASU · LROC WAC via Lunaserv'})
      viewer.imageryLayers.addImageryProvider(provider)
      rt={viewer,provider,patch:null,wire:null,imageMaterial:null,bounds:null,local:false,rays:[],target:null,catalog:[],patchCentre:null}
      runtime.current=rt
      latest.current.onNasaImageryStatusChange?.('loading')
      provider.errorEvent.addEventListener(()=>{if(!alive)return;failed=true;setMessage('LROC imagery unavailable. No synthetic image is substituted.');latest.current.onNasaImageryStatusChange?.('offline')})
      viewer.scene.globe.tileLoadProgressEvent.addEventListener(pending=>{
        if(!alive||failed)return
        if(pending===0){setMessage('LROC WAC imagery · Lunar sphere; relief only at the verified Site01 patch.');latest.current.onNasaImageryStatusChange?.('loaded')}
      })
      viewer.camera.setView({destination:position(0,-15,RADIUS*3)})
      for(const site of latest.current.catalogSites){
        rt.catalog.push(viewer.entities.add({id:`catalog:${site.id}`,position:position(site.longitude_deg,site.latitude_deg,0),point:{pixelSize:6,color:C.Color.fromCssColorString('#9adce5'),outlineColor:C.Color.BLACK,outlineWidth:1},properties:{catalogId:site.id}}))
      }
      for(const [name,color] of [['Sun',C.Color.GOLD],['Earth',C.Color.LIGHTSKYBLUE]] as const)rt.rays.push(viewer.entities.add({name,show:false,polyline:{positions:[],width:3,material:new C.PolylineArrowMaterialProperty(color)}}))
      picker=new C.ScreenSpaceEventHandler(viewer.scene.canvas)
      picker.setInputAction((event:{position:C.Cartesian2})=>{
        const selected=viewer.scene.pick(event.position)
        const id=selected?.id?.id
        const site=typeof id==='string'&&id.startsWith('catalog:')?latest.current.catalogSites.find(s=>`catalog:${s.id}`===id):null
        if(site){latest.current.onSelectCatalogSite(site);return}
        if(runtime.current?.local){setMessage('Terrain inspection is fixed to the canonical Site01 observer; selecting another point requires a new analysis.');return}
        const picked=viewer.camera.pickEllipsoid(event.position,MOON);if(!picked)return
        const cart=MOON.cartesianToCartographic(picked)
        latest.current.onPickPoint({latitude_deg:C.Math.toDegrees(cart.latitude),longitude_deg:C.Math.toDegrees(cart.longitude),elevation_m:0,slope_deg:null,matchedCatalogSite:null,label:'Coordinate inspection · elevation not sampled',horizonAnglesDeg:[]})
      },C.ScreenSpaceEventType.LEFT_CLICK)
      const renderError=()=>{if(alive)setError('The 3D viewer stopped rendering. Reload to retry; the dashboard analysis remains available.')}
      viewer.scene.renderError.addEventListener(renderError)
      setReady(v=>v+1)
    }catch(e){setError(e instanceof Error?e.message:'Cesium could not initialize')}
    return()=>{alive=false;picker?.destroy();if(rt&&!rt.viewer.isDestroyed())rt.viewer.destroy();runtime.current=null}
  },[])

  useEffect(()=>{
    const rt=runtime.current;if(!rt)return
    try{
      if(verified&&props.demTerrain)makePatch(rt,props.demTerrain,props.verticalScale,props.overlayMode==='slope')
      else discardPatch(rt)
    }catch(e){setError(e instanceof Error?e.message:'Terrain geometry could not load')}
  },[ready,props.demTerrain,verified,props.verticalScale,props.overlayMode])

  useEffect(()=>{
    const rt=runtime.current;if(!rt)return
    const local=props.desiredCameraMode==='SURFACE'&&verified&&!!rt.patchCentre
    rt.local=local;rt.viewer.scene.globe.show=!local
    if(rt.patch)rt.patch.show=local
    if(rt.wire)rt.wire.show=local&&props.showWireframe
    for(const marker of rt.catalog)marker.show=!local
    rt.viewer.camera.lookAtTransform(C.Matrix4.IDENTITY)
    if(local&&rt.patchCentre&&rt.bounds){
      const radius=rt.bounds.radius
      if(props.surfacePreset==='HORIZON'){
        const origin=position(canonical.coordinates.longitude_deg,canonical.coordinates.latitude_deg,canonical.coordinates.elevation_m+props.observerHeightM)
        rt.viewer.camera.lookAtTransform(C.Transforms.eastNorthUpToFixedFrame(origin,MOON),new C.HeadingPitchRange(0,C.Math.toRadians(-4),15))
      }else{
        rt.viewer.camera.lookAtTransform(C.Transforms.eastNorthUpToFixedFrame(rt.patchCentre,MOON),new C.HeadingPitchRange(0,-.65,radius*3.2))
      }
      props.onCameraModeChange('SURFACE')
    }else{
      const focus=props.focusCoordinates
      rt.viewer.camera.flyTo({destination:focus?position(focus.longitude_deg,focus.latitude_deg,props.hasSelection?200000:RADIUS*3):position(0,-15,RADIUS*3),orientation:{heading:0,pitch:-C.Math.PI_OVER_TWO,roll:0},duration:.8})
      props.onCameraModeChange('ORBITAL')
    }
    rt.viewer.scene.requestRender()
  // Camera callback identities can change as App state changes; only actual camera inputs reset the view.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[ready,verified,props.demTerrain,props.desiredCameraMode,props.surfacePreset,props.cameraPresetNonce,props.focusCoordinates,props.hasSelection,props.verticalScale,props.overlayMode])

  useEffect(()=>{
    const rt=runtime.current;if(!rt)return
    if(rt.wire)rt.wire.show=rt.local&&props.showWireframe
    const imagery=props.useNasaTrekImagery!==false
    if(rt.viewer.imageryLayers.length)rt.viewer.imageryLayers.get(0).show=imagery
    if(rt.patch&&props.overlayMode!=='slope'&&rt.imageMaterial){
      rt.patch.appearance.material=imagery?rt.imageMaterial:C.Material.fromType('Color',{color:C.Color.fromCssColorString('#344452')})
    }
    if(rt.target)rt.viewer.entities.remove(rt.target)
    rt.target=null
    if(props.focusCoordinates){
      const fixed=rt.local?canonical.coordinates:null
      const lat=fixed?.latitude_deg??props.focusCoordinates.latitude_deg,lon=fixed?.longitude_deg??props.focusCoordinates.longitude_deg
      rt.target=rt.viewer.entities.add({position:position(lon,lat,fixed?fixed.elevation_m+props.observerHeightM:0),point:{pixelSize:10,color:C.Color.AQUAMARINE,outlineColor:C.Color.BLACK,outlineWidth:2,disableDepthTestDistance:Number.POSITIVE_INFINITY}})
    }
    for(const ray of rt.rays)ray.show=false
    if(rt.local&&matching&&props.currentSample){
      const origin=position(canonical.coordinates.longitude_deg,canonical.coordinates.latitude_deg,canonical.coordinates.elevation_m+props.observerHeightM)
      const frame=C.Transforms.eastNorthUpToFixedFrame(origin,MOON)
      for(const [index,body] of ['sun','earth'].entries()){
        const sample=body==='sun'?props.currentSample.sun:props.currentSample.earth
        const [east,north,up]=directionEnu(sample.azimuth_deg,sample.elevation_deg)
        const direction=C.Matrix4.multiplyByPointAsVector(frame,new C.Cartesian3(east,north,up),new C.Cartesian3())
        const endpoint=C.Cartesian3.add(origin,C.Cartesian3.multiplyByScalar(direction,650,new C.Cartesian3()),new C.Cartesian3())
        if(rt.rays[index].polyline)rt.rays[index].polyline!.positions=new C.ConstantProperty([origin,endpoint])
        rt.rays[index].show=true
      }
    }
    rt.viewer.scene.requestRender()
  },[ready,matching,props.currentSample,props.showWireframe,props.useNasaTrekImagery,props.overlayMode,props.verticalScale,props.focusCoordinates,props.observerHeightM,props.desiredCameraMode,props.demTerrain])

  return <div className="absolute inset-0" aria-label="Cesium lunar imagery and verified terrain">
    <div ref={host} className="absolute inset-0"/>
    <div className="absolute bottom-7 left-3 z-10 max-w-[65vw] pointer-events-none text-[8px] sm:text-[9px] font-mono-tech text-slate-400 leading-relaxed" role="status">
      {error?`Viewer issue: ${error}`:props.desiredCameraMode==='SURFACE'&&!verified?'Verified local terrain unavailable at this selection. Showing imagery on the lunar reference sphere.':verified&&props.desiredCameraMode==='SURFACE'?`Site01 LOLA · ${props.verticalScale}× height · ${matching?'recorded Sun/Earth directions':'celestial overlays withheld: observer mismatch or preview data'}. Imagery lighting is baked, not calculated shadows.`:message}
    </div>
  </div>
}
