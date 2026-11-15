import { useEffect, useRef, useState } from 'react'
import * as C from 'cesium'
import 'cesium/Build/Cesium/Widgets/widgets.css'
import type {
  AnalysisSample,
  CatalogSiteEntry,
  ContractRecommendDocument,
  Coordinates,
  DecodedDemSiteTerrain,
  RoverPlaybackState,
  TraverseManualCandidate,
  TraverseResearchTargetOption,
  TraverseWaypoint,
} from '../../api/types'
import { sampleDemAtLatLon, sphericalDistanceAndBearing } from '../../api/client'
import { RADIUS, WMS_URL, offsetCoordinate, directionEnu, observerMatches, isCanonicalTerrain } from './lunar.mjs'
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
  traverseWaypoints?: TraverseWaypoint[]
  traverseCandidates?: TraverseManualCandidate[]
  traverseTarget?: { latitude_deg: number; longitude_deg: number; elevation_m?: number; label?: string; shortLabel?: string } | null
  researchTargets?: TraverseResearchTargetOption[]
  pickingTraverseTarget?: boolean
  activeRoverState?: RoverPlaybackState | null
  onSelectTraverseCandidate?: (candidate: TraverseManualCandidate) => void
  onPickTraverseTarget?: (coords: {
    latitude_deg: number
    longitude_deg: number
    elevation_m: number
    id?: string
    label?: string
    scienceTag?: string
    category?: TraverseResearchTargetOption['category']
  }) => void
  onCameraModeChange: (mode: 'ORBITAL' | 'SURFACE') => void
  onPickPoint: (pick: SurfacePickEvent) => void; onSelectCatalogSite: (site: CatalogSiteEntry) => void
  onNasaImageryStatusChange?: (status: 'loading' | 'loaded' | 'offline') => void
}
interface Runtime {
  viewer: C.Viewer; patch: C.Primitive | null; wire: C.PolylineCollection | null
  bounds: C.BoundingSphere | null; local: boolean
  rays: C.Entity[]; target: C.Entity | null; catalog: C.Entity[]; traverse: C.Entity[]; provider: C.WebMapServiceImageryProvider
  patchCentre: C.Cartesian3 | null
}
const MOON = new C.Ellipsoid(RADIUS, RADIUS, RADIUS)
function svgDataUri(svg: string) {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}
// Hexagonal Lunar Lander / Base Pod Beacon (#2dd4bf teal + #34d399 emerald apex)
const BASE_POD_ICON_URI = svgDataUri(
  '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">' +
    '<polygon points="16,2 28,9 28,23 16,30 4,23 4,9" fill="#061318" fill-opacity="0.92" stroke="#2dd4bf" stroke-width="2"/>' +
    '<rect x="11" y="11" width="10" height="7" rx="1.5" fill="none" stroke="#6ee7b7" stroke-width="1.5"/>' +
    '<line x1="12" y1="18" x2="9" y2="23" stroke="#2dd4bf" stroke-width="1.6" stroke-linecap="round"/>' +
    '<line x1="20" y1="18" x2="23" y2="23" stroke="#2dd4bf" stroke-width="1.6" stroke-linecap="round"/>' +
    '<line x1="16" y1="6" x2="16" y2="11" stroke="#34d399" stroke-width="1.5"/>' +
    '<circle cx="16" cy="6" r="2.2" fill="#34d399"/>' +
  '</svg>',
)
// Diamond Lock-On Research Target Reticle (#f472b6 magenta + #38bdf8 corner brackets)
const TARGET_RETICLE_ICON_URI = svgDataUri(
  '<svg xmlns="http://www.w3.org/2000/svg" width="34" height="34" viewBox="0 0 34 34">' +
    '<path d="M5,10 V5 H10 M24,5 H29 V10 M5,24 V29 H10 M24,29 H29 V24" fill="none" stroke="#38bdf8" stroke-width="1.8" stroke-linecap="round"/>' +
    '<polygon points="17,4 30,17 17,30 4,17" fill="#1a0918" fill-opacity="0.88" stroke="#f472b6" stroke-width="2"/>' +
    '<line x1="17" y1="9" x2="17" y2="25" stroke="#f9a8d4" stroke-width="1.3"/>' +
    '<line x1="9" y1="17" x2="25" y2="17" stroke="#f9a8d4" stroke-width="1.3"/>' +
    '<circle cx="17" cy="17" r="2.6" fill="#f472b6"/>' +
  '</svg>',
)
// Unselected Water-Ice PSR Crater hollow diamond marker
const ICE_CRATER_MARKER_URI = svgDataUri(
  '<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 22 22">' +
    '<polygon points="11,3 19,11 11,19 3,11" fill="#061318" fill-opacity="0.72" stroke="#38bdf8" stroke-width="1.8"/>' +
    '<circle cx="11" cy="11" r="2" fill="#38bdf8"/>' +
  '</svg>',
)
// Unselected Mapped Polar Rim hollow diamond marker
const MAPPED_RIM_MARKER_URI = svgDataUri(
  '<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 22 22">' +
    '<polygon points="11,3 19,11 11,19 3,11" fill="#141006" fill-opacity="0.72" stroke="#fbbf24" stroke-width="1.8"/>' +
    '<circle cx="11" cy="11" r="2" fill="#fbbf24"/>' +
  '</svg>',
)
// Active Lunar Rover with solar wings & cyan beacon
const ROVER_ICON_URI = svgDataUri(
  '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">' +
    '<rect x="2" y="12" width="7" height="8" rx="1" fill="#0f172a" stroke="#fbbf24" stroke-width="1.5"/>' +
    '<rect x="23" y="12" width="7" height="8" rx="1" fill="#0f172a" stroke="#fbbf24" stroke-width="1.5"/>' +
    '<rect x="10" y="9" width="12" height="14" rx="2.5" fill="#082f49" stroke="#22d3ee" stroke-width="2"/>' +
    '<line x1="16" y1="4" x2="16" y2="9" stroke="#38bdf8" stroke-width="1.8"/>' +
    '<circle cx="16" cy="4" r="2.2" fill="#22d3ee"/>' +
    '<circle cx="12" cy="24" r="2" fill="#e2e8f0"/>' +
    '<circle cx="20" cy="24" r="2" fill="#e2e8f0"/>' +
  '</svg>',
)
function position(lon: number, lat: number, height=0) { return C.Cartesian3.fromDegrees(lon,lat,height,MOON) }
function terrainPosition(
  lat: number,
  lon: number,
  elevM: number,
  demOrigin: Coordinates | null,
  verticalScale: number,
  elevOffsetM: number,
) {
  const height = demOrigin
    ? demOrigin.elevation_m + (elevM - demOrigin.elevation_m) * verticalScale + elevOffsetM
    : elevOffsetM
  return position(lon, lat, height)
}
function getEffectiveVerticalScale(dem: DecodedDemSiteTerrain | null, userScale: number): number {
  if (!dem) return userScale
  const span = Math.max(80, dem.maxRelY - dem.minRelY)
  const boost = Math.max(1.35, Math.min(2.8, 650 / span))
  return userScale * boost
}

