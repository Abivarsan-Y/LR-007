import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { azElToSceneDirection } from '../../scene/directions.mjs'
import type {
  AnalysisSample,
  CatalogSiteEntry,
  ContractRecommendDocument,
  DecodedDemSiteTerrain,
} from '../../api/types'
import { classifySlopeBand, normalizeLongitudeDeg } from '../../api/client'

export type TerrainOverlayMode = 'albedo' | 'slope'

export interface SurfacePickEvent {
  latitude_deg: number
  longitude_deg: number
  elevation_m: number
  slope_deg: number | null
  matchedCatalogSite: CatalogSiteEntry | null
  label: string
  horizonAnglesDeg: number[]
}

export interface SafeHavenHighlight {
  site_id: string
  distance_m: number
  bearing_deg: number
  slope_deg: number
  elevation_m: number
}

interface Props {
  catalogSites: CatalogSiteEntry[]
  selectedSiteId: string | null
  focusCoordinates: { latitude_deg: number; longitude_deg: number } | null
  hasSelection: boolean
  desiredCameraMode: 'ORBITAL' | 'SURFACE'
  cameraPresetNonce: number
  demTerrain: DecodedDemSiteTerrain | null
  currentSample: AnalysisSample | null
  recommendations: ContractRecommendDocument | null
  highlightedCandidateId: string | null
  overlayMode: TerrainOverlayMode
  showWireframe: boolean
  verticalScale: number
  onCameraModeChange: (mode: 'ORBITAL' | 'SURFACE') => void
  onPickPoint: (pick: SurfacePickEvent) => void
  onSelectCatalogSite: (site: CatalogSiteEntry) => void
}

const MOON_RADIUS = 2.0
const DEM_PATCH_HALF_EXTENT = 0.27
const EARTH_RAD_APPROX = 1737400
const DEG_TO_RAD = Math.PI / 180

interface CraterDef {
  lat: number
  lon: number
  radiusDeg: number
  depth: number
  rim: number
  name: string
  vec: THREE.Vector3
  radiusRad: number
}

function latLonToUnitVec(latDeg: number, lonDeg: number): THREE.Vector3 {
  const lat = THREE.MathUtils.degToRad(latDeg)
  const lon = THREE.MathUtils.degToRad(lonDeg)
  const cosLat = Math.cos(lat)
  return new THREE.Vector3(cosLat * Math.sin(lon), Math.sin(lat), cosLat * Math.cos(lon)).normalize()
}

function unitVecToLatLon(vec: THREE.Vector3): { lat: number; lon: number } {
  const u = vec.clone().normalize()
  const lat = THREE.MathUtils.radToDeg(Math.asin(THREE.MathUtils.clamp(u.y, -1, 1)))
  const lon = normalizeLongitudeDeg(THREE.MathUtils.radToDeg(Math.atan2(u.x, u.z)))
  return { lat, lon }
}

function getLocalTangentFrame(unitPos: THREE.Vector3): {
  east: THREE.Vector3
  north: THREE.Vector3
  up: THREE.Vector3
} {
  const up = unitPos.clone().normalize()
  const refNorth =
    Math.abs(up.y) > 0.999
      ? new THREE.Vector3(0, 0, up.y < 0 ? 1 : -1)
      : new THREE.Vector3(0, 1, 0)
  const east = new THREE.Vector3().crossVectors(refNorth, up).normalize()
  const north = new THREE.Vector3().crossVectors(up, east).normalize()
  return { east, north, up }
}

const RAW_CRATERS: Omit<CraterDef, 'vec' | 'radiusRad'>[] = [
  { lat: -89.65, lon: 185, radiusDeg: 0.95, depth: 0.0165, rim: 0.006, name: 'Shackleton' },
  { lat: -88.1, lon: 45, radiusDeg: 1.75, depth: 0.0185, rim: 0.0052, name: 'Shoemaker' },
  { lat: -87.3, lon: 78, radiusDeg: 1.45, depth: 0.0165, rim: 0.0048, name: 'Faustini' },
  { lat: -87.5, lon: -15, radiusDeg: 1.85, depth: 0.0195, rim: 0.0055, name: 'Haworth' },
  { lat: -84.9, lon: -38, radiusDeg: 2.8, depth: 0.0225, rim: 0.0068, name: 'Cabeus' },
  { lat: -86.0, lon: 15, radiusDeg: 0.85, depth: -0.012, rim: 0.0022, name: 'Malapert' },
  { lat: -88.4, lon: -88, radiusDeg: 1.15, depth: 0.0145, rim: 0.005, name: 'de Gerlache' },
  { lat: -85.5, lon: 140, radiusDeg: 2.2, depth: 0.0175, rim: 0.0046, name: 'Amundsen' },
  { lat: -82.0, lon: 110, radiusDeg: 3.4, depth: 0.021, rim: 0.0055, name: 'Scott' },
  { lat: -81.5, lon: -120, radiusDeg: 3.1, depth: 0.0195, rim: 0.005, name: 'Drygalski' },
  { lat: -43.3, lon: -11.2, radiusDeg: 4.5, depth: 0.022, rim: 0.006, name: 'Tycho' },
  { lat: -52.0, lon: -165.0, radiusDeg: 14.0, depth: 0.028, rim: 0.007, name: 'SPA Basin' },
  { lat: 9.6, lon: -20.1, radiusDeg: 4.8, depth: 0.02, rim: 0.006, name: 'Copernicus' },
  { lat: 25.0, lon: 30.0, radiusDeg: 12.0, depth: 0.016, rim: 0.003, name: 'Serenitatis' },
  { lat: -20.0, lon: 85.0, radiusDeg: 9.5, depth: 0.018, rim: 0.004, name: 'Smythii' },
  { lat: 15.0, lon: -110.0, radiusDeg: 8.5, depth: 0.019, rim: 0.004, name: 'Hertzsprung' },
  { lat: -32.0, lon: 55.0, radiusDeg: 6.2, depth: 0.017, rim: 0.004, name: 'Petavius' },
]

const CRATERS: CraterDef[] = RAW_CRATERS.map(c => ({
  ...c,
  vec: latLonToUnitVec(c.lat, c.lon),
  radiusRad: THREE.MathUtils.degToRad(c.radiusDeg),
}))

function hash3(x: number, y: number, z: number): number {
  const n = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453123
  return n - Math.floor(n)
}