function discardPatch(rt: Runtime) {
  if (rt.patch) rt.viewer.scene.primitives.remove(rt.patch)
  if (rt.wire) rt.viewer.scene.primitives.remove(rt.wire)
  rt.patch=null;rt.wire=null;rt.bounds=null;rt.patchCentre=null
}

function makePatch(rt: Runtime, dem: DecodedDemSiteTerrain, scale: number, slope: boolean) {
  discardPatch(rt)
  const { metadata, indices } = dem
  const origin = metadata.coordinates
  const { width, height, spacing_m: spacing } = metadata
  const coreCount = width * height
  const coreValid = new Uint8Array(coreCount)
  for (let i = 0; i < indices.length; i++) {
    const idx = indices[i]
    if (idx < coreCount) coreValid[idx] = 1
  }

  let sumRelY = 0
  let validCoreCount = 0
  for (let i = 0; i < coreCount; i++) {
    if (!coreValid[i]) continue
    sumRelY += dem.positions[i * 3 + 1]
    validCoreCount++
  }
  const meanRelY = validCoreCount > 0 ? sumRelY / validCoreCount : 0
  const elevSpan = Math.max(1.0, dem.maxRelY - dem.minRelY)
  const contourStep = Math.max(10, Math.round(elevSpan / 10))

  const SKIRT_RINGS = 14
  const extW = width + 2 * SKIRT_RINGS
  const extH = height + 2 * SKIRT_RINGS
  const totalCount = extW * extH

  const eastArr = new Float64Array(totalCount)
  const northArr = new Float64Array(totalCount)
  const relYArr = new Float64Array(totalCount)
  const inCoreArr = new Uint8Array(totalCount)
  const validMask = new Uint8Array(totalCount)
  const skirtRadialArr = new Float32Array(totalCount)
  const coreClampedIdx = new Uint32Array(totalCount)
  const locations: { lat: number; lon: number }[] = new Array(totalCount)

  const extVertices = new Float64Array(totalCount * 3)
  const coreVertices = new Float64Array(coreCount * 3)
  const normals = new Float32Array(totalCount * 3)
  const colors = new Uint8Array(totalCount * 4)

  const skirtOffset = (k: number) => 70 * k + 18 * k * k
  let corePtr = 0

  for (let erow = 0; erow < extH; erow++) {
    const crow = erow - SKIRT_RINGS
    const clampedR = Math.max(0, Math.min(height - 1, crow))
    const drOut = crow < 0 ? -crow : crow >= height ? crow - (height - 1) : 0
    const northSign = crow < 0 ? 1 : crow >= height ? -1 : 0
    for (let ecol = 0; ecol < extW; ecol++) {
      const eIdx = erow * extW + ecol
      const ccol = ecol - SKIRT_RINGS
      const clampedC = Math.max(0, Math.min(width - 1, ccol))
      const dcOut = ccol < 0 ? -ccol : ccol >= width ? ccol - (width - 1) : 0
      const eastSign = ccol < 0 ? -1 : ccol >= width ? 1 : 0

      const cIdx = clampedR * width + clampedC
      coreClampedIdx[eIdx] = cIdx
      const inCore = crow >= 0 && crow < height && ccol >= 0 && ccol < width
      inCoreArr[eIdx] = inCore ? 1 : 0
      validMask[eIdx] = coreValid[cIdx]

      let eastM: number
      let northM: number
      let relY: number
      let skirtRadial = 0

      if (inCore) {
        eastM = dem.positions[cIdx * 3]
        northM = -dem.positions[cIdx * 3 + 2]
        relY = dem.positions[cIdx * 3 + 1]
      } else {
        const edgeEast = (clampedC - (width - 1) / 2) * spacing
        const edgeNorth = -((clampedR - (height - 1) / 2) * spacing)
        eastM = edgeEast + (dcOut > 0 ? eastSign * skirtOffset(dcOut) : 0)
        northM = edgeNorth + (drOut > 0 ? northSign * skirtOffset(drOut) : 0)

        const edgeRelY = dem.positions[cIdx * 3 + 1]
        skirtRadial = Math.min(1, Math.hypot(dcOut, drOut) / SKIRT_RINGS)
        const sT = skirtRadial * skirtRadial * (3 - 2 * skirtRadial)
        const macroWave =
          Math.sin(eastM * 0.0014 + northM * 0.0009) * 0.5 +
          Math.cos(eastM * 0.0007 - northM * 0.0016) * 0.5
        const mesoCrater =
          Math.sin(eastM * 0.0038) * Math.cos(northM * 0.0034) * 0.5 +
          Math.sin((eastM - northM) * 0.0029) * 0.35
        const targetSkirtRelY =
          meanRelY * 0.55 + elevSpan * 0.16 * macroWave + elevSpan * 0.09 * mesoCrater
        relY = edgeRelY * (1 - sT) + targetSkirtRelY * sT
      }

      eastArr[eIdx] = eastM
      northArr[eIdx] = northM
      relYArr[eIdx] = relY
      skirtRadialArr[eIdx] = skirtRadial

      const loc = offsetCoordinate(origin.latitude_deg, origin.longitude_deg, eastM, northM)
      locations[eIdx] = loc
      const p = position(loc.lon, loc.lat, origin.elevation_m + relY * scale)
      extVertices.set([p.x, p.y, p.z], eIdx * 3)
      if (inCore) {
        coreVertices.set([p.x, p.y, p.z], corePtr * 3)
        corePtr++
      }
      const normal = MOON.geodeticSurfaceNormal(p, new C.Cartesian3())
      normals.set([normal.x, normal.y, normal.z], eIdx * 3)
    }
  }

  // Primary NW low-angle polar Sun + secondary ESE earthshine fill
  const sunAz = (315 * Math.PI) / 180
  const sunAlt = (26 * Math.PI) / 180
  const sunLx = Math.sin(sunAz) * Math.cos(sunAlt)
  const sunLy = Math.cos(sunAz) * Math.cos(sunAlt)
  const sunLz = Math.sin(sunAlt)

  const fillAz = (115 * Math.PI) / 180
  const fillAlt = (18 * Math.PI) / 180
  const fillLx = Math.sin(fillAz) * Math.cos(fillAlt)
  const fillLy = Math.cos(fillAz) * Math.cos(fillAlt)
  const fillLz = Math.sin(fillAlt)

  const normalReliefMult = Math.max(2.6, scale * 1.45)

  for (let erow = 0; erow < extH; erow++) {
    const rN = Math.max(0, erow - 1)
    const rS = Math.min(extH - 1, erow + 1)
    for (let ecol = 0; ecol < extW; ecol++) {
      const eIdx = erow * extW + ecol
      const cW = Math.max(0, ecol - 1)
      const cE = Math.min(extW - 1, ecol + 1)

      const idxW = erow * extW + cW
      const idxE = erow * extW + cE
      const idxN = rN * extW + ecol
      const idxS = rS * extW + ecol

      const dx = Math.max(1, eastArr[idxE] - eastArr[idxW])
      const dy = Math.max(1, northArr[idxN] - northArr[idxS])
      const dzDx = validMask[idxW] && validMask[idxE] ? ((relYArr[idxE] - relYArr[idxW]) * normalReliefMult) / dx : 0
      const dzDn = validMask[idxN] && validMask[idxS] ? ((relYArr[idxN] - relYArr[idxS]) * normalReliefMult) / dy : 0

      const invLen = 1 / Math.hypot(-dzDx, -dzDn, 1)
      const nx = -dzDx * invLen
      const ny = -dzDn * invLen
      const nz = invLen

      const sunDot = Math.max(0, nx * sunLx + ny * sunLy + nz * sunLz)
      const fillDot = Math.max(0, nx * fillLx + ny * fillLy + nz * fillLz)
      const shade = Math.max(0.32, Math.min(1.18, 0.32 + 0.72 * sunDot + 0.14 * fillDot))

      const inCore = inCoreArr[eIdx] === 1
      const cIdx = coreClampedIdx[eIdx]
      const relY = relYArr[eIdx]
      const eastM = eastArr[eIdx]
      const northM = northArr[eIdx]

      const hRaw = Math.sin(eastM * 0.173 + northM * 0.291) * 43758.5453
      const grain = (hRaw - Math.floor(hRaw) - 0.5) * 14

      let r: number
      let g: number
      let b: number

      if (slope) {
        if (inCore) {
          const angle = dem.slopeDegPerVertex[cIdx]
          const slopeShade = Math.max(0.52, Math.min(1.08, 0.54 + 0.54 * sunDot))
          if (!Number.isFinite(angle)) {
            r = 100; g = 116; b = 139
          } else if (angle < 8) {
            r = 62; g = 170; b = 137
          } else if (angle <= 15) {
            r = 214; g = 176; b = 107
          } else {
            r = 214; g = 120; b = 120
          }
          r = r * slopeShade + grain * 0.45
          g = g * slopeShade + grain * 0.45
          b = b * slopeShade + grain * 0.45
        } else {
          r = 54 * shade + grain * 0.4
          g = 62 * shade + grain * 0.4
          b = 74 * shade + grain * 0.4
        }
      } else {
        const relNorm = Math.max(0, Math.min(1, (relY - dem.minRelY) / elevSpan))
        if (relNorm < 0.45) {
          const t = relNorm / 0.45
          r = 42 + t * (92 - 42)
          g = 47 + t * (99 - 47)
          b = 56 + t * (110 - 56)
        } else {
          const t = (relNorm - 0.45) / 0.55
          r = 92 + t * (162 - 92)
          g = 99 + t * (168 - 99)
          b = 110 + t * (178 - 110)
        }
        const contourMod = inCore
          ? (((relY - dem.minRelY) % contourStep) + contourStep) % contourStep < contourStep * 0.075
            ? 0.85
            : 1.0
          : 1.0
        r = r * shade * contourMod + grain
        g = g * shade * contourMod + grain
        b = b * shade * contourMod + grain
      }

      if (!inCore) {
        const sr = skirtRadialArr[eIdx]
        if (sr > 0.35) {
          const t = (sr - 0.35) / 0.65
          const fade = 1 - t * t * (3 - 2 * t)
          r = 5 + (r - 5) * fade
          g = 5 + (g - 5) * fade
          b = 7 + (b - 7) * fade
        }
      }

      const minCoreChannel = inCore ? 22 : 5
      colors[eIdx * 4] = Math.max(minCoreChannel, Math.min(242, Math.round(r)))
      colors[eIdx * 4 + 1] = Math.max(minCoreChannel, Math.min(242, Math.round(g)))
      colors[eIdx * 4 + 2] = Math.max(inCore ? 26 : 7, Math.min(245, Math.round(b)))
      colors[eIdx * 4 + 3] = 255
    }
  }

  const extIndicesList: number[] = []
  for (let erow = 0; erow < extH - 1; erow++) {
    for (let ecol = 0; ecol < extW - 1; ecol++) {
      const a = erow * extW + ecol
      const b = a + 1
      const c = a + extW
      const d = c + 1
      if (validMask[a] && validMask[c] && validMask[b]) extIndicesList.push(a, c, b)
      if (validMask[b] && validMask[c] && validMask[d]) extIndicesList.push(b, c, d)
    }
  }

  const geometry = new C.Geometry({
    attributes: Object.assign(new C.GeometryAttributes(), {
      position: new C.GeometryAttribute({
        componentDatatype: C.ComponentDatatype.DOUBLE,
        componentsPerAttribute: 3,
        values: extVertices,
      }),
      normal: new C.GeometryAttribute({
        componentDatatype: C.ComponentDatatype.FLOAT,
        componentsPerAttribute: 3,
        values: normals,
      }),
      color: new C.GeometryAttribute({
        componentDatatype: C.ComponentDatatype.UNSIGNED_BYTE,
        componentsPerAttribute: 4,
        normalize: true,
        values: colors,
      }),
    }),
    indices: new Uint32Array(extIndicesList),
    primitiveType: C.PrimitiveType.TRIANGLES,
    boundingSphere: C.BoundingSphere.fromVertices(extVertices),
  })

  rt.bounds = C.BoundingSphere.fromVertices(coreVertices) ?? geometry.boundingSphere ?? null
  rt.patchCentre = position(origin.longitude_deg, origin.latitude_deg, origin.elevation_m)
  rt.patch = rt.viewer.scene.primitives.add(
    new C.Primitive({
      geometryInstances: new C.GeometryInstance({ geometry }),
      appearance: new C.PerInstanceColorAppearance({ flat: true, translucent: false, closed: false }),
      asynchronous: false,
    }),
  )

  const wire = new C.PolylineCollection()
  for (let fixed = 0; fixed < width; fixed += 4) {
    for (const column of [false, true]) {
      let segment: C.Cartesian3[] = []
      const flush = () => {
        if (segment.length > 1) {
          wire.add({
            positions: segment,
            width: 1,
            material: C.Material.fromType('Color', {
              color: C.Color.fromCssColorString('#5eead4').withAlpha(0.14),
            }),
          })
        }
        segment = []
      }
      for (let moving = 0; moving < width; moving++) {
        const crow = column ? moving : fixed
        const ccol = column ? fixed : moving
        const cIdx = crow * width + ccol
        if (!coreValid[cIdx]) {
          flush()
          continue
        }
        const eIdx = (crow + SKIRT_RINGS) * extW + (ccol + SKIRT_RINGS)
        segment.push(
          position(
            locations[eIdx].lon,
            locations[eIdx].lat,
            origin.elevation_m + dem.positions[cIdx * 3 + 1] * scale + 0.8,
          ),
        )
      }
      flush()
    }
  }
  rt.wire = rt.viewer.scene.primitives.add(wire)
}