function valueNoise3D(x: number, y: number, z: number): number {
  const ix = Math.floor(x)
  const iy = Math.floor(y)
  const iz = Math.floor(z)
  const fx = x - ix
  const fy = y - iy
  const fz = z - iz
  const ux = fx * fx * (3 - 2 * fx)
  const uy = fy * fy * (3 - 2 * fy)
  const uz = fz * fz * (3 - 2 * fz)

  const n000 = hash3(ix, iy, iz)
  const n100 = hash3(ix + 1, iy, iz)
  const n010 = hash3(ix, iy + 1, iz)
  const n110 = hash3(ix + 1, iy + 1, iz)
  const n001 = hash3(ix, iy, iz + 1)
  const n101 = hash3(ix + 1, iy, iz + 1)
  const n011 = hash3(ix, iy + 1, iz + 1)
  const n111 = hash3(ix + 1, iy + 1, iz + 1)

  const nx00 = n000 + (n100 - n000) * ux
  const nx10 = n010 + (n110 - n010) * ux
  const nx01 = n001 + (n101 - n001) * ux
  const nx11 = n011 + (n111 - n011) * ux
  const nxy0 = nx00 + (nx10 - nx00) * uy
  const nxy1 = nx01 + (nx11 - nx01) * uy
  return nxy0 + (nxy1 - nxy0) * uz
}

function fbm3D(x: number, y: number, z: number, octaves = 4): number {
  let val = 0
  let amp = 0.5
  let freq = 2.4
  for (let i = 0; i < octaves; i++) {
    val += amp * (valueNoise3D(x * freq, y * freq, z * freq) - 0.5)
    freq *= 2.15
    amp *= 0.48
  }
  return val
}

function getSphericalElevationOffset(unitVec: THREE.Vector3, highDetail = false): number {
  let h = fbm3D(unitVec.x, unitVec.y, unitVec.z, 4) * 0.011
  h += fbm3D(unitVec.x * 9.0, unitVec.y * 9.0, unitVec.z * 9.0, 3) * 0.0028

  if (highDetail) {
    const fine = fbm3D(unitVec.x * 38.0, unitVec.y * 38.0, unitVec.z * 38.0, 3)
    const micro = Math.abs(valueNoise3D(unitVec.x * 115.0, unitVec.y * 115.0, unitVec.z * 115.0) - 0.5)
    h += fine * 0.0014 - micro * 0.00055
  }

  for (let i = 0; i < CRATERS.length; i++) {
    const c = CRATERS[i]
    const dot = THREE.MathUtils.clamp(unitVec.dot(c.vec), -1, 1)
    if (dot < Math.cos(c.radiusRad * 2.1)) continue
    const dist = Math.acos(dot)
    const r = dist / c.radiusRad
    if (r < 1.0) {
      let bowl = (r * r - 1.0) * c.depth
      if (highDetail && c.depth > 0) {
        if (r > 0.52 && r < 0.96) {
          bowl += Math.sin(r * Math.PI * 10.0) * 0.00045 * (1.0 - r)
        }
        if (c.radiusDeg > 1.35 && r < 0.28) {
          bowl += Math.cos((r / 0.28) * Math.PI * 0.5) * (c.depth * 0.22)
        }
      }
      const rimBoost = Math.exp(-Math.pow((r - 1.0) / 0.22, 2)) * c.rim
      h += bowl + rimBoost
    } else if (r < 2.0) {
      h += Math.exp(-Math.pow((r - 1.0) / 0.32, 2)) * c.rim
    }
  }
  return h
}

function sampleProceduralHorizonAngles(unitPos: THREE.Vector3): number[] {
  const { east, north } = getLocalTangentFrame(unitPos)
  const baseElevUnits = getSphericalElevationOffset(unitPos, true)
  const steps = 72
  const angles: number[] = []
  const sampleVec = new THREE.Vector3()
  const dirTangent = new THREE.Vector3()

  for (let i = 0; i < steps; i++) {
    const azRad = THREE.MathUtils.degToRad(i * (360 / steps))
    dirTangent.copy(north).multiplyScalar(Math.cos(azRad)).addScaledVector(east, Math.sin(azRad)).normalize()
    let maxAngleDeg = -4.0
    for (let s = 1; s <= 28; s++) {
      const arcRad = 0.0025 + (s / 28) * 0.16
      sampleVec.copy(unitPos).multiplyScalar(Math.cos(arcRad)).addScaledVector(dirTangent, Math.sin(arcRad)).normalize()
      const dh = getSphericalElevationOffset(sampleVec, true) - baseElevUnits
      const curvatureDrop = MOON_RADIUS * (1 - Math.cos(arcRad))
      const chordDist = MOON_RADIUS * Math.sin(arcRad)
      const angleDeg = THREE.MathUtils.radToDeg(Math.atan2(dh - curvatureDrop, chordDist))
      if (angleDeg > maxAngleDeg) maxAngleDeg = angleDeg
    }
    angles.push(maxAngleDeg)
  }
  return angles
}

function enuMetersToSceneVec(
  xEastM: number,
  yUpM: number,
  zSouthM: number,
  spanM: number,
  frame: { east: THREE.Vector3; north: THREE.Vector3; up: THREE.Vector3 },
  verticalScale: number,
): THREE.Vector3 {
  const scaleXZ = (DEM_PATCH_HALF_EXTENT * 2) / Math.max(spanM, 1)
  const baseR = MOON_RADIUS + 0.032
  const tangentX = xEastM * scaleXZ
  const tangentNorth = -zSouthM * scaleXZ
  const radialShift = yUpM * scaleXZ * verticalScale

  return frame.up
    .clone()
    .multiplyScalar(baseR + radialShift)
    .addScaledVector(frame.east, tangentX)
    .addScaledVector(frame.north, tangentNorth)
}

function enuDirectionToWorld(
  azimuthDeg: number,
  elevationDeg: number,
  frame: { east: THREE.Vector3; north: THREE.Vector3; up: THREE.Vector3 },
): THREE.Vector3 {
  const normAz = ((azimuthDeg % 360) + 360) % 360
  const clampedEl = THREE.MathUtils.clamp(elevationDeg, -89.9, 89.9)
  const dir = azElToSceneDirection(normAz, clampedEl)
  return new THREE.Vector3()
    .addScaledVector(frame.east, dir.x)
    .addScaledVector(frame.up, dir.y)
    .addScaledVector(frame.north, -dir.z)
    .normalize()
}

function slopeColorRGB(slopeDeg: number): [number, number, number] {
  if (!Number.isFinite(slopeDeg)) return [0.35, 0.4, 0.48]
  const band = classifySlopeBand(slopeDeg)
  if (band === 'SAFE') return [0.20, 0.83, 0.60]
  if (band === 'CAUTION') return [0.98, 0.75, 0.14]
  return [0.98, 0.44, 0.52]
}