/** Cesium viewer adapter. No procedural global heights or invented local terrain. */
export function CesiumLunarStage(props: Props) {
  const host=useRef<HTMLDivElement>(null), runtime=useRef<Runtime|null>(null), latest=useRef(props)
  latest.current=props
  const [ready,setReady]=useState(0),[error,setError]=useState(''),[message,setMessage]=useState('Loading LROC imagery…')
  const focusMatches=!!props.focusCoordinates && Math.abs(props.focusCoordinates.latitude_deg-canonical.coordinates.latitude_deg)<1e-7 && Math.abs(props.focusCoordinates.longitude_deg-canonical.coordinates.longitude_deg)<1e-7
  const verified=focusMatches&&isCanonicalTerrain(props.demTerrain?.metadata,canonical.coordinates)
  const hasDemPatch=!!props.focusCoordinates&&!!props.demTerrain&&props.demTerrain.metadata.provenance?.data_kind==='cached_real'&&sampleDemAtLatLon(props.demTerrain,props.focusCoordinates.latitude_deg,props.focusCoordinates.longitude_deg).insidePatch
  const matching=verified&&observerMatches(props.demTerrain?.metadata,props.analysisCoordinates,props.analysisObserverHeightM,props.observerHeightM,props.analysisDataKind)
  const effectiveScale=getEffectiveVerticalScale(props.demTerrain,props.verticalScale)
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
      rt={viewer,provider,patch:null,wire:null,bounds:null,local:false,rays:[],target:null,catalog:[],traverse:[],patchCentre:null}
      runtime.current=rt
      latest.current.onNasaImageryStatusChange?.('loading')
      provider.errorEvent.addEventListener(()=>{if(!alive)return;failed=true;setMessage('LROC imagery unavailable. No synthetic image is substituted.');latest.current.onNasaImageryStatusChange?.('offline')})
      viewer.scene.globe.tileLoadProgressEvent.addEventListener(pending=>{
        if(!alive||failed)return
        if(pending===0){setMessage('LROC WAC imagery · Lunar sphere; relief available on LOLA catalog patches.');latest.current.onNasaImageryStatusChange?.('loaded')}
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
        if(typeof id==='string'&&id.startsWith('traverse-cand:')){
          const candId=id.slice('traverse-cand:'.length)
          const cand=latest.current.traverseCandidates?.find(c=>c.candidate_id===candId)
          if(cand){latest.current.onSelectTraverseCandidate?.(cand);return}
        }
        if(typeof id==='string'&&id.startsWith('research-target:')){
          const tgtId=id.slice('research-target:'.length)
          const foundTgt=latest.current.researchTargets?.find(t=>t.id===tgtId)
          if(foundTgt){
            latest.current.onPickTraverseTarget?.({
              latitude_deg:foundTgt.latitude_deg,
              longitude_deg:foundTgt.longitude_deg,
              elevation_m:foundTgt.elevation_m,
              id:foundTgt.id,
              label:foundTgt.label,
              scienceTag:foundTgt.scienceTag,
              category:foundTgt.category,
            })
            return
          }
        }
        const site=typeof id==='string'&&id.startsWith('catalog:')?latest.current.catalogSites.find(s=>`catalog:${s.id}`===id):null
        if(site){
          if(latest.current.pickingTraverseTarget){
            latest.current.onPickTraverseTarget?.({
              latitude_deg:site.latitude_deg,
              longitude_deg:site.longitude_deg,
              elevation_m:site.elevation_m,
              id:site.id,
              label:site.name,
              scienceTag:site.tag,
              category:'mapped_site_rim',
            })
            return
          }
          latest.current.onSelectCatalogSite(site)
          return
        }
        if(latest.current.pickingTraverseTarget){
          let picked: C.Cartesian3 | undefined
          if(viewer.scene.pickPositionSupported){
            const candidatePick=viewer.scene.pickPosition(event.position)
            if(candidatePick&&Number.isFinite(candidatePick.x)&&Math.abs(C.Cartesian3.magnitude(candidatePick)-RADIUS)<50000){
              picked=candidatePick
            }
          }
          if(!picked) picked=viewer.camera.pickEllipsoid(event.position,MOON)
          if(!picked) return
          const cart=MOON.cartesianToCartographic(picked)
          const lat=C.Math.toDegrees(cart.latitude),lon=C.Math.toDegrees(cart.longitude)
          const sampled=sampleDemAtLatLon(latest.current.demTerrain,lat,lon)
          latest.current.onPickTraverseTarget?.({latitude_deg:lat,longitude_deg:lon,elevation_m:sampled.insidePatch?sampled.elevationM:cart.height})
          return
        }
        let picked:C.Cartesian3|undefined
        if(runtime.current?.local&&viewer.scene.pickPositionSupported){picked=viewer.scene.pickPosition(event.position)}
        if(!picked) picked=viewer.camera.pickEllipsoid(event.position,MOON)
        if(!picked) return
        const cart=MOON.cartesianToCartographic(picked)
        const lat=C.Math.toDegrees(cart.latitude),lon=C.Math.toDegrees(cart.longitude)
        const sampled=sampleDemAtLatLon(latest.current.demTerrain,lat,lon)
        latest.current.onPickPoint({
          latitude_deg:lat,
          longitude_deg:lon,
          elevation_m:Number(sampled.elevationM.toFixed(1)),
          slope_deg:Number(sampled.slopeDeg.toFixed(1)),
          matchedCatalogSite:null,
          label:sampled.insidePatch?'Local LOLA DEM Surface Point':'South Polar Coordinate',
          horizonAnglesDeg:[],
        })
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
      if(hasDemPatch&&props.demTerrain)makePatch(rt,props.demTerrain,effectiveScale,props.overlayMode==='slope')
      else discardPatch(rt)
      rt.viewer.scene.requestRender()
    }catch(e){setError(e instanceof Error?e.message:'Terrain geometry could not load')}
  },[ready,props.demTerrain,hasDemPatch,effectiveScale,props.overlayMode])

  useEffect(()=>{
    const rt=runtime.current;if(!rt)return
    const local=props.desiredCameraMode==='SURFACE'&&hasDemPatch&&!!rt.patchCentre
    rt.local=local;rt.viewer.scene.globe.show=!local
    if(rt.patch)rt.patch.show=local
    if(rt.wire)rt.wire.show=local
    for(const marker of rt.catalog)marker.show=!local
    rt.viewer.camera.cancelFlight()
    rt.viewer.camera.lookAtTransform(C.Matrix4.IDENTITY)
    const demOrigin=props.demTerrain?.metadata.coordinates??canonical.coordinates
    if(local&&rt.patchCentre&&rt.bounds){
      const coreRadius=rt.bounds.radius
      const scale=getEffectiveVerticalScale(props.demTerrain,props.verticalScale)
      if(props.surfacePreset==='HORIZON'){
        const focusLat=props.focusCoordinates?.latitude_deg??demOrigin.latitude_deg
        const focusLon=props.focusCoordinates?.longitude_deg??demOrigin.longitude_deg
        const centerElev=props.demTerrain?sampleDemAtLatLon(props.demTerrain,focusLat,focusLon).elevationM:demOrigin.elevation_m
        const eyeOffset=offsetCoordinate(focusLat,focusLon,-240*Math.sin(C.Math.toRadians(28)),-240*Math.cos(C.Math.toRadians(28)))
        const backElev=props.demTerrain?sampleDemAtLatLon(props.demTerrain,eyeOffset.lat,eyeOffset.lon).elevationM:centerElev
        const safeBaseElev=Math.max(centerElev,backElev-28)
        const horizonOrigin=terrainPosition(focusLat,focusLon,safeBaseElev,demOrigin,scale,props.observerHeightM+22)
        rt.viewer.camera.flyToBoundingSphere(new C.BoundingSphere(horizonOrigin,60),{
          offset:new C.HeadingPitchRange(C.Math.toRadians(28),C.Math.toRadians(-12),240),
          duration:0.9,
          endTransform:C.Transforms.eastNorthUpToFixedFrame(horizonOrigin,MOON),
          complete:()=>{if(!rt.viewer.isDestroyed())rt.viewer.scene.requestRender()},
        })
      }else{
        const targetCenter=rt.bounds.center
        const maxScaled=props.demTerrain?props.demTerrain.maxRelY*scale:0
        const minScaled=props.demTerrain?props.demTerrain.minRelY*scale:0
        const midScaled=(maxScaled+minScaled)*0.5
        const obliqueRange=Math.max(coreRadius*1.12,(maxScaled-midScaled+320)/Math.sin(C.Math.toRadians(27)))
        rt.viewer.camera.flyToBoundingSphere(new C.BoundingSphere(targetCenter,coreRadius),{
          offset:new C.HeadingPitchRange(C.Math.toRadians(28),C.Math.toRadians(-27),obliqueRange),
          duration:1.05,
          endTransform:C.Transforms.eastNorthUpToFixedFrame(rt.patchCentre,MOON),
          complete:()=>{if(!rt.viewer.isDestroyed())rt.viewer.scene.requestRender()},
        })
      }
      props.onCameraModeChange('SURFACE')
    }else{
      const focus=props.focusCoordinates
      rt.viewer.camera.flyTo({destination:focus?position(focus.longitude_deg,focus.latitude_deg,props.hasSelection?200000:RADIUS*3):position(0,-15,RADIUS*3),orientation:{heading:0,pitch:-C.Math.PI_OVER_TWO,roll:0},duration:.8})
      props.onCameraModeChange('ORBITAL')
    }
    rt.viewer.scene.requestRender()
  // Camera callback identities and verticalScale/overlayMode updates should not re-trigger flight;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[ready,hasDemPatch,props.demTerrain,props.desiredCameraMode,props.surfacePreset,props.cameraPresetNonce,props.focusCoordinates,props.hasSelection])

  useEffect(()=>{
    const rt=runtime.current;if(!rt)return
    if(rt.wire){
      rt.wire.show=rt.local
      const wireAlpha=props.showWireframe?0.72:0.14
      for(let i=0;i<rt.wire.length;i++){
        rt.wire.get(i).material.uniforms.color.alpha=wireAlpha
      }
    }
    const imagery=props.useNasaTrekImagery!==false
    if(rt.viewer.imageryLayers.length)rt.viewer.imageryLayers.get(0).show=imagery
    if(rt.target)rt.viewer.entities.remove(rt.target)
    rt.target=null
    if(props.focusCoordinates){
      const demOrigin=rt.local&&props.demTerrain?props.demTerrain.metadata.coordinates:null
      const lat=props.focusCoordinates.latitude_deg,lon=props.focusCoordinates.longitude_deg
      const baseElev=demOrigin?sampleDemAtLatLon(props.demTerrain,lat,lon).elevationM:0
      const roverDistM=props.activeRoverState
        ?sphericalDistanceAndBearing(lat,lon,props.activeRoverState.latitudeDeg,props.activeRoverState.longitudeDeg).distanceM
        :Number.POSITIVE_INFINITY
      const samePointAsRover=roverDistM<=(rt.local?180:6000)
      rt.target=rt.viewer.entities.add({
        position:terrainPosition(lat,lon,baseElev,demOrigin,rt.local?effectiveScale:1,rt.local?props.observerHeightM:140),
        billboard:{image:BASE_POD_ICON_URI,width:28,height:28,disableDepthTestDistance:Number.POSITIVE_INFINITY},
        label:{
          text:'BASE POD',
          font:'600 9px "JetBrains Mono", monospace',
          fillColor:C.Color.fromCssColorString('#6ee7b7'),
          outlineColor:C.Color.BLACK,
          outlineWidth:3,
          style:C.LabelStyle.FILL_AND_OUTLINE,
          pixelOffset:new C.Cartesian2(0,samePointAsRover?22:-20),
          disableDepthTestDistance:Number.POSITIVE_INFINITY,
        },
      })
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
  },[ready,matching,props.currentSample,props.showWireframe,props.useNasaTrekImagery,props.overlayMode,effectiveScale,props.focusCoordinates,props.observerHeightM,props.desiredCameraMode,props.demTerrain,props.activeRoverState])

  useEffect(()=>{
    const rt=runtime.current;if(!rt)return
    for(const entity of rt.traverse)rt.viewer.entities.remove(entity)
    rt.traverse=[]
    const demOrigin=rt.local&&props.demTerrain?props.demTerrain.metadata.coordinates:null
    const scale=rt.local?effectiveScale:1
    const pathOffset=rt.local?8:120
    const wpOffset=rt.local?10:140
    const tgtOffset=rt.local?18:150

    if(!rt.local&&props.researchTargets?.length){
      const catalogIds=new Set(props.catalogSites.map(s=>s.id))
      for(const tgt of props.researchTargets){
        if((tgt.category!=='water_ice_crater'&&tgt.category!=='mapped_site_rim')||catalogIds.has(tgt.id)||tgt.id.startsWith('local_')) continue
        const isActive=props.traverseTarget&&Math.abs(props.traverseTarget.latitude_deg-tgt.latitude_deg)<1e-4&&Math.abs(props.traverseTarget.longitude_deg-tgt.longitude_deg)<1e-4
        if(isActive) continue
        rt.traverse.push(rt.viewer.entities.add({
          id:`research-target:${tgt.id}`,
          position:position(tgt.longitude_deg,tgt.latitude_deg,130),
          billboard:{
            image:tgt.category==='water_ice_crater'?ICE_CRATER_MARKER_URI:MAPPED_RIM_MARKER_URI,
            width:20,
            height:20,
            disableDepthTestDistance:Number.POSITIVE_INFINITY,
          },
        }))
      }
    }

    if(props.traverseTarget){
      const tgt=props.traverseTarget
      const tgtElev=tgt.elevation_m??sampleDemAtLatLon(props.demTerrain,tgt.latitude_deg,tgt.longitude_deg).elevationM
      rt.traverse.push(rt.viewer.entities.add({
        id:'traverse-target',
        position:terrainPosition(tgt.latitude_deg,tgt.longitude_deg,tgtElev,demOrigin,scale,tgtOffset),
        billboard:{image:TARGET_RETICLE_ICON_URI,width:30,height:30,disableDepthTestDistance:Number.POSITIVE_INFINITY},
        label:{
          text:tgt.shortLabel??tgt.label??'RESEARCH TARGET',
          font:'600 9px "JetBrains Mono", monospace',
          fillColor:C.Color.fromCssColorString('#f9a8d4'),
          outlineColor:C.Color.BLACK,
          outlineWidth:3,
          style:C.LabelStyle.FILL_AND_OUTLINE,
          pixelOffset:new C.Cartesian2(0,-22),
          disableDepthTestDistance:Number.POSITIVE_INFINITY,
        },
      }))
    }

    const waypoints=props.traverseWaypoints??[]
    if(waypoints.length>=1){
      if(waypoints.length>=2){
        const pathPositions=waypoints.map(wp=>terrainPosition(wp.coordinates.latitude_deg,wp.coordinates.longitude_deg,wp.coordinates.elevation_m,demOrigin,scale,pathOffset))
        rt.traverse.push(rt.viewer.entities.add({
          id:'traverse-path',
          polyline:{positions:pathPositions,width:3.5,material:C.Color.fromCssColorString('#22d3ee')},
        }))
      }
      for(const wp of waypoints){
        if(wp.waypoint_index===0||wp.action==='ARRIVE_RESEARCH_TARGET') continue
        const isRegenStop=(wp.regen_dwell_hours??0)>0
        rt.traverse.push(rt.viewer.entities.add({
          id:`traverse-wp:${wp.waypoint_index}`,
          position:terrainPosition(wp.coordinates.latitude_deg,wp.coordinates.longitude_deg,wp.coordinates.elevation_m,demOrigin,scale,wpOffset),
          point:{
            pixelSize:isRegenStop?9.5:7,
            color:isRegenStop?C.Color.fromCssColorString('#f59e0b'):wp.los_to_base?C.Color.fromCssColorString('#34d399'):C.Color.fromCssColorString('#fbbf24'),
            outlineColor:isRegenStop?C.Color.fromCssColorString('#fde68a'):C.Color.BLACK,
            outlineWidth:isRegenStop?2:1.5,
            disableDepthTestDistance:Number.POSITIVE_INFINITY,
          },
        }))
      }
    }

    if(props.activeRoverState){
      const rover=props.activeRoverState
      rt.traverse.push(rt.viewer.entities.add({
        id:'active-rover',
        position:terrainPosition(rover.latitudeDeg,rover.longitudeDeg,rover.elevationM,demOrigin,scale,wpOffset+4),
        billboard:{image:ROVER_ICON_URI,width:28,height:28,disableDepthTestDistance:Number.POSITIVE_INFINITY},
        label:{
          text:`ROVER · T+${rover.metHours.toFixed(1)}h${rover.isRegenerating?' ⚡ REGEN':''}`,
          font:'600 9px "JetBrains Mono", monospace',
          fillColor:rover.isRegenerating?C.Color.fromCssColorString('#fde047'):C.Color.fromCssColorString('#22d3ee'),
          outlineColor:C.Color.BLACK,
          outlineWidth:3,
          style:C.LabelStyle.FILL_AND_OUTLINE,
          pixelOffset:new C.Cartesian2(0,-22),
          disableDepthTestDistance:Number.POSITIVE_INFINITY,
        },
      }))
    }

    const candidates=props.traverseCandidates??[]
    if(candidates.length>0){
      const originWp=waypoints.length>0?waypoints[waypoints.length-1]:null
      const originPos=originWp
        ?terrainPosition(originWp.coordinates.latitude_deg,originWp.coordinates.longitude_deg,originWp.coordinates.elevation_m,demOrigin,scale,pathOffset)
        :props.focusCoordinates
          ?terrainPosition(props.focusCoordinates.latitude_deg,props.focusCoordinates.longitude_deg,sampleDemAtLatLon(props.demTerrain,props.focusCoordinates.latitude_deg,props.focusCoordinates.longitude_deg).elevationM,demOrigin,scale,pathOffset)
          :null
      for(const cand of candidates){
        const colorCss=!cand.is_valid?'#ef4444':cand.is_regen_spot?'#facc15':cand.slope_band==='SAFE'?'#10b981':'#f59e0b'
        const candPos=terrainPosition(cand.coordinates.latitude_deg,cand.coordinates.longitude_deg,cand.coordinates.elevation_m,demOrigin,scale,tgtOffset-6)
        if(originPos&&cand.is_valid){
          rt.traverse.push(rt.viewer.entities.add({
            id:`traverse-cand-ray:${cand.candidate_id}`,
            polyline:{positions:[originPos,candPos],width:cand.is_regen_spot?2.5:1.5,material:C.Color.fromCssColorString(colorCss).withAlpha(cand.is_regen_spot?0.85:0.55)},
          }))
        }
        rt.traverse.push(rt.viewer.entities.add({
          id:`traverse-cand:${cand.candidate_id}`,
          position:candPos,
          point:{pixelSize:cand.is_regen_spot?13:10,color:C.Color.fromCssColorString(colorCss),outlineColor:C.Color.BLACK,outlineWidth:cand.is_regen_spot?2:1.5,disableDepthTestDistance:Number.POSITIVE_INFINITY},
          ...(cand.is_regen_spot?{
            label:{
              text:'⚡ REGEN SPOT',
              font:'600 9px "JetBrains Mono", monospace',
              fillColor:C.Color.fromCssColorString('#fef08a'),
              outlineColor:C.Color.BLACK,
              outlineWidth:3,
              style:C.LabelStyle.FILL_AND_OUTLINE,
              pixelOffset:new C.Cartesian2(0,-16),
              disableDepthTestDistance:Number.POSITIVE_INFINITY,
            },
          }:{}),
        }))
      }
    }
    rt.viewer.scene.requestRender()
  },[ready,props.traverseTarget,props.researchTargets,props.catalogSites,props.traverseWaypoints,props.traverseCandidates,props.activeRoverState,props.demTerrain,effectiveScale,props.desiredCameraMode,props.focusCoordinates])

  return <div className="absolute inset-0" aria-label="Cesium lunar imagery and verified terrain">
    <div ref={host} className="absolute inset-0"/>
    <div className="absolute bottom-7 left-3 z-10 max-w-[65vw] pointer-events-none text-[8px] sm:text-[9px] font-mono-tech text-slate-400 leading-relaxed" role="status">
      {error?`Viewer issue: ${error}`:props.pickingTraverseTarget?'CLICK TARGET ON 3D MAP: Select your Research Destination on the lunar terrain.':props.desiredCameraMode==='SURFACE'&&!hasDemPatch?'Verified local terrain unavailable at this selection. Showing imagery on the lunar reference sphere.':hasDemPatch&&props.desiredCameraMode==='SURFACE'?`${props.demTerrain?.metadata.site_id ?? 'LOLA'} · ${props.verticalScale}× height · ${matching?'recorded Sun/Earth directions':'celestial overlays withheld outside canonical Site01'}. Imagery lighting is baked, not calculated shadows.`:message}
    </div>
  </div>
}