export function LunarStage3D({
  catalogSites,
  selectedSiteId,
  focusCoordinates,
  hasSelection,
  desiredCameraMode,
  cameraPresetNonce,
  demTerrain,
  currentSample,
  recommendations,
  highlightedCandidateId,
  overlayMode,
  showWireframe,
  verticalScale,
  onCameraModeChange,
  onPickPoint,
  onSelectCatalogSite,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null)

  const latestPropsRef = useRef({
    catalogSites,
    selectedSiteId,
    focusCoordinates,
    hasSelection,
    demTerrain,
    currentSample,
    recommendations,
    highlightedCandidateId,
    overlayMode,
    showWireframe,
    verticalScale,
    onCameraModeChange,
    onPickPoint,
    onSelectCatalogSite,
  })
  latestPropsRef.current = {
    catalogSites,
    selectedSiteId,
    focusCoordinates,
    hasSelection,
    demTerrain,
    currentSample,
    recommendations,
    highlightedCandidateId,
    overlayMode,
    showWireframe,
    verticalScale,
    onCameraModeChange,
    onPickPoint,
    onSelectCatalogSite,
  }

  const cameraControlsRef = useRef<{
    jumpToTarget: (lat: number, lon: number, surfaceMode: boolean) => void
    setMode: (mode: 'ORBITAL' | 'SURFACE') => void
    rebuildDemMesh: () => void
    updateMarkersAndLights: () => void
  } | null>(null)

  // Initialize Three.js scene once.
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(
      36,
      container.clientWidth / Math.max(container.clientHeight, 1),
      0.015,
      100,
    )
    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    renderer.setSize(container.clientWidth, container.clientHeight)
    renderer.setClearColor(0x050507, 1)
    container.appendChild(renderer.domElement)

    // Starfield
    const starGeo = new THREE.BufferGeometry()
    const starCount = 460
    const starPos = new Float32Array(starCount * 3)
    for (let i = 0; i < starCount; i++) {
      const theta = Math.random() * Math.PI * 2
      const phi = Math.acos(2 * Math.random() - 1)
      const r = 34 + Math.random() * 14
      starPos[i * 3] = r * Math.sin(phi) * Math.cos(theta)
      starPos[i * 3 + 1] = r * Math.cos(phi)
      starPos[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta)
    }
    starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3))
    const starMat = new THREE.PointsMaterial({
      color: 0x94a3b8,
      size: 0.055,
      transparent: true,
      opacity: 0.34,
    })
    const stars = new THREE.Points(starGeo, starMat)
    scene.add(stars)

    // Lighting
    const sunLight = new THREE.DirectionalLight(0xffffff, 2.0)
    sunLight.position.set(4.5, -0.35, 3.8)
    scene.add(sunLight)

    const earthShineLight = new THREE.DirectionalLight(0x38bdf8, 0.16)
    earthShineLight.position.set(0, 0.2, 5)
    scene.add(earthShineLight)

    const ambientLight = new THREE.AmbientLight(0x1e222d, 0.25)
    scene.add(ambientLight)

    // State 1 Mesh: Full Orbital Lunar Globe
    const moonGeo = new THREE.IcosahedronGeometry(MOON_RADIUS, 6)
    const posAttr = moonGeo.attributes.position
    const moonColors = new Float32Array(posAttr.count * 3)
    const vTemp = new THREE.Vector3()
    for (let i = 0; i < posAttr.count; i++) {
      vTemp.fromBufferAttribute(posAttr, i)
      const unit = vTemp.clone().normalize()
      const elev = getSphericalElevationOffset(unit, false)
      vTemp.copy(unit).multiplyScalar(MOON_RADIUS + elev * 1.8)
      posAttr.setXYZ(i, vTemp.x, vTemp.y, vTemp.z)

      const albedo = THREE.MathUtils.clamp(
        0.46 + elev * 11.5 + fbm3D(unit.x * 3, unit.y * 3, unit.z * 3) * 0.12,
        0.22,
        0.78,
      )
      moonColors[i * 3] = albedo * 0.96
      moonColors[i * 3 + 1] = albedo * 0.97
      moonColors[i * 3 + 2] = albedo * 1.02
    }
    moonGeo.setAttribute('color', new THREE.BufferAttribute(moonColors, 3))
    moonGeo.computeVertexNormals()
    const moonMat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.94,
      metalness: 0.04,
    })
    const moonMesh = new THREE.Mesh(moonGeo, moonMat)
    scene.add(moonMesh)

    // Subtle Polar Graticule (fades out cleanly as camera zooms into Surface Terrain)
    const graticuleGroup = new THREE.Group()
    const lineMatSubtle = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.07 })
    const lineMatPole = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.16 })
    const graticuleMats = [
      { mat: lineMatSubtle, base: 0.07 },
      { mat: lineMatPole, base: 0.16 },
    ]
    const graticuleGeos: THREE.BufferGeometry[] = []

    ;[-88, -85, -80, -60, -30, 0, 30, 60].forEach(lat => {
      const pts: THREE.Vector3[] = []
      for (let lon = 0; lon <= 360; lon += 3) {
        const u = latLonToUnitVec(lat, lon)
        const r = MOON_RADIUS + getSphericalElevationOffset(u, false) * 1.8 + 0.004
        pts.push(u.multiplyScalar(r))
      }
      const g = new THREE.BufferGeometry().setFromPoints(pts)
      graticuleGeos.push(g)
      graticuleGroup.add(new THREE.Line(g, lat <= -80 ? lineMatPole : lineMatSubtle))
    })

    for (let lon = 0; lon < 180; lon += 30) {
      const pts: THREE.Vector3[] = []
      for (let lat = -90; lat <= 90; lat += 3) {
        const u = latLonToUnitVec(lat, lon)
        const r = MOON_RADIUS + getSphericalElevationOffset(u, false) * 1.8 + 0.004
        pts.push(u.multiplyScalar(r))
      }
      for (let lat = 90; lat >= -90; lat -= 3) {
        const u = latLonToUnitVec(lat, lon + 180)
        const r = MOON_RADIUS + getSphericalElevationOffset(u, false) * 1.8 + 0.004
        pts.push(u.multiplyScalar(r))
      }
      const g = new THREE.BufferGeometry().setFromPoints(pts)
      graticuleGeos.push(g)
      graticuleGroup.add(new THREE.Line(g, lon === 0 ? lineMatPole : lineMatSubtle))
    }
    scene.add(graticuleGroup)

    // Catalog Site Orbital Beacons (4 Real NASA South Pole Sites)
    const beaconGroup = new THREE.Group()
    scene.add(beaconGroup)
    const beaconHitTargets: { mesh: THREE.Mesh; site: CatalogSiteEntry }[] = []
    const beaconRingGeo = new THREE.RingGeometry(0.022, 0.03, 28)
    const beaconCoreGeo = new THREE.CircleGeometry(0.011, 16)
    const beaconDisposables: THREE.Material[] = []

    latestPropsRef.current.catalogSites.forEach(site => {
      const u = latLonToUnitVec(site.latitude_deg, site.longitude_deg)
      const r = MOON_RADIUS + getSphericalElevationOffset(u, false) * 1.8 + 0.009
      const pos = u.clone().multiplyScalar(r)

      const ringMat = new THREE.MeshBasicMaterial({
        color: site.hasVerifiedAnalysis ? 0x34d399 : 0x67e8f9,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.85,
      })
      const coreMat = new THREE.MeshBasicMaterial({
        color: site.hasVerifiedAnalysis ? 0x34d399 : 0x67e8f9,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.95,
      })
      beaconDisposables.push(ringMat, coreMat)

      const item = new THREE.Group()
      item.position.copy(pos)
      item.lookAt(pos.clone().add(u))

      const ringMesh = new THREE.Mesh(beaconRingGeo, ringMat)
      const coreMesh = new THREE.Mesh(beaconCoreGeo, coreMat)
      coreMesh.scale.setScalar(2.4) // Slight invisible/core click tolerance
      coreMesh.visible = false
      const visCore = new THREE.Mesh(beaconCoreGeo, coreMat)

      item.add(ringMesh, visCore, coreMesh)
      beaconGroup.add(item)
      beaconHitTargets.push({ mesh: coreMesh, site })
    })

    // State 2A Mesh: Procedural High-Res Spherical Crater Patch (fallback outside DEM footprints)
    const PATCH_SEGMENTS = 128
    const PATCH_ANGULAR_RADIUS = 0.125
    const procPatchGeo = new THREE.PlaneGeometry(1, 1, PATCH_SEGMENTS, PATCH_SEGMENTS)
    procPatchGeo.setAttribute(
      'color',
      new THREE.BufferAttribute(new Float32Array(procPatchGeo.attributes.position.count * 3), 3),
    )
    const procPatchMat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.92,
      metalness: 0.03,
      transparent: true,
      opacity: 0,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    })
    const procPatchMesh = new THREE.Mesh(procPatchGeo, procPatchMat)
    procPatchMesh.visible = false
    scene.add(procPatchMesh)

    const lastProcCenterUnit = new THREE.Vector3()
    function rebuildProceduralPatch(centerUnit: THREE.Vector3) {
      if (lastProcCenterUnit.lengthSq() > 0.5 && lastProcCenterUnit.dot(centerUnit) > 0.99985) return
      lastProcCenterUnit.copy(centerUnit).normalize()

      const { east, north } = getLocalTangentFrame(lastProcCenterUnit)
      const pAttr = procPatchGeo.attributes.position
      const cAttr = procPatchGeo.attributes.color
      const tangentDir = new THREE.Vector3()
      const sampleUnit = new THREE.Vector3()

      let idx = 0
      for (let iy = 0; iy <= PATCH_SEGMENTS; iy++) {
        const v = (iy / PATCH_SEGMENTS) * 2 - 1
        for (let ix = 0; ix <= PATCH_SEGMENTS; ix++) {
          const u = (ix / PATCH_SEGMENTS) * 2 - 1
          const angX = u * PATCH_ANGULAR_RADIUS
          const angY = -v * PATCH_ANGULAR_RADIUS
          const arcDist = Math.hypot(angX, angY)

          if (arcDist < 1e-6) {
            sampleUnit.copy(lastProcCenterUnit)
          } else {
            tangentDir.copy(east).multiplyScalar(angX).addScaledVector(north, angY).normalize()
            sampleUnit
              .copy(lastProcCenterUnit)
              .multiplyScalar(Math.cos(arcDist))
              .addScaledVector(tangentDir, Math.sin(arcDist))
              .normalize()
          }

          const edgeBlend = 1.0 - THREE.MathUtils.smoothstep(Math.max(Math.abs(u), Math.abs(v)), 0.78, 1.0)
          const elevBase = getSphericalElevationOffset(sampleUnit, false)
          const elevHigh = getSphericalElevationOffset(sampleUnit, true)
          const blended = elevBase + (elevHigh - elevBase) * edgeBlend
          const r = MOON_RADIUS + blended * 1.8 + 0.0006 * edgeBlend
          pAttr.setXYZ(idx, sampleUnit.x * r, sampleUnit.y * r, sampleUnit.z * r)

          const microGrain = fbm3D(sampleUnit.x * 26, sampleUnit.y * 26, sampleUnit.z * 26, 2) * 0.09
          const albedo = THREE.MathUtils.clamp(0.45 + blended * 12.8 + microGrain, 0.18, 0.84)
          cAttr.setXYZ(idx, albedo * 0.96, albedo * 0.97, albedo * 1.02)
          idx++
        }
      }
      pAttr.needsUpdate = true
      cAttr.needsUpdate = true
      procPatchGeo.computeVertexNormals()
      procPatchGeo.computeBoundingSphere()
    }

    // State 2B Mesh: Real NASA LOLA 129x129 Float32 Binary DEM Reconstruction
    const demGeo = new THREE.BufferGeometry()
    const demMat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.91,
      metalness: 0.05,
      transparent: true,
      opacity: 0,
      wireframe: false,
      side: THREE.FrontSide,
    })
    const demMesh = new THREE.Mesh(demGeo, demMat)
    demMesh.visible = false
    scene.add(demMesh)

    // Footprint subtle border outline around the 2.56km x 2.56km LOLA DEM patch
    const demFrameGeo = new THREE.BufferGeometry()
    const demFrameMat = new THREE.LineBasicMaterial({
      color: 0x34d399,
      transparent: true,
      opacity: 0,
    })
    const demFrameLine = new THREE.LineLoop(demFrameGeo, demFrameMat)
    demFrameLine.visible = false
    scene.add(demFrameLine)

    // Safe Haven 3D markers on DEM
    const safeHavenGroup = new THREE.Group()
    scene.add(safeHavenGroup)
    const safeRingGeo = new THREE.RingGeometry(0.008, 0.013, 24)
    const safeCoreGeo = new THREE.CircleGeometry(0.0045, 16)
    const safeHavenPool: { group: THREE.Group; ringMat: THREE.MeshBasicMaterial; coreMat: THREE.MeshBasicMaterial }[] = []
    for (let i = 0; i < 6; i++) {
      const ringMat = new THREE.MeshBasicMaterial({ color: 0x67e8f9, side: THREE.DoubleSide, transparent: true, opacity: 0.9 })
      const coreMat = new THREE.MeshBasicMaterial({ color: 0x34d399, side: THREE.DoubleSide })
      const g = new THREE.Group()
      g.visible = false
      g.add(new THREE.Mesh(safeRingGeo, ringMat), new THREE.Mesh(safeCoreGeo, coreMat))
      safeHavenGroup.add(g)
      safeHavenPool.push({ group: g, ringMat, coreMat })
    }

    // Selected Reticle + Earth LoS Vector + Sun LoS Vector
    const markerGroup = new THREE.Group()
    markerGroup.visible = false
    scene.add(markerGroup)
    const selRingMat = new THREE.MeshBasicMaterial({ color: 0x34d399, side: THREE.DoubleSide, transparent: true, opacity: 0.94 })
    const selDotMat = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide })
    const selRingMesh = new THREE.Mesh(new THREE.RingGeometry(0.015, 0.02, 36), selRingMat)
    const selDotMesh = new THREE.Mesh(new THREE.CircleGeometry(0.005, 20), selDotMat)
    markerGroup.add(selRingMesh, selDotMesh)

    const earthLosGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 0, 1)])
    const earthLosMat = new THREE.LineBasicMaterial({ color: 0x34d399, transparent: true, opacity: 0.92 })
    const earthLosLine = new THREE.Line(earthLosGeo, earthLosMat)
    earthLosLine.visible = false
    scene.add(earthLosLine)

    const sunLosGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 1, 0)])
    const sunLosMat = new THREE.LineBasicMaterial({ color: 0xfbbf24, transparent: true, opacity: 0.85 })
    const sunLosLine = new THREE.Line(sunLosGeo, sunLosMat)
    sunLosLine.visible = false
    scene.add(sunLosLine)

    // Camera & Runtime Animation State
    const camState = {
      radius: 7.4,
      targetRadius: 7.4,
      theta: 0.25,
      targetTheta: 0.25,
      phi: Math.PI * 0.78,
      targetPhi: Math.PI * 0.78,
      alpha: 0,
      lookAtCurrent: new THREE.Vector3(0, 0, 0),
      isDragging: false,
      lastX: 0,
      lastY: 0,
      movedDistance: 0,
      reportedMode: 'ORBITAL' as 'ORBITAL' | 'SURFACE',
    }

    const focusUnit = latLonToUnitVec(-89.46315775697231, -137.50198490762307)
    const selectedUnit = focusUnit.clone()
    let clickedDemEnu: { siteId: string; eastM: number; yRel: number; southM: number } | null = null
    let activeDemRenderedKey = ''

    function rebuildDemMesh() {
      const { demTerrain: dem, overlayMode: mode, showWireframe: wire, verticalScale: vScale } = latestPropsRef.current
      if (!dem) {
        demMesh.visible = false
        demFrameLine.visible = false
        activeDemRenderedKey = ''
        return
      }

      const key = `${dem.siteId}|${mode}|${vScale}|${wire}`
      demMat.wireframe = wire
      if (activeDemRenderedKey === key) return
      activeDemRenderedKey = key

      const demCenterUnit = latLonToUnitVec(dem.metadata.coordinates.latitude_deg, dem.metadata.coordinates.longitude_deg)
      const frame = getLocalTangentFrame(demCenterUnit)
      const count = dem.positions.length / 3
      const worldPositions = new Float32Array(dem.positions.length)
      const colors = new Float32Array(count * 3)
      const elevRange = Math.max(dem.maxRelY - dem.minRelY, 1)

      for (let i = 0; i < count; i++) {
        const xEast = dem.positions[i * 3]
        const yUp = dem.positions[i * 3 + 1]
        const zSouth = dem.positions[i * 3 + 2]
        const p = enuMetersToSceneVec(xEast, yUp, zSouth, dem.span, frame, vScale)
        worldPositions[i * 3] = p.x
        worldPositions[i * 3 + 1] = p.y
        worldPositions[i * 3 + 2] = p.z

        if (mode === 'slope') {
          const [r, g, b] = slopeColorRGB(dem.slopeDegPerVertex[i])
          colors[i * 3] = r
          colors[i * 3 + 1] = g
          colors[i * 3 + 2] = b
        } else {
          const normH = THREE.MathUtils.clamp((yUp - dem.minRelY) / elevRange, 0, 1)
          const albedo = 0.25 + normH * 0.52
          colors[i * 3] = albedo * 0.96
          colors[i * 3 + 1] = albedo * 0.98
          colors[i * 3 + 2] = albedo * 1.03
        }
      }

      demGeo.setAttribute('position', new THREE.BufferAttribute(worldPositions, 3))
      demGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3))
      demGeo.setIndex(new THREE.BufferAttribute(dem.indices, 1))
      demGeo.computeVertexNormals()
      demGeo.computeBoundingSphere()

      // Perimeter frame around DEM tile
      const halfSpan = dem.span * 0.5
      const framePts = [
        enuMetersToSceneVec(-halfSpan, 0, -halfSpan, dem.span, frame, vScale),
        enuMetersToSceneVec(halfSpan, 0, -halfSpan, dem.span, frame, vScale),
        enuMetersToSceneVec(halfSpan, 0, halfSpan, dem.span, frame, vScale),
        enuMetersToSceneVec(-halfSpan, 0, halfSpan, dem.span, frame, vScale),
      ]
      demFrameGeo.setFromPoints(framePts)
    }

    function updateMarkersAndLights() {
      const {
        selectedSiteId: activeSiteId,
        hasSelection: activeSel,
        demTerrain: dem,
        currentSample: sample,
        recommendations: recDoc,
        highlightedCandidateId: highlightId,
        verticalScale: vScale,
      } = latestPropsRef.current

      beaconHitTargets.forEach(entry => {
        const isCurrent = entry.site.id === activeSiteId
        entry.mesh.parent?.scale.setScalar(isCurrent ? 1.55 : 1.0)
      })

      const frame = getLocalTangentFrame(selectedUnit)

      // Update Sun & Earth lighting + LoS vectors
      if (activeSel && sample) {
        const sunAz = ((sample.sun.azimuth_deg % 360) + 360) % 360
        const sunElVisual = Math.max(sample.sun.elevation_deg, 1.0)
        const sunDirWorld = enuDirectionToWorld(sunAz, sunElVisual, frame)
        sunLight.position.copy(sunDirWorld).multiplyScalar(8.0)

        const earthAz = ((sample.earth.azimuth_deg % 360) + 360) % 360
        const earthDirWorld = enuDirectionToWorld(earthAz, sample.earth.elevation_deg, frame)
        earthShineLight.position.copy(earthDirWorld).multiplyScalar(6.0)
      } else {
        sunLight.position.set(4.5, -0.35, 3.8)
        earthShineLight.position.set(0, 0.2, 5)
      }

      // Position Reticle & Beams
      if (!activeSel) {
        markerGroup.visible = false
        earthLosLine.visible = false
        sunLosLine.visible = false
        safeHavenPool.forEach(p => (p.group.visible = false))
        return
      }

      let originWorld: THREE.Vector3
      if (dem && camState.alpha > 0.2) {
        const demFrame = getLocalTangentFrame(
          latLonToUnitVec(dem.metadata.coordinates.latitude_deg, dem.metadata.coordinates.longitude_deg),
        )
        const cand = recDoc?.candidates.find(c => c.site_id === highlightId)
        if (cand) {
          const bRad = cand.bearing_deg * DEG_TO_RAD
          const eastM = Math.sin(bRad) * cand.distance_m
          const southM = -Math.cos(bRad) * cand.distance_m
          const yRel = cand.coordinates.elevation_m - dem.metadata.coordinates.elevation_m
          originWorld = enuMetersToSceneVec(eastM, yRel, southM, dem.span, demFrame, vScale).addScaledVector(
            demFrame.up,
            0.004,
          )
        } else if (clickedDemEnu && clickedDemEnu.siteId === dem.siteId) {
          originWorld = enuMetersToSceneVec(
            clickedDemEnu.eastM,
            clickedDemEnu.yRel,
            clickedDemEnu.southM,
            dem.span,
            demFrame,
            vScale,
          ).addScaledVector(demFrame.up, 0.004)
        } else {
          const yRel = dem.groundY ?? 0
          originWorld = enuMetersToSceneVec(0, yRel, 0, dem.span, demFrame, vScale).addScaledVector(
            demFrame.up,
            0.004,
          )
        }
      } else {
        const r = MOON_RADIUS + getSphericalElevationOffset(selectedUnit, true) * 1.8 + 0.006
        originWorld = selectedUnit.clone().multiplyScalar(r)
      }

      markerGroup.visible = true
      markerGroup.position.copy(originWorld)
      markerGroup.lookAt(originWorld.clone().add(frame.up))

      // Earth LoS Line
      if (sample) {
        const earthAz = ((sample.earth.azimuth_deg % 360) + 360) % 360
        const earthVec = enuDirectionToWorld(earthAz, sample.earth.elevation_deg, frame)
        const earthIn = sample.earth.visible === true
        const earthLen = earthIn ? 0.55 : 0.16
        earthLosGeo.setFromPoints([originWorld, originWorld.clone().addScaledVector(earthVec, earthLen)])
        earthLosMat.color.setHex(earthIn ? 0x34d399 : 0xfb7185)
        selRingMat.color.setHex(earthIn ? 0x34d399 : 0xfb7185)
        earthLosLine.visible = true

        // Sun LoS Line
        const sunAz = ((sample.sun.azimuth_deg % 360) + 360) % 360
        const sunVec = enuDirectionToWorld(sunAz, sample.sun.elevation_deg, frame)
        const sunIn = sample.sun.visible === true
        const sunLen = sunIn ? 0.45 : 0.14
        sunLosGeo.setFromPoints([originWorld, originWorld.clone().addScaledVector(sunVec, sunLen)])
        sunLosMat.color.setHex(sunIn ? 0xfbbf24 : 0x64748b)
        sunLosLine.visible = true
      }

      // Render Safe Haven 3D pins onto real DEM
      if (dem && recDoc?.candidates.length && camState.alpha > 0.25) {
        const demFrame = getLocalTangentFrame(
          latLonToUnitVec(dem.metadata.coordinates.latitude_deg, dem.metadata.coordinates.longitude_deg),
        )
        safeHavenPool.forEach((slot, idx) => {
          const cand = recDoc.candidates[idx]
          if (!cand) {
            slot.group.visible = false
            return
          }
          const bRad = cand.bearing_deg * DEG_TO_RAD
          const eastM = Math.sin(bRad) * cand.distance_m
          const southM = -Math.cos(bRad) * cand.distance_m
          const yRel = cand.coordinates.elevation_m - dem.metadata.coordinates.elevation_m
          const pos = enuMetersToSceneVec(eastM, yRel, southM, dem.span, demFrame, vScale).addScaledVector(
            demFrame.up,
            0.004,
          )
          slot.group.visible = true
          slot.group.position.copy(pos)
          slot.group.lookAt(pos.clone().add(demFrame.up))
          const active = cand.site_id === highlightId
          slot.ringMat.color.setHex(active ? 0xfbbf24 : 0x67e8f9)
          slot.coreMat.color.setHex(active ? 0xfbbf24 : 0x34d399)
          slot.group.scale.setScalar(active ? 1.45 : 1.0)
        })
      } else {
        safeHavenPool.forEach(slot => (slot.group.visible = false))
      }
    }

    cameraControlsRef.current = {
      jumpToTarget(lat: number, lon: number, surfaceMode: boolean) {
        const u = latLonToUnitVec(lat, lon)
        focusUnit.copy(u)
        selectedUnit.copy(u)
        clickedDemEnu = null
        camState.targetPhi = THREE.MathUtils.clamp(Math.acos(THREE.MathUtils.clamp(u.y, -1, 1)), 0.14, Math.PI - 0.04)
        camState.targetTheta = Math.atan2(u.x, u.z)
        camState.targetRadius = surfaceMode ? 2.58 : 6.4
        rebuildProceduralPatch(focusUnit)
        rebuildDemMesh()
        updateMarkersAndLights()
      },
      setMode(mode: 'ORBITAL' | 'SURFACE') {
        if (mode === 'SURFACE') {
          camState.targetPhi = THREE.MathUtils.clamp(
            Math.acos(THREE.MathUtils.clamp(selectedUnit.y, -1, 1)),
            0.14,
            Math.PI - 0.04,
          )
          camState.targetTheta = Math.atan2(selectedUnit.x, selectedUnit.z)
          camState.targetRadius = 2.58
        } else {
          camState.targetRadius = 7.4
          camState.targetPhi = Math.PI * 0.78
        }
      },
      rebuildDemMesh,
      updateMarkersAndLights,
    }

    // Pointer / Raycasting / Zoom Listeners
    const raycaster = new THREE.Raycaster()
    const pointerNdc = new THREE.Vector2()

    function handlePick(clientX: number, clientY: number) {
      const rect = renderer.domElement.getBoundingClientRect()
      pointerNdc.x = ((clientX - rect.left) / rect.width) * 2 - 1
      pointerNdc.y = -((clientY - rect.top) / rect.height) * 2 + 1
      raycaster.setFromCamera(pointerNdc, camera)

      // First check clickable South Pole catalog site beacons when visible
      const beaconHits = raycaster.intersectObjects(
        beaconHitTargets.map(b => b.mesh),
        false,
      )
      if (beaconHits.length > 0 && camState.alpha < 0.7) {
        const hitObj = beaconHits[0].object
        const found = beaconHitTargets.find(b => b.mesh === hitObj)
        if (found) {
          latestPropsRef.current.onSelectCatalogSite(found.site)
          return
        }
      }

      // Check real DEM or procedural surface or sphere
      const { demTerrain: dem, catalogSites: sites } = latestPropsRef.current
      if (dem && demMesh.visible && camState.alpha > 0.35) {
        const demHits = raycaster.intersectObject(demMesh, false)
        if (demHits.length > 0) {
          const hitPt = demHits[0].point
          const demCenter = latLonToUnitVec(
            dem.metadata.coordinates.latitude_deg,
            dem.metadata.coordinates.longitude_deg,
          )
          const demFrame = getLocalTangentFrame(demCenter)
          const basePos = demFrame.up.clone().multiplyScalar(MOON_RADIUS + 0.032)
          const delta = hitPt.clone().sub(basePos)
          const scaleXZ = (DEM_PATCH_HALF_EXTENT * 2) / Math.max(dem.span, 1)
          const eastM = delta.dot(demFrame.east) / scaleXZ
          const northM = delta.dot(demFrame.north) / scaleXZ
          const southM = -northM
          const halfSpan = dem.span * 0.5
          const col = Math.round(((eastM + halfSpan) / dem.span) * (dem.metadata.width - 1))
          const row = Math.round(((southM + halfSpan) / dem.span) * (dem.metadata.height - 1))
          let elevM = dem.metadata.coordinates.elevation_m
          let yRel = dem.groundY ?? 0
          let slopeDeg: number | null = null
          if (col >= 0 && col < dem.metadata.width && row >= 0 && row < dem.metadata.height) {
            const idx = row * dem.metadata.width + col
            yRel = dem.positions[idx * 3 + 1]
            elevM = dem.metadata.coordinates.elevation_m + yRel
            const s = dem.slopeDegPerVertex[idx]
            slopeDeg = Number.isFinite(s) ? s : null
          }
          // Approximate local lat/lon offset around DEM origin using lunar mean sphere radius
          const latDelta = (northM / EARTH_RAD_APPROX) / DEG_TO_RAD
          const cosLat = Math.max(Math.cos(dem.metadata.coordinates.latitude_deg * DEG_TO_RAD), 0.015)
          const lonDelta = (eastM / (EARTH_RAD_APPROX * cosLat)) / DEG_TO_RAD
          const clickLat = THREE.MathUtils.clamp(dem.metadata.coordinates.latitude_deg + latDelta, -90, 90)
          const clickLon = normalizeLongitudeDeg(dem.metadata.coordinates.longitude_deg + lonDelta)
          selectedUnit.copy(hitPt).normalize()
          clickedDemEnu = { siteId: dem.siteId, eastM, yRel, southM }
          updateMarkersAndLights()

          const siteOwner = sites.find(s => s.terrainSiteId === dem.siteId) ?? null
          latestPropsRef.current.onPickPoint({
            latitude_deg: clickLat,
            longitude_deg: clickLon,
            elevation_m: elevM,
            slope_deg: slopeDeg,
            matchedCatalogSite: siteOwner,
            label: siteOwner ? `${siteOwner.shortName} · Local DEM Sample` : 'NASA LOLA DEM Sample',
            horizonAnglesDeg: sampleProceduralHorizonAngles(demCenter),
          })
          return
        }
      }

      const targets = procPatchMesh.visible && camState.alpha > 0.35 ? [procPatchMesh, moonMesh] : [moonMesh]
      const hits = raycaster.intersectObjects(targets, false)
      if (hits.length > 0) {
        const hitUnit = hits[0].point.clone().normalize()
        const { lat, lon } = unitVecToLatLon(hitUnit)
        // Check proximity (< 0.4 deg) to any catalog site
        let matched: CatalogSiteEntry | null = null
        let bestDot = Math.cos(THREE.MathUtils.degToRad(0.45))
        for (const site of sites) {
          const d = latLonToUnitVec(site.latitude_deg, site.longitude_deg).dot(hitUnit)
          if (d > bestDot) {
            bestDot = d
            matched = site
          }
        }
        if (matched) {
          latestPropsRef.current.onSelectCatalogSite(matched)
          return
        }

        selectedUnit.copy(hitUnit)
        focusUnit.copy(hitUnit)
        clickedDemEnu = null
        rebuildProceduralPatch(focusUnit)
        updateMarkersAndLights()

        const elevOffset = getSphericalElevationOffset(hitUnit, true)
        latestPropsRef.current.onPickPoint({
          latitude_deg: lat,
          longitude_deg: lon,
          elevation_m: Math.round(elevOffset * 175000),
          slope_deg: null,
          matchedCatalogSite: null,
          label: 'Surface Coordinate',
          horizonAnglesDeg: sampleProceduralHorizonAngles(hitUnit),
        })
      }
    }

    const onPointerDown = (e: PointerEvent) => {
      camState.isDragging = true
      camState.lastX = e.clientX
      camState.lastY = e.clientY
      camState.movedDistance = 0
    }

    const onPointerMove = (e: PointerEvent) => {
      if (!camState.isDragging) return
      const dx = e.clientX - camState.lastX
      const dy = e.clientY - camState.lastY
      camState.lastX = e.clientX
      camState.lastY = e.clientY
      camState.movedDistance += Math.hypot(dx, dy)
      if (camState.movedDistance > 4) container.style.cursor = 'grabbing'

      const altFactor = THREE.MathUtils.clamp((camState.targetRadius - 2.05) / 5.2, 0.06, 1.2)
      const rotateSpeed = 0.0055 * altFactor
      camState.targetTheta -= dx * rotateSpeed
      camState.targetPhi = THREE.MathUtils.clamp(camState.targetPhi - dy * rotateSpeed, 0.08, Math.PI - 0.03)
    }

    const onPointerUp = (e: PointerEvent) => {
      if (!camState.isDragging) return
      camState.isDragging = false
      container.style.cursor = 'crosshair'
      if (camState.movedDistance < 5) {
        handlePick(e.clientX, e.clientY)
      }
    }

    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const closeness = THREE.MathUtils.clamp((camState.targetRadius - 2.15) / 5.0, 0.22, 1.2)
      const zoomFactor = 1 + e.deltaY * 0.00105 * closeness
      camState.targetRadius = THREE.MathUtils.clamp(camState.targetRadius * zoomFactor, 2.26, 11.2)
    }

    let initialPinchDist: number | null = null
    let initialPinchRadius: number | null = null
    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 2) {
        initialPinchDist = Math.hypot(
          e.touches[0].clientX - e.touches[1].clientX,
          e.touches[0].clientY - e.touches[1].clientY,
        )
        initialPinchRadius = camState.targetRadius
      }
    }
    const onTouchMove = (e: TouchEvent) => {
      if (e.touches.length === 2 && initialPinchDist && initialPinchRadius) {
        const dist = Math.hypot(
          e.touches[0].clientX - e.touches[1].clientX,
          e.touches[0].clientY - e.touches[1].clientY,
        )
        const scale = initialPinchDist / Math.max(dist, 1)
        camState.targetRadius = THREE.MathUtils.clamp(initialPinchRadius * scale, 2.26, 11.2)
      }
    }
    const onTouchEnd = () => {
      initialPinchDist = null
    }

    const onResize = () => {
      if (!container) return
      camera.aspect = container.clientWidth / Math.max(container.clientHeight, 1)
      camera.updateProjectionMatrix()
      renderer.setSize(container.clientWidth, container.clientHeight)
    }

    const domElem = renderer.domElement
    domElem.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerUp)
    domElem.addEventListener('wheel', onWheel, { passive: false })
    domElem.addEventListener('touchstart', onTouchStart, { passive: true })
    domElem.addEventListener('touchmove', onTouchMove, { passive: true })
    domElem.addEventListener('touchend', onTouchEnd)
    window.addEventListener('resize', onResize)

    rebuildProceduralPatch(focusUnit)

    const clock = new THREE.Clock()
    const zeroVec = new THREE.Vector3(0, 0, 0)
    const gazeUnit = new THREE.Vector3()
    const desiredLookAt = new THREE.Vector3()
    let rafId = 0

    const animate = () => {
      rafId = requestAnimationFrame(animate)
      const elapsed = clock.getElapsedTime()

      camState.radius += (camState.targetRadius - camState.radius) * 0.085
      camState.theta += (camState.targetTheta - camState.theta) * 0.085
      camState.phi += (camState.targetPhi - camState.phi) * 0.085

      const rawAlpha = THREE.MathUtils.clamp((3.65 - camState.radius) / 0.7, 0, 1)
      const alpha = rawAlpha * rawAlpha * (3 - 2 * rawAlpha)
      camState.alpha = alpha

      const nextMode: 'ORBITAL' | 'SURFACE' = alpha > 0.5 ? 'SURFACE' : 'ORBITAL'
      if (nextMode !== camState.reportedMode) {
        camState.reportedMode = nextMode
        latestPropsRef.current.onCameraModeChange(nextMode)
      }

      const sinPhi = Math.sin(camState.phi)
      gazeUnit
        .set(sinPhi * Math.sin(camState.theta), Math.cos(camState.phi), sinPhi * Math.cos(camState.theta))
        .normalize()

      const { demTerrain: dem, hasSelection: activeSel } = latestPropsRef.current

      if (alpha > 0.02 && !activeSel) {
        rebuildProceduralPatch(gazeUnit)
      }

      const useRealDem = Boolean(dem && activeSel && alpha > 0.005)
      if (useRealDem) {
        rebuildDemMesh()
        demMesh.visible = true
        demMat.opacity = alpha
        demFrameLine.visible = true
        demFrameMat.opacity = alpha * 0.38
        procPatchMesh.visible = false
      } else if (alpha > 0.005) {
        procPatchMesh.visible = true
        procPatchMat.opacity = alpha
        demMesh.visible = false
        demFrameLine.visible = false
      } else {
        procPatchMesh.visible = false
        demMesh.visible = false
        demFrameLine.visible = false
      }

      graticuleMats.forEach(g => {
        g.mat.opacity = g.base * (1 - alpha * 0.88)
      })
      beaconGroup.visible = alpha < 0.75

      camera.position.copy(gazeUnit).multiplyScalar(camState.radius)

      const targetUnit = activeSel ? selectedUnit : gazeUnit
      const targetBaseR = useRealDem
        ? MOON_RADIUS + 0.032
        : MOON_RADIUS + getSphericalElevationOffset(targetUnit, true) * 1.8
      desiredLookAt.copy(targetUnit).multiplyScalar(targetBaseR)

      const closeObliqueFactor = THREE.MathUtils.clamp((3.0 - camState.radius) / 0.75, 0, 1) * alpha
      if (closeObliqueFactor > 0.001) {
        const { north } = getLocalTangentFrame(gazeUnit)
        camera.position.addScaledVector(north, -0.14 * closeObliqueFactor)
      }

      camState.lookAtCurrent.lerpVectors(zeroVec, desiredLookAt, alpha)
      camera.lookAt(camState.lookAtCurrent)

      if (markerGroup.visible) {
        const pulse = 1 + Math.sin(elapsed * 3.2) * 0.14
        selRingMesh.scale.set(pulse, pulse, 1)
      }

      renderer.render(scene, camera)
    }

    animate()

    return () => {
      cancelAnimationFrame(rafId)
      domElem.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', onPointerUp)
      domElem.removeEventListener('wheel', onWheel)
      domElem.removeEventListener('touchstart', onTouchStart)
      domElem.removeEventListener('touchmove', onTouchMove)
      domElem.removeEventListener('touchend', onTouchEnd)
      window.removeEventListener('resize', onResize)

      starGeo.dispose()
      starMat.dispose()
      moonGeo.dispose()
      moonMat.dispose()
      graticuleGeos.forEach(g => g.dispose())
      lineMatSubtle.dispose()
      lineMatPole.dispose()
      beaconRingGeo.dispose()
      beaconCoreGeo.dispose()
      beaconDisposables.forEach(m => m.dispose())
      procPatchGeo.dispose()
      procPatchMat.dispose()
      demGeo.dispose()
      demMat.dispose()
      demFrameGeo.dispose()
      demFrameMat.dispose()
      safeRingGeo.dispose()
      safeCoreGeo.dispose()
      safeHavenPool.forEach(s => {
        s.ringMat.dispose()
        s.coreMat.dispose()
      })
      selRingMat.dispose()
      selDotMat.dispose()
      earthLosGeo.dispose()
      earthLosMat.dispose()
      sunLosGeo.dispose()
      sunLosMat.dispose()
      renderer.dispose()
      if (domElem.parentElement === container) {
        container.removeChild(domElem)
      }
    }
  }, [])

  // Sync programmatic navigation & DEM / timeline updates without recreating WebGL context.
  useEffect(() => {
    if (!focusCoordinates) return
    cameraControlsRef.current?.jumpToTarget(
      focusCoordinates.latitude_deg,
      focusCoordinates.longitude_deg,
      desiredCameraMode === 'SURFACE',
    )
  }, [focusCoordinates?.latitude_deg, focusCoordinates?.longitude_deg, cameraPresetNonce])

  useEffect(() => {
    cameraControlsRef.current?.setMode(desiredCameraMode)
  }, [desiredCameraMode, cameraPresetNonce])

  useEffect(() => {
    cameraControlsRef.current?.rebuildDemMesh()
    cameraControlsRef.current?.updateMarkersAndLights()
  }, [demTerrain, overlayMode, showWireframe, verticalScale, currentSample, recommendations, highlightedCandidateId, hasSelection])

  return (
    <div
      ref={containerRef}
      className="fixed inset-0 w-full h-full z-0 cursor-crosshair select-none"
      aria-label="Interactive 3D lunar south pole viewport"
    />
  )
}
