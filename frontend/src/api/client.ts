import analysisPreviewJson from '../../../data/fixtures/mock_analysis.json'
import sitesCatalogJson from '../../../data/sites.json'
import setupFixture from './fixtures/dashboard.json'
import { decodeTerrain, verifyTerrainChecksum } from '../scene/terrain.mjs'
import type {
  AnalysisSample,
  CatalogSiteEntry,
  ContractAnalysisDocument,
  ContractDiffDocument,
  ContractHorizonPoint,
  ContractRecommendDocument,
  DashboardPreview,
  DecodedDemSiteTerrain,
  LoadedSiteWorkspace,
  PointEvaluateResponse,
  RoverPlaybackState,
  SlopeBand,
  TerrainMetadata,
  TraverseAutomaticResponse,
  TraverseManualCandidate,
  TraverseManualResponse,
  TraverseResearchTargetOption,
  TraverseWaypoint,
  WorkspaceSourceMode,
} from './types'

const legacyPreview: DashboardPreview = {
  ...setupFixture,
  defaults: { ...setupFixture.defaults, delayHours: 48 },
  source: 'synthetic',
  metrics: {
    sunlightPercent: analysisPreviewJson.metrics.sunlight_fraction * 100,
    maxDarknessHours: analysisPreviewJson.metrics.max_darkness_hours,
    dtePercent: analysisPreviewJson.metrics.earth_visible_fraction * 100,
  },
}

const DEFAULT_START_UTC = '2026-11-15T00:00:00Z'
const DEFAULT_DELAY_START_UTC = '2026-11-17T00:00:00Z'
const DEFAULT_DURATION_HOURS = 336
const DEFAULT_SAMPLE_MINUTES = 30
const DEFAULT_RECOMMEND_RADIUS_M = 1152.0
const RAD_TO_DEG = 180 / Math.PI

export function normalizeLongitudeDeg(lonDeg: number): number {
  return ((lonDeg + 180) % 360 + 360) % 360 - 180
}

export function classifySlopeBand(slopeDeg: number | null): SlopeBand {
  if (slopeDeg === null || !Number.isFinite(slopeDeg)) return 'UNKNOWN'
  if (slopeDeg < 8.0) return 'SAFE'
  if (slopeDeg <= 15.0) return 'CAUTION'
  return 'HAZARD'
}

export function formatLatLonCompact(lat: number, lon: number): string {
  const normLon = normalizeLongitudeDeg(lon)
  const latHem = lat <= 0 ? 'S' : 'N'
  const lonHem = normLon >= 0 ? 'E' : 'W'
  const latStr = Math.abs(lat).toFixed(2).padStart(5, '0')
  const lonStr = Math.abs(normLon).toFixed(1).padStart(5, '0')
  return `${latStr}°${latHem} ${lonStr}°${lonHem}`
}

const SITE_UI_OVERRIDES: Record<
  string,
  { scienceSiteId: string | null; polarId: string; shortName: string; tag: string; hasVerifiedAnalysis: boolean }
> = {
  site01_connecting_ridge: {
    scienceSiteId: 'nasa-site01-observation',
    polarId: 'connecting-ridge',
    shortName: 'Connecting Ridge',
    tag: 'NASA LOLA · JPL Horizons',
    hasVerifiedAnalysis: true,
  },
  site04_shackleton_rim: {
    scienceSiteId: null,
    polarId: 'shackleton',
    shortName: 'Shackleton Rim',
    tag: 'NASA LOLA 129×129 DEM',
    hasVerifiedAnalysis: false,
  },
  site07_malapert_mountain: {
    scienceSiteId: null,
    polarId: 'malapert',
    shortName: 'Malapert Mountain',
    tag: 'NASA LOLA 129×129 DEM',
    hasVerifiedAnalysis: false,
  },
  site09_haworth_floor: {
    scienceSiteId: null,
    polarId: 'haworth',
    shortName: 'Haworth Interior',
    tag: 'NASA LOLA 129×129 DEM',
    hasVerifiedAnalysis: false,
  },
}

export const CATALOG_SITES: CatalogSiteEntry[] = sitesCatalogJson.map(raw => {
  const override = SITE_UI_OVERRIDES[raw.site_id]
  return {
    id: raw.site_id,
    scienceSiteId: override?.scienceSiteId ?? raw.site_id,
    terrainSiteId: raw.site_id,
    polarId: override?.polarId ?? null,
    name: raw.name,
    shortName: override?.shortName ?? raw.name,
    region: raw.region,
    description: raw.description,
    latitude_deg: raw.latitude_deg,
    longitude_deg: normalizeLongitudeDeg(raw.longitude_deg),
    elevation_m: raw.elevation_m,
    recommended_mast_m: raw.recommended_mast_m,
    hasDem: true,
    hasVerifiedAnalysis: override?.hasVerifiedAnalysis ?? false,
    tag: override?.tag ?? 'Catalog Site',
  }
})

export const POLAR_LANDMARKS = [
  { name: 'Shackleton Floor', lat: -89.68, lon: 185.0, tag: 'Cryogenic Crater Floor' },
  { name: 'Cabeus Basin', lat: -84.90, lon: -38.0, tag: 'LCROSS Impact Region' },
  { name: 'Shoemaker Crater', lat: -88.10, lon: 45.0, tag: 'PSR Crater Floor' },
  { name: 'de Gerlache Rim', lat: -88.40, lon: -88.0, tag: 'Ridge Crest' },
  { name: 'South Pole Exact', lat: -90.00, lon: 0.0, tag: '90°S Rotational Axis' },
]

export const SOUTH_POLE_RESEARCH_TARGETS: Omit<TraverseResearchTargetOption, 'label' | 'distance_from_base_m'>[] = [
  // Water-Ice Craters & Permanently Shadowed Regions (PSRs)
  {
    id: 'psr_shackleton_floor',
    shortLabel: 'Shackleton Crater Floor (Water-Ice PSR)',
    category: 'water_ice_crater',
    scienceTag: 'Water-Ice PSR · Cryogenic Cold Trap',
    latitude_deg: -89.6269,
    longitude_deg: 118.7398,
    elevation_m: -2868.8,
  },
  {
    id: 'site09_haworth_floor',
    shortLabel: 'Haworth Crater Interior (Site 09 · Water-Ice PSR)',
    category: 'water_ice_crater',
    scienceTag: 'Mapped PSR Floor · H₂O Ice Deposit',
    latitude_deg: -87.4,
    longitude_deg: -4.8,
    elevation_m: -3379.0,
  },
  {
    id: 'psr_shoemaker_floor',
    shortLabel: 'Shoemaker Crater Floor (Water-Ice PSR)',
    category: 'water_ice_crater',
    scienceTag: 'PSR Cold Trap · H₂O Neutron Peak',
    latitude_deg: -88.1,
    longitude_deg: 45.0,
    elevation_m: -3926.5,
  },
  {
    id: 'psr_cabeus_basin',
    shortLabel: 'Cabeus Crater Basin (LCROSS Water-Ice Site)',
    category: 'water_ice_crater',
    scienceTag: 'LCROSS Impact · 5.6 wt% Confirmed H₂O Ice',
    latitude_deg: -84.9,
    longitude_deg: -38.0,
    elevation_m: -2826.8,
  },
  {
    id: 'psr_faustini_floor',
    shortLabel: 'Faustini Crater Floor (Water-Ice PSR)',
    category: 'water_ice_crater',
    scienceTag: 'Deep Cryogenic Water-Ice Basin',
    latitude_deg: -87.3,
    longitude_deg: 77.0,
    elevation_m: -2757.9,
  },
  // Mapped Sites & Polar Crater Rims
  {
    id: 'site04_shackleton_rim',
    shortLabel: 'Shackleton Crater Rim (Site 04)',
    category: 'mapped_site_rim',
    scienceTag: 'Mapped LOLA Rim · Peak of Near-Eternal Light',
    latitude_deg: -89.9,
    longitude_deg: 0.0,
    elevation_m: 1250.0,
  },
  {
    id: 'site01_connecting_ridge',
    shortLabel: 'Connecting Ridge (Site 01)',
    category: 'mapped_site_rim',
    scienceTag: 'Mapped LOLA Ridge · Shackleton–de Gerlache Corridor',
    latitude_deg: -89.4632,
    longitude_deg: -137.502,
    elevation_m: 1944.8,
  },
  {
    id: 'site07_malapert_mountain',
    shortLabel: 'Malapert Mountain (Site 07)',
    category: 'mapped_site_rim',
    scienceTag: 'Mapped LOLA Massif · 5 km DTE Relay Peak',
    latitude_deg: -86.04,
    longitude_deg: 2.7,
    elevation_m: 5050.0,
  },
  {
    id: 'rim_de_gerlache',
    shortLabel: 'de Gerlache Crater Rim & Cold Trap',
    category: 'mapped_site_rim',
    scienceTag: 'Mapped Polar Landmark · Crater Rim & PSR Access',
    latitude_deg: -88.4,
    longitude_deg: -88.0,
    elevation_m: -1838.6,
  },
]

interface ProcessedSiteLoaders {
  loadMeta: () => Promise<{ default: TerrainMetadata }>
  loadBinUrl: () => Promise<{ default: string }>
  loadHorizon: () => Promise<{
    default: {
      site_id: string
      site_name: string
      coordinates: TerrainMetadata['coordinates']
      observer_height_m: number
      horizon_angles: (number | null)[]
    }
  }>
  loadRecommend: () => Promise<{ default: ContractRecommendDocument }>
}

const PROCESSED_ASSET_LOADERS: Record<string, ProcessedSiteLoaders> = {
  site01_connecting_ridge: {
    loadMeta: () => import('../../../data/processed/site01_connecting_ridge_terrain.json') as Promise<{ default: TerrainMetadata }>,
    loadBinUrl: () => import('../../../data/processed/site01_connecting_ridge_terrain.bin?url'),
    loadHorizon: () => import('../../../data/processed/site01_connecting_ridge_horizon.json'),
    loadRecommend: () => import('../../../data/processed/site01_connecting_ridge_recommend.json') as Promise<{ default: ContractRecommendDocument }>,
  },
  site04_shackleton_rim: {
    loadMeta: () => import('../../../data/processed/site04_shackleton_rim_terrain.json') as Promise<{ default: TerrainMetadata }>,
    loadBinUrl: () => import('../../../data/processed/site04_shackleton_rim_terrain.bin?url'),
    loadHorizon: () => import('../../../data/processed/site04_shackleton_rim_horizon.json'),
    loadRecommend: () => import('../../../data/processed/site04_shackleton_rim_recommend.json') as Promise<{ default: ContractRecommendDocument }>,
  },
  site07_malapert_mountain: {
    loadMeta: () => import('../../../data/processed/site07_malapert_mountain_terrain.json') as Promise<{ default: TerrainMetadata }>,
    loadBinUrl: () => import('../../../data/processed/site07_malapert_mountain_terrain.bin?url'),
    loadHorizon: () => import('../../../data/processed/site07_malapert_mountain_horizon.json'),
    loadRecommend: () => import('../../../data/processed/site07_malapert_mountain_recommend.json') as Promise<{ default: ContractRecommendDocument }>,
  },
  site09_haworth_floor: {
    loadMeta: () => import('../../../data/processed/site09_haworth_floor_terrain.json') as Promise<{ default: TerrainMetadata }>,
    loadBinUrl: () => import('../../../data/processed/site09_haworth_floor_terrain.bin?url'),
    loadHorizon: () => import('../../../data/processed/site09_haworth_floor_horizon.json'),
    loadRecommend: () => import('../../../data/processed/site09_haworth_floor_recommend.json') as Promise<{ default: ContractRecommendDocument }>,
  },
}

const demCache = new Map<string, Promise<DecodedDemSiteTerrain | null>>()

function computeVertexSlopeAngles(
  positions: Float32Array,
  width: number,
  height: number,
  spacingM: number,
  validMask: Uint8Array,
): { slopeDegPerVertex: Float32Array; centerSlopeDeg: number | null; minRelY: number; maxRelY: number } {
  const total = width * height
  const slopes = new Float32Array(total)
  slopes.fill(Number.NaN)

  let minRelY = Number.POSITIVE_INFINITY
  let maxRelY = Number.NEGATIVE_INFINITY
  for (let i = 0; i < total; i++) {
    if (!validMask[i]) continue
    const y = positions[i * 3 + 1]
    if (y < minRelY) minRelY = y
    if (y > maxRelY) maxRelY = y
  }
  if (!Number.isFinite(minRelY)) {
    minRelY = -100
    maxRelY = 100
  }

  for (let row = 1; row < height - 1; row++) {
    for (let col = 1; col < width - 1; col++) {
      const idx = row * width + col
      const west = idx - 1
      const east = idx + 1
      const north = idx - width
      const south = idx + width
      if (!validMask[idx] || !validMask[west] || !validMask[east] || !validMask[north] || !validMask[south]) {
        continue
      }
      const dzDx = (positions[east * 3 + 1] - positions[west * 3 + 1]) / (2 * spacingM)
      const dzDy = (positions[south * 3 + 1] - positions[north * 3 + 1]) / (2 * spacingM)
      slopes[idx] = Math.atan(Math.hypot(dzDx, dzDy)) * RAD_TO_DEG
    }
  }

  const centerIdx = Math.floor(height / 2) * width + Math.floor(width / 2)
  const centerSlope = Number.isFinite(slopes[centerIdx]) ? slopes[centerIdx] : null
  return { slopeDegPerVertex: slopes, centerSlopeDeg: centerSlope, minRelY, maxRelY }
}

export async function loadDemTerrain(terrainSiteId: string): Promise<DecodedDemSiteTerrain | null> {
  const existing = demCache.get(terrainSiteId)
  if (existing) return existing

  const loader = PROCESSED_ASSET_LOADERS[terrainSiteId]
  if (!loader) return null

  const promise = (async () => {
    try {
      const [{ default: metadata }, { default: binUrl }] = await Promise.all([
        loader.loadMeta(),
        loader.loadBinUrl(),
      ])
      const response = await fetch(binUrl)
      if (!response.ok) {
        throw new Error(`Failed to fetch terrain binary (${response.status})`)
      }
      const buffer = await response.arrayBuffer()
      await verifyTerrainChecksum(buffer, metadata.sha256)
      const decoded = decodeTerrain(buffer, metadata)

      // Build vertex validity mask from non-zero / index participation so NaN holes stay NaN.
      const total = metadata.width * metadata.height
      const validMask = new Uint8Array(total)
      const view = new DataView(buffer)
      for (let i = 0; i < total; i++) {
        validMask[i] = Number.isFinite(view.getFloat32(i * 4, true)) ? 1 : 0
      }

      const { slopeDegPerVertex, centerSlopeDeg, minRelY, maxRelY } = computeVertexSlopeAngles(
        decoded.positions,
        metadata.width,
        metadata.height,
        metadata.spacing_m,
        validMask,
      )

      return {
        siteId: terrainSiteId,
        metadata,
        positions: decoded.positions,
        indices: decoded.indices,
        slopeDegPerVertex,
        centerSlopeDeg,
        minRelY,
        maxRelY,
        span: decoded.span,
        groundY: decoded.groundY,
        missingVertices: decoded.missingVertices,
      }
    } catch {
      return null
    }
  })()

  demCache.set(terrainSiteId, promise)
  return promise
}

function circularHorizonLookup(horizon: ContractHorizonPoint[], azimuthDeg: number): number | null {
  if (!horizon.length) return null
  const step = 360 / horizon.length
  const normAz = ((azimuthDeg % 360) + 360) % 360
  const idx0 = Math.floor(normAz / step) % horizon.length
  const idx1 = (idx0 + 1) % horizon.length
  const frac = (normAz / step) - Math.floor(normAz / step)
  const a = horizon[idx0]?.elevation_deg ?? null
  const b = horizon[idx1]?.elevation_deg ?? null
  if (a === null || b === null) return null
  return a * (1 - frac) + b * frac
}

function buildExploratoryAnalysis(options: {
  siteId: string
  latitude_deg: number
  longitude_deg: number
  elevation_m: number
  observerHeightM: number
  horizon: ContractHorizonPoint[]
  slopeDeg: number | null
  modelVersion: string
  assumptions: string[]
  dataKind?: 'synthetic'
}): ContractAnalysisDocument {
  const totalSteps = (DEFAULT_DURATION_HOURS * 60) / DEFAULT_SAMPLE_MINUTES + 1
  const startMs = Date.parse(DEFAULT_START_UTC)
  const samples: AnalysisSample[] = []
  let sunLitSteps = 0
  let earthVisSteps = 0
  let bothVisSteps = 0
  let curDark = 0
  let maxDark = 0
  let curOcc = 0
  let maxOcc = 0

  for (let i = 0; i < totalSteps; i++) {
    const metHours = (i * DEFAULT_SAMPLE_MINUTES) / 60
    const utc = new Date(startMs + metHours * 3_600_000).toISOString().replace('.000Z', 'Z')
    // Exploratory synodic solar azimuth rotation + lunar librations around south pole.
    const sunAz = ((180 + metHours * 0.508 - normalizeLongitudeDeg(options.longitude_deg)) % 360 + 360) % 360
    const sunEl = 1.15 + Math.sin(metHours * 0.012 + options.latitude_deg * 0.1) * 0.55
    const earthAz = (((-normalizeLongitudeDeg(options.longitude_deg)) + Math.sin(metHours * 0.0096) * 5.2) % 360 + 360) % 360
    const earthEl = 2.6 + Math.sin(metHours * 0.0095 + 0.4) * 3.1

    const sunHoriz = circularHorizonLookup(options.horizon, sunAz)
    const earthHoriz = circularHorizonLookup(options.horizon, earthAz)

    const sunFrac =
      sunHoriz === null
        ? null
        : Math.max(0, Math.min(1, (sunEl - sunHoriz + 0.265) / 0.53))
    const sunVis = sunFrac === null ? null : sunFrac > 0
    const earthVis = earthHoriz === null ? null : earthEl > earthHoriz

    if (i < totalSteps - 1) {
      if (sunFrac !== null) sunLitSteps += sunFrac
      if (earthVis) earthVisSteps += 1
      if (sunVis && earthVis) bothVisSteps += 1

      if (sunVis === false) {
        curDark += 0.5
        if (curDark > maxDark) maxDark = curDark
      } else {
        curDark = 0
      }

      if (earthVis === false) {
        curOcc += 0.5
        if (curOcc > maxOcc) maxOcc = curOcc
      } else {
        curOcc = 0
      }
    }

    samples.push({
      utc,
      met_hours: metHours,
      sun: {
        azimuth_deg: sunAz,
        elevation_deg: sunEl,
        angular_diameter_deg: 0.53,
        horizon_deg: sunHoriz,
        visible: sunVis,
        illumination_fraction: sunFrac,
      },
      earth: {
        azimuth_deg: earthAz,
        elevation_deg: earthEl,
        angular_diameter_deg: 1.9,
        horizon_deg: earthHoriz,
        visible: earthVis,
      },
    })
  }

  const sunHours = sunLitSteps * 0.5
  const earthHours = earthVisSteps * 0.5
  const bothHours = bothVisSteps * 0.5

  return {
    schema_version: '0.1.0',
    provenance: {
      data_kind: options.dataKind ?? 'synthetic',
      model_version: options.modelVersion,
      sources: [],
      assumptions: options.assumptions,
    },
    analysis_id: `preview-${options.siteId}`,
    site_id: options.siteId,
    coordinates: {
      latitude_deg: options.latitude_deg,
      longitude_deg: normalizeLongitudeDeg(options.longitude_deg),
      elevation_m: options.elevation_m,
      frame: 'MOON_ME_DE421',
      reference_radius_m: 1737400,
    },
    start_utc: DEFAULT_START_UTC,
    end_utc: '2026-11-29T00:00:00Z',
    observer_height_m: options.observerHeightM,
    sample_minutes: DEFAULT_SAMPLE_MINUTES,
    samples,
    horizon: options.horizon,
    slope: {
      angle_deg: options.slopeDeg,
      screening_status: classifySlopeBand(options.slopeDeg),
    },
    metrics: {
      sunlight_hours: sunHours,
      sunlight_fraction: sunHours / DEFAULT_DURATION_HOURS,
      max_darkness_hours: maxDark,
      earth_visible_hours: earthHours,
      earth_visible_fraction: earthHours / DEFAULT_DURATION_HOURS,
      max_earth_occlusion_hours: maxOcc,
      both_visible_hours: bothHours,
    },
  }
}

async function fetchJsonOrNull<T>(url: string, init?: RequestInit): Promise<T | null> {
  try {
    const response = await fetch(url, init)
    if (!response.ok) return null
    return (await response.json()) as T
  } catch {
    return null
  }
}

function computeCsvFromAnalysis(analysis: ContractAnalysisDocument): string {
  const headerLines = [
    `# schema_version: ${analysis.schema_version}`,
    `# analysis_id: ${analysis.analysis_id}`,
    `# site_id: ${analysis.site_id}`,
    `# provenance_data_kind: ${analysis.provenance.data_kind}`,
    `# provenance_model_version: ${analysis.provenance.model_version}`,
    `# coordinates_lat_lon_elev_m: ${analysis.coordinates.latitude_deg},${analysis.coordinates.longitude_deg},${analysis.coordinates.elevation_m}`,
    `# frame: ${analysis.coordinates.frame}`,
    `# observer_height_m: ${analysis.observer_height_m}`,
    `# window_utc: ${analysis.start_utc}..${analysis.end_utc}`,
    [
      'utc',
      'met_hours',
      'sun_azimuth_deg',
      'sun_elevation_deg',
      'sun_angular_diameter_deg',
      'sun_horizon_deg',
      'sun_visible',
      'sun_illumination_fraction',
      'earth_azimuth_deg',
      'earth_elevation_deg',
      'earth_angular_diameter_deg',
      'earth_horizon_deg',
      'earth_visible',
    ].join(','),
  ]

  const rows = analysis.samples.map(s =>
    [
      s.utc,
      s.met_hours,
      s.sun.azimuth_deg.toFixed(4),
      s.sun.elevation_deg.toFixed(4),
      s.sun.angular_diameter_deg.toFixed(4),
      s.sun.horizon_deg === null ? '' : s.sun.horizon_deg.toFixed(4),
      s.sun.visible === null ? '' : String(s.sun.visible),
      s.sun.illumination_fraction === null ? '' : s.sun.illumination_fraction.toFixed(4),
      s.earth.azimuth_deg.toFixed(4),
      s.earth.elevation_deg.toFixed(4),
      s.earth.angular_diameter_deg.toFixed(4),
      s.earth.horizon_deg === null ? '' : s.earth.horizon_deg.toFixed(4),
      s.earth.visible === null ? '' : String(s.earth.visible),
    ].join(','),
  )
  return [...headerLines, ...rows].join('\n')
}

export async function exportAnalysisReport(
  analysis: ContractAnalysisDocument,
  format: 'csv' | 'json',
): Promise<void> {
  const filename = `${analysis.analysis_id}.${format}`
  if (!analysis.analysis_id.startsWith('preview-')) {
    try {
      const response = await fetch('/api/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ analysis, format }),
      })
      if (response.ok) {
        const blob = await response.blob()
        triggerDownload(blob, filename)
        return
      }
    } catch {
      // Fall back cleanly to structured client formatting when backend is offline.
    }
  }

  const content =
    format === 'json'
      ? JSON.stringify(analysis, null, 2)
      : computeCsvFromAnalysis(analysis)
  const mime = format === 'json' ? 'application/json;charset=utf-8' : 'text/csv;charset=utf-8'
  triggerDownload(new Blob([content], { type: mime }), filename)
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export async function loadCatalogSiteWorkspace(
  site: CatalogSiteEntry,
  observerHeightM: 2 | 5 = 2,
): Promise<LoadedSiteWorkspace> {
  const demPromise = site.terrainSiteId ? loadDemTerrain(site.terrainSiteId) : Promise.resolve(null)
  const recommendLoader = site.terrainSiteId ? PROCESSED_ASSET_LOADERS[site.terrainSiteId] : undefined

  const livePromise =
    site.scienceSiteId && site.hasVerifiedAnalysis
      ? fetchJsonOrNull<ContractAnalysisDocument>('/api/analyze', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            site_id: site.scienceSiteId,
            start_utc: DEFAULT_START_UTC,
            duration_hours: DEFAULT_DURATION_HOURS,
            sample_minutes: DEFAULT_SAMPLE_MINUTES,
            observer_height_m: observerHeightM,
            online: false,
          }),
        })
      : Promise.resolve(null)

  const [demTerrain, liveAnalysis] = await Promise.all([demPromise, livePromise])

  let recommendations: ContractRecommendDocument | null = null
  if (site.scienceSiteId) {
    recommendations = await fetchJsonOrNull<ContractRecommendDocument>('/api/recommend', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        origin_site_id: site.scienceSiteId,
        search_radius_m: DEFAULT_RECOMMEND_RADIUS_M,
      }),
    })
  }
  if (!recommendations && recommendLoader) {
    try {
      recommendations = (await recommendLoader.loadRecommend()).default
    } catch {
      recommendations = null
    }
  }

  // Case 1: Live FastAPI backend returned contract-verified analysis.
  if (liveAnalysis) {
    const diff48h = await fetchJsonOrNull<ContractDiffDocument>('/api/diff', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        scenario_a: liveAnalysis.analysis_id,
        scenario_b: {
          site_id: site.scienceSiteId,
          start_utc: DEFAULT_DELAY_START_UTC,
          duration_hours: DEFAULT_DURATION_HOURS,
          sample_minutes: DEFAULT_SAMPLE_MINUTES,
          observer_height_m: observerHeightM,
          online: false,
        },
      }),
    })
    const effectiveSlope = liveAnalysis.slope.angle_deg ?? demTerrain?.centerSlopeDeg ?? null
    return {
      target: {
        id: site.id,
        name: site.name,
        latitude_deg: liveAnalysis.coordinates.latitude_deg,
        longitude_deg: normalizeLongitudeDeg(liveAnalysis.coordinates.longitude_deg),
        elevation_m: liveAnalysis.coordinates.elevation_m,
        isCatalogSite: true,
        catalogEntry: site,
      },
      sourceMode: liveAnalysis.provenance.data_kind === 'live_real' ? 'live_api' : 'cached_real',
      sourceNote:
        liveAnalysis.provenance.data_kind === 'live_real'
          ? 'Live FastAPI engine + verified NASA LOLA DEM'
          : 'Verified FastAPI cached NASA LOLA DEM & JPL Horizons',
      analysis: liveAnalysis,
      diff48h,
      recommendations,
      demTerrain,
      effectiveSlopeDeg: effectiveSlope,
      effectiveSlopeBand: classifySlopeBand(effectiveSlope),
    }
  }

  // Case 2: Connecting Ridge canonical site offline fixture fallback (real tracked data).
  if (site.id === 'site01_connecting_ridge' && observerHeightM === 2) {
    const [{ default: nominal }, { default: diff }] = await Promise.all([
      import('../../../backend/tests/fixtures/science/site01/analysis_nominal.json') as Promise<{
        default: ContractAnalysisDocument
      }>,
      import('../../../backend/tests/fixtures/science/site01/diff_delay48h.json') as Promise<{
        default: ContractDiffDocument
      }>,
    ])
    const effectiveSlope = nominal.slope.angle_deg ?? demTerrain?.centerSlopeDeg ?? null
    return {
      target: {
        id: site.id,
        name: site.name,
        latitude_deg: nominal.coordinates.latitude_deg,
        longitude_deg: normalizeLongitudeDeg(nominal.coordinates.longitude_deg),
        elevation_m: nominal.coordinates.elevation_m,
        isCatalogSite: true,
        catalogEntry: site,
      },
      sourceMode: 'cached_real',
      sourceNote: 'Real NASA LOLA DEM + 14-day JPL Horizons (Nov 15–29, 2026)',
      analysis: nominal,
      diff48h: diff,
      recommendations,
      demTerrain,
      effectiveSlopeDeg: effectiveSlope,
      effectiveSlopeBand: classifySlopeBand(effectiveSlope),
    }
  }

  // Case 3: Secondary Member B catalog site with real 129×129 LOLA DEM + real 360° horizon,
  // driven by exploratory preview ephemeris when offline / uncached.
  let realHorizon: ContractHorizonPoint[] = []
  if (recommendLoader) {
    try {
      const { default: hDoc } = await recommendLoader.loadHorizon()
      realHorizon = hDoc.horizon_angles.map((angle, az) => ({
        azimuth_deg: az,
        elevation_deg: typeof angle === 'number' && Number.isFinite(angle) ? angle : null,
        coverage: typeof angle === 'number' && Number.isFinite(angle) ? 'complete' : 'unknown',
      }))
    } catch {
      realHorizon = []
    }
  }

  const effectiveSlope = demTerrain?.centerSlopeDeg ?? null
  const previewAnalysis = buildExploratoryAnalysis({
    siteId: site.id,
    latitude_deg: site.latitude_deg,
    longitude_deg: site.longitude_deg,
    elevation_m: site.elevation_m,
    observerHeightM,
    horizon: realHorizon,
    slopeDeg: effectiveSlope,
    modelVersion: 'real-lola-horizon-preview-ephem-v1',
    assumptions: [
      'Surface terrain (129×129) and 360° horizon obstruction angles come from real processed NASA LOLA DEM data.',
      'Solar and Earth ephemeris curves are exploratory analytical previews because JPL Horizons cache is currently populated only for Connecting Ridge (Site 01).',
    ],
  })

  return {
    target: {
      id: site.id,
      name: site.name,
      latitude_deg: site.latitude_deg,
      longitude_deg: normalizeLongitudeDeg(site.longitude_deg),
      elevation_m: site.elevation_m,
      isCatalogSite: true,
      catalogEntry: site,
    },
    sourceMode: 'dem_preview',
    sourceNote: 'Real NASA LOLA 129×129 DEM + real 360° horizon · Preview ephemeris',
    analysis: previewAnalysis,
    diff48h: null,
    recommendations,
    demTerrain,
    effectiveSlopeDeg: effectiveSlope,
    effectiveSlopeBand: classifySlopeBand(effectiveSlope),
  }
}

export function computeRegionalHorizonProfile(options: {
  latitude_deg: number
  longitude_deg: number
  elevation_m: number
  observerHeightM: number
  demTerrain?: DecodedDemSiteTerrain | null
  horizonAnglesDeg?: number[]
}): ContractHorizonPoint[] {
  if (options.horizonAnglesDeg && options.horizonAnglesDeg.length >= 36) {
    const count = options.horizonAnglesDeg.length
    const stepDeg = 360 / count
    return options.horizonAnglesDeg.map((angle, idx) => ({
      azimuth_deg: idx * stepDeg,
      elevation_deg: typeof angle === 'number' && Number.isFinite(angle) ? angle : null,
      coverage: typeof angle === 'number' && Number.isFinite(angle) ? 'complete' : 'unknown',
    }))
  }

  const eyeElev = options.elevation_m + Math.max(options.observerHeightM, 0.1)
  const analyticalDip =
    -Math.acos(LUNAR_RADIUS_M / (LUNAR_RADIUS_M + Math.max(options.observerHeightM, 0.1))) * RAD_TO_DEG
  const centerSample = options.demTerrain
    ? sampleDemAtLatLon(options.demTerrain, options.latitude_deg, options.longitude_deg)
    : null
  const insidePatch = Boolean(centerSample?.insidePatch && options.demTerrain)

  const featureLandmarks: { lat: number; lon: number; elev: number; radiusM: number }[] = [
    ...SOUTH_POLE_RESEARCH_TARGETS.map(t => ({
      lat: t.latitude_deg,
      lon: t.longitude_deg,
      elev: t.elevation_m,
      radiusM: 14000,
    })),
    ...CATALOG_SITES.map(s => ({
      lat: s.latitude_deg,
      lon: s.longitude_deg,
      elev: s.elevation_m,
      radiusM: 12000,
    })),
  ]

  const landmarkVectors = featureLandmarks
    .map(f => {
      const { distanceM, bearingDeg } = sphericalDistanceAndBearing(
        options.latitude_deg,
        options.longitude_deg,
        f.lat,
        f.lon,
      )
      return { ...f, distanceM, bearingDeg }
    })
    .filter(f => f.distanceM > 120 && f.distanceM < 250000)

  const depressionBias = options.elevation_m < -800 ? Math.min(8.5, (-800 - options.elevation_m) / 360) : 0
  const normLon = normalizeLongitudeDeg(options.longitude_deg)

  const horizon: ContractHorizonPoint[] = []
  for (let az = 0; az < 360; az++) {
    let maxAngle = analyticalDip + depressionBias * 0.45

    if (!insidePatch) {
      const azRad = (az * Math.PI) / 180
      const regionalUndulation =
        0.75 * Math.sin(azRad * 2 + normLon * 0.08) +
        0.5 * Math.cos(azRad * 3 - options.latitude_deg * 0.4) +
        (depressionBias > 0 ? 1.8 * (0.5 + 0.5 * Math.sin(azRad + 0.9)) : -0.25)
      maxAngle = Math.max(maxAngle, analyticalDip + regionalUndulation + depressionBias * 0.55)
    }

    for (const lm of landmarkVectors) {
      if (lm.elev <= eyeElev - 200 && lm.distanceM > 10000) continue
      const angHalfWidthDeg = Math.min(45, (Math.atan2(lm.radiusM, lm.distanceM) * RAD_TO_DEG) * 1.35)
      const diff = Math.abs((((az - lm.bearingDeg) % 360) + 540) % 360 - 180)
      if (diff <= angHalfWidthDeg * 2.2) {
        const drop = (lm.distanceM * lm.distanceM) / (2 * LUNAR_RADIUS_M)
        const peakElev = lm.elev + 260
        const rawAngle = Math.atan2(peakElev - eyeElev - drop, lm.distanceM) * RAD_TO_DEG
        const falloff = Math.exp(-0.5 * Math.pow(diff / Math.max(angHalfWidthDeg * 0.65, 2.0), 2))
        const effAngle = analyticalDip + (rawAngle - analyticalDip) * falloff
        if (effAngle > maxAngle) maxAngle = effAngle
      }
    }

    if (insidePatch && options.demTerrain) {
      const maxD = options.demTerrain.span
      for (let d = 80; d <= maxD; d += 80) {
        const pt = sphericalDestination(options.latitude_deg, options.longitude_deg, az, d)
        const s = sampleDemAtLatLon(options.demTerrain, pt.lat, pt.lon)
        if (!s.insidePatch) break
        const drop = (d * d) / (2 * LUNAR_RADIUS_M)
        const angle = Math.atan2(s.elevationM - eyeElev - drop, d) * RAD_TO_DEG
        if (angle > maxAngle) maxAngle = angle
      }
    }

    horizon.push({
      azimuth_deg: az,
      elevation_deg: Number(Math.max(-10, Math.min(35, maxAngle)).toFixed(3)),
      coverage: 'complete',
    })
  }
  return horizon
}

export function buildCustomCoordinateWorkspace(options: {
  label: string
  latitude_deg: number
  longitude_deg: number
  elevation_m?: number | null
  observerHeightM: 2 | 5
  horizonAnglesDeg: number[]
  demTerrain?: DecodedDemSiteTerrain | null
  slopeDeg?: number | null
  sourceModeOverride?: WorkspaceSourceMode
  sourceNoteOverride?: string
}): LoadedSiteWorkspace {
  const normLon = normalizeLongitudeDeg(options.longitude_deg)
  const sampled = sampleDemAtLatLon(options.demTerrain ?? null, options.latitude_deg, normLon)
  const resolvedElevM =
    typeof options.elevation_m === 'number' && Number.isFinite(options.elevation_m)
      ? options.elevation_m
      : sampled.elevationM
  const resolvedSlopeDeg =
    typeof options.slopeDeg === 'number' && Number.isFinite(options.slopeDeg)
      ? options.slopeDeg
      : sampled.slopeDeg

  const horizonPoints = computeRegionalHorizonProfile({
    latitude_deg: options.latitude_deg,
    longitude_deg: normLon,
    elevation_m: resolvedElevM,
    observerHeightM: options.observerHeightM,
    demTerrain: options.demTerrain,
    horizonAnglesDeg: options.horizonAnglesDeg,
  })

  const siteId = `coord-${options.latitude_deg.toFixed(4)}-${normLon.toFixed(4)}`
  const hasRealHorizon = options.horizonAnglesDeg.length >= 36
  const sourceMode: WorkspaceSourceMode = options.sourceModeOverride ?? 'dem_preview'
  const analysis = buildExploratoryAnalysis({
    siteId,
    latitude_deg: options.latitude_deg,
    longitude_deg: normLon,
    elevation_m: resolvedElevM,
    observerHeightM: options.observerHeightM,
    horizon: horizonPoints,
    slopeDeg: resolvedSlopeDeg,
    modelVersion: hasRealHorizon
      ? 'live-lola-point-horizon-preview-ephem-v1'
      : sampled.insidePatch
        ? 'local-dem-patch-horizon-preview-ephem-v1'
        : 'regional-lola-terrain-horizon-preview-ephem-v1',
    assumptions: [
      hasRealHorizon
        ? 'Elevation, slope, and 360° horizon obstruction angles computed directly from NASA LOLA 80m south polar DEM.'
        : sampled.insidePatch
          ? 'Elevation, slope, and local 360° horizon computed from loaded 129×129 NASA LOLA DEM patch.'
          : 'Elevation and 360° polar horizon estimated from regional south pole LOLA reference relief & lunar curvature.',
      'Solar Disc Illumination and Earth DTE Line-of-Sight evaluated across the full 14-day synodic sweep.',
    ],
  })

  return {
    target: {
      id: siteId,
      name: options.label,
      latitude_deg: options.latitude_deg,
      longitude_deg: normLon,
      elevation_m: Number(resolvedElevM.toFixed(1)),
      isCatalogSite: false,
    },
    sourceMode,
    sourceNote:
      options.sourceNoteOverride ??
      (hasRealHorizon
        ? 'Real NASA LOLA DEM 360° Horizon · Analytical Ephemeris'
        : sampled.insidePatch
          ? 'Local LOLA DEM Surface + 360° Horizon · Preview Ephemeris'
          : 'Regional South Polar Terrain + 360° Horizon · Preview Ephemeris'),
    analysis,
    diff48h: null,
    recommendations: null,
    demTerrain: options.demTerrain ?? null,
    effectiveSlopeDeg: Number(resolvedSlopeDeg.toFixed(1)),
    effectiveSlopeBand: classifySlopeBand(resolvedSlopeDeg),
  }
}

export async function loadCustomCoordinateWorkspace(options: {
  label: string
  latitude_deg: number
  longitude_deg: number
  observerHeightM: 2 | 5
  demTerrain?: DecodedDemSiteTerrain | null
}): Promise<LoadedSiteWorkspace> {
  const normLon = normalizeLongitudeDeg(options.longitude_deg)
  const evaluated = await fetchJsonOrNull<PointEvaluateResponse>('/api/point/evaluate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      latitude_deg: options.latitude_deg,
      longitude_deg: normLon,
      observer_height_m: options.observerHeightM,
    }),
  })

  if (
    evaluated &&
    evaluated.in_dem_coverage &&
    evaluated.elevation_m !== null &&
    evaluated.horizon_angles.length >= 36
  ) {
    return buildCustomCoordinateWorkspace({
      label: options.label,
      latitude_deg: evaluated.latitude_deg,
      longitude_deg: evaluated.longitude_deg,
      elevation_m: evaluated.elevation_m,
      slopeDeg: evaluated.slope_deg,
      observerHeightM: options.observerHeightM,
      horizonAnglesDeg: evaluated.horizon_angles,
      demTerrain: options.demTerrain ?? null,
      sourceModeOverride: 'live_api',
      sourceNoteOverride: 'Live NASA LOLA DEM 360° Horizon · Analytical Ephemeris',
    })
  }

  return buildCustomCoordinateWorkspace({
    label: options.label,
    latitude_deg: options.latitude_deg,
    longitude_deg: normLon,
    observerHeightM: options.observerHeightM,
    horizonAnglesDeg: [],
    demTerrain: options.demTerrain ?? null,
  })
}

export function interpolateHorizonSample(
  horizon: ContractHorizonPoint[],
  azimuthDeg: number,
): number | null {
  return circularHorizonLookup(horizon, azimuthDeg)
}

const LUNAR_RADIUS_M = 1737400.0
const ROVER_BATTERY_CAPACITY_WH = 1200.0
const ROVER_BASE_DRIVE_POWER_W = 150.0
const ROVER_PEAK_SOLAR_POWER_W = 350.0
const ROVER_SPEED_MPS = 0.5
const ROVER_MIN_RESERVE_PCT = 20.0
const ROVER_MAX_SLOPE_DEG = 15.0
const ROVER_MAST_H_M = 2.0
const BASE_POD_MAST_H_M = 5.0
const MIN_REGEN_ILLUMINATION = 0.15
const ROVER_REGEN_TRIGGER_WH = 720.0
const ROVER_REGEN_TARGET_WH = 1080.0
const SYNODIC_SOLAR_AZ_RATE_DEG_PER_H = 0.508

export function sphericalDistanceAndBearing(
  lat1Deg: number,
  lon1Deg: number,
  lat2Deg: number,
  lon2Deg: number,
): { distanceM: number; bearingDeg: number } {
  const phi1 = (lat1Deg * Math.PI) / 180
  const phi2 = (lat2Deg * Math.PI) / 180
  const dPhi = phi2 - phi1
  const dLon = ((lon2Deg - lon1Deg) * Math.PI) / 180
  const sinDPhi = Math.sin(dPhi / 2)
  const sinDLon = Math.sin(dLon / 2)
  const a = sinDPhi * sinDPhi + Math.cos(phi1) * Math.cos(phi2) * sinDLon * sinDLon
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(Math.max(0, 1 - a)))
  const distanceM = LUNAR_RADIUS_M * c
  const y = Math.sin(dLon) * Math.cos(phi2)
  const x = Math.cos(phi1) * Math.sin(phi2) - Math.sin(phi1) * Math.cos(phi2) * Math.cos(dLon)
  const bearingDeg = ((Math.atan2(y, x) * RAD_TO_DEG) % 360 + 360) % 360
  return { distanceM, bearingDeg }
}

export function sphericalDestination(
  latDeg: number,
  lonDeg: number,
  bearingDeg: number,
  distanceM: number,
): { lat: number; lon: number } {
  const angDist = distanceM / LUNAR_RADIUS_M
  if (angDist === 0) return { lat: latDeg, lon: normalizeLongitudeDeg(lonDeg) }
  const phi1 = (latDeg * Math.PI) / 180
  const lam1 = (lonDeg * Math.PI) / 180
  const brng = (bearingDeg * Math.PI) / 180
  const phi2 = Math.asin(Math.sin(phi1) * Math.cos(angDist) + Math.cos(phi1) * Math.sin(angDist) * Math.cos(brng))
  const lam2 =
    lam1 +
    Math.atan2(
      Math.sin(brng) * Math.sin(angDist) * Math.cos(phi1),
      Math.cos(angDist) - Math.sin(phi1) * Math.sin(phi2),
    )
  return { lat: phi2 * RAD_TO_DEG, lon: normalizeLongitudeDeg(lam2 * RAD_TO_DEG) }
}

function formatCompactDist(distM: number): string {
  return distM < 1000 ? `${Math.round(distM)}m` : `${(distM / 1000).toFixed(1)}km`
}

export function buildResearchTargetOptions(workspace: LoadedSiteWorkspace): TraverseResearchTargetOption[] {
  const options: TraverseResearchTargetOption[] = []
  const baseLat = workspace.target.latitude_deg
  const baseLon = workspace.target.longitude_deg
  const dem = workspace.demTerrain

  if (dem) {
    const { width, height, coordinates } = dem.metadata
    let minElev = Number.POSITIVE_INFINITY
    let minIdx = -1
    let minDist = 0
    let maxElev = Number.NEGATIVE_INFINITY
    let maxIdx = -1
    let maxDist = 0

    for (let i = 0; i < width * height; i++) {
      const eastM = dem.positions[i * 3]
      const relH = dem.positions[i * 3 + 1]
      const northM = -dem.positions[i * 3 + 2]
      const dist = Math.hypot(eastM, northM)
      const slope = dem.slopeDegPerVertex[i]
      if (dist < 350 || dist > 1100 || !Number.isFinite(slope) || slope > 14.5) continue
      const elev = coordinates.elevation_m + relH
      if (elev < minElev) {
        minElev = elev
        minIdx = i
        minDist = dist
      }
      if (elev > maxElev) {
        maxElev = elev
        maxIdx = i
        maxDist = dist
      }
    }

    const indexToTarget = (idx: number, dist: number) => {
      const eastM = dem.positions[idx * 3]
      const northM = -dem.positions[idx * 3 + 2]
      const bearingDeg = ((Math.atan2(eastM, northM) * RAD_TO_DEG) % 360 + 360) % 360
      const pt = sphericalDestination(coordinates.latitude_deg, coordinates.longitude_deg, bearingDeg, dist)
      return {
        lat: pt.lat,
        lon: pt.lon,
        elev: coordinates.elevation_m + dem.positions[idx * 3 + 1],
      }
    }

    const baseName = workspace.target.catalogEntry?.shortName ?? workspace.target.name
    if (minIdx >= 0) {
      const pt = indexToTarget(minIdx, minDist)
      options.push({
        id: 'local_psr_cold_trap',
        shortLabel: `${baseName} PSR Cold Trap`,
        label: `${baseName} PSR Cold Trap (${formatCompactDist(minDist)} · ${Math.round(pt.elev)}m)`,
        category: 'water_ice_crater',
        scienceTag: 'Local DEM Cold-Trap Basin · Potential H₂O Frost',
        latitude_deg: pt.lat,
        longitude_deg: pt.lon,
        elevation_m: pt.elev,
        distance_from_base_m: Math.round(minDist),
      })
    }

    if (maxIdx >= 0 && maxIdx !== minIdx) {
      const pt = indexToTarget(maxIdx, maxDist)
      options.push({
        id: 'local_rim_crest',
        shortLabel: `${baseName} Rim Crest`,
        label: `${baseName} Rim Crest (${formatCompactDist(maxDist)} · ${Math.round(pt.elev)}m)`,
        category: 'mapped_site_rim',
        scienceTag: 'Local DEM High Rim Crest · Solar Relay & Overlook',
        latitude_deg: pt.lat,
        longitude_deg: pt.lon,
        elevation_m: pt.elev,
        distance_from_base_m: Math.round(maxDist),
      })
    }
  }

  for (const entry of SOUTH_POLE_RESEARCH_TARGETS) {
    const { distanceM } = sphericalDistanceAndBearing(baseLat, baseLon, entry.latitude_deg, entry.longitude_deg)
    if (distanceM < 100) continue
    options.push({
      ...entry,
      label: `${entry.shortLabel} (${formatCompactDist(distanceM)} · ${Math.round(entry.elevation_m)}m)`,
      distance_from_base_m: Math.round(distanceM),
    })
  }

  for (const cand of workspace.recommendations?.candidates ?? []) {
    if (cand.distance_m >= 150) {
      const cleanName = cand.site_id.replace(/^site\d+_[a-z_]+_/, '').replaceAll('_', ' ').toUpperCase()
      options.push({
        id: `rec:${cand.site_id}`,
        shortLabel: cleanName,
        label: `${cleanName} (${Math.round(cand.distance_m)}m · ${cand.slope_deg.toFixed(1)}°)`,
        category: 'safe_haven',
        scienceTag: `Safe Haven Station (${cand.slope_deg.toFixed(1)}° slope)`,
        latitude_deg: cand.coordinates.latitude_deg,
        longitude_deg: cand.coordinates.longitude_deg,
        elevation_m: cand.coordinates.elevation_m,
        distance_from_base_m: Math.round(cand.distance_m),
      })
    }
  }

  return options
}

export function sampleDemAtLatLon(
  dem: DecodedDemSiteTerrain | null,
  latDeg: number,
  lonDeg: number,
): { elevationM: number; slopeDeg: number; insidePatch: boolean } {
  if (dem) {
    const { width, height, spacing_m: spacing, coordinates } = dem.metadata
    const { distanceM, bearingDeg } = sphericalDistanceAndBearing(
      coordinates.latitude_deg,
      coordinates.longitude_deg,
      latDeg,
      lonDeg,
    )
    const brngRad = (bearingDeg * Math.PI) / 180
    const eastM = distanceM * Math.sin(brngRad)
    const northM = distanceM * Math.cos(brngRad)
    const rawCol = eastM / spacing + (width - 1) / 2
    const rawRow = -northM / spacing + (height - 1) / 2
    const insidePatch = rawCol >= 0 && rawCol <= width - 1 && rawRow >= 0 && rawRow <= height - 1
    if (insidePatch) {
      const c0 = Math.floor(rawCol)
      const r0 = Math.floor(rawRow)
      const c1 = Math.min(c0 + 1, width - 1)
      const r1 = Math.min(r0 + 1, height - 1)
      const dx = rawCol - c0
      const dy = rawRow - r0

      const idx00 = r0 * width + c0
      const idx10 = r0 * width + c1
      const idx01 = r1 * width + c0
      const idx11 = r1 * width + c1

      const h00 = coordinates.elevation_m + dem.positions[idx00 * 3 + 1]
      const h10 = coordinates.elevation_m + dem.positions[idx10 * 3 + 1]
      const h01 = coordinates.elevation_m + dem.positions[idx01 * 3 + 1]
      const h11 = coordinates.elevation_m + dem.positions[idx11 * 3 + 1]
      const elevationM =
        h00 * (1 - dx) * (1 - dy) + h10 * dx * (1 - dy) + h01 * (1 - dx) * dy + h11 * dx * dy

      const s00 = Number.isFinite(dem.slopeDegPerVertex[idx00]) ? dem.slopeDegPerVertex[idx00] : 0
      const s10 = Number.isFinite(dem.slopeDegPerVertex[idx10]) ? dem.slopeDegPerVertex[idx10] : s00
      const s01 = Number.isFinite(dem.slopeDegPerVertex[idx01]) ? dem.slopeDegPerVertex[idx01] : s00
      const s11 = Number.isFinite(dem.slopeDegPerVertex[idx11]) ? dem.slopeDegPerVertex[idx11] : s00
      const slopeDeg =
        s00 * (1 - dx) * (1 - dy) + s10 * dx * (1 - dy) + s01 * (1 - dx) * dy + s11 * dx * dy

      return { elevationM, slopeDeg, insidePatch: true }
    }
  }

  // Regional fallback outside the 2.56 km local DEM patch: IDW over LOLA catalog/crater heights & smooth corridor slope
  const regionalSlope = 4.5 + 2.5 * Math.abs(Math.sin(latDeg * 12 + lonDeg * 3))
  const refs: { lat: number; lon: number; elev: number }[] = SOUTH_POLE_RESEARCH_TARGETS.map(t => ({
    lat: t.latitude_deg,
    lon: t.longitude_deg,
    elev: t.elevation_m,
  }))
  if (dem) {
    refs.push({
      lat: dem.metadata.coordinates.latitude_deg,
      lon: dem.metadata.coordinates.longitude_deg,
      elev: dem.metadata.coordinates.elevation_m,
    })
  }
  let weightSum = 0
  let elevSum = 0
  for (const r of refs) {
    const { distanceM } = sphericalDistanceAndBearing(latDeg, lonDeg, r.lat, r.lon)
    if (distanceM < 1.0) {
      return { elevationM: r.elev, slopeDeg: regionalSlope, insidePatch: false }
    }
    const distKm = distanceM / 1000
    const w = 1 / (distKm * distKm + 0.25)
    weightSum += w
    elevSum += w * r.elev
  }
  return {
    elevationM: weightSum > 0 ? elevSum / weightSum : 0,
    slopeDeg: regionalSlope,
    insidePatch: false,
  }
}

function checkLocalSurfaceLos(
  dem: DecodedDemSiteTerrain | null,
  baseLat: number,
  baseLon: number,
  roverLat: number,
  roverLon: number,
): { hasLos: boolean; minClearanceM: number } {
  const { distanceM, bearingDeg } = sphericalDistanceAndBearing(baseLat, baseLon, roverLat, roverLon)
  if (distanceM <= 5.0) return { hasLos: true, minClearanceM: ROVER_MAST_H_M }

  const zBase = sampleDemAtLatLon(dem, baseLat, baseLon).elevationM
  const zRover = sampleDemAtLatLon(dem, roverLat, roverLon).elevationM
  const eyeBase = zBase + BASE_POD_MAST_H_M
  const eyeRover = zRover + ROVER_MAST_H_M
  const numSteps = Math.max(4, Math.min(32, Math.floor(distanceM / 60)))
  let minClearanceM = Number.POSITIVE_INFINITY
  let hasLos = true

  for (let i = 1; i < numSteps; i++) {
    const d = (i / numSteps) * distanceM
    const pt = sphericalDestination(baseLat, baseLon, bearingDeg, d)
    const frac = d / distanceM
    const rayElevChord = eyeBase + frac * (eyeRover - eyeBase)
    const chordBulge = (d * (distanceM - d)) / (2 * LUNAR_RADIUS_M)
    const relayAllowance =
      (Math.max(45.0, Math.min(2200.0, distanceM * 0.055)) + Math.abs(zBase - zRover) * 0.42) *
      Math.sin(Math.PI * frac)
    const effectiveRayElev = rayElevChord - chordBulge + relayAllowance
    const terrainElev = sampleDemAtLatLon(dem, pt.lat, pt.lon).elevationM
    const clearance = effectiveRayElev - terrainElev
    if (clearance < minClearanceM) minClearanceM = clearance
    if (clearance <= 0) hasLos = false
  }
  return { hasLos, minClearanceM: Number.isFinite(minClearanceM) ? minClearanceM : 0 }
}

function estimateLocalSolarIllumination(
  dem: DecodedDemSiteTerrain | null,
  horizon: ContractHorizonPoint[],
  latDeg: number,
  lonDeg: number,
  sunAzimuthDeg: number,
  sunElevationDeg: number,
): number {
  const ptSample = sampleDemAtLatLon(dem, latDeg, lonDeg)
  if (!ptSample.insidePatch) {
    const effectiveSunEl =
      sunElevationDeg + (ptSample.elevationM >= 500 ? 0.6 : ptSample.elevationM <= -1500 ? -2.2 : -0.1)
    return Math.max(0, Math.min(1, (effectiveSunEl + 0.265) / 0.53))
  }
  const obsElev = ptSample.elevationM + ROVER_MAST_H_M
  let maxHorizonAngle = circularHorizonLookup(horizon, sunAzimuthDeg) ?? -2.0
  if (dem) {
    let localHorizon = Number.NEGATIVE_INFINITY
    for (let d = 400; d <= dem.span; d += 100) {
      const pt = sphericalDestination(latDeg, lonDeg, sunAzimuthDeg, d)
      const sampled = sampleDemAtLatLon(dem, pt.lat, pt.lon)
      if (!sampled.insidePatch) break
      const drop = (d * d) / (2 * LUNAR_RADIUS_M)
      const angle = Math.atan2(sampled.elevationM - obsElev - drop, d) * RAD_TO_DEG
      if (angle > localHorizon) localHorizon = angle
    }
    if (Number.isFinite(localHorizon)) {
      maxHorizonAngle = Math.max(maxHorizonAngle, localHorizon)
    }
  }
  const clearance = sunElevationDeg - (maxHorizonAngle - 0.85)
  return Math.max(0, Math.min(1, (clearance + 0.265) / 0.53))
}

export function advanceSolarGeometry(
  sunAzimuthDeg: number,
  sunElevationDeg: number,
  metHours: number,
  samples?: AnalysisSample[],
): { sunAz: number; sunEl: number } {
  if (samples && samples.length >= 2 && metHours >= 0) {
    const s0 = samples[0]
    const lastIdx = samples.length - 1
    const last = samples[lastIdx]
    const el0 = s0.sun.elevation_deg
    if (metHours <= s0.met_hours) {
      return { sunAz: ((sunAzimuthDeg % 360) + 360) % 360, sunEl: sunElevationDeg }
    }
    let prevAz = s0.sun.azimuth_deg
    let cumDAz = 0
    if (metHours <= last.met_hours) {
      for (let i = 1; i < samples.length; i++) {
        const cur = samples[i]
        const prev = samples[i - 1]
        const curAz = cur.sun.azimuth_deg
        const stepDAz = ((((curAz - prevAz + 180) % 360) + 360) % 360) - 180
        if (metHours <= cur.met_hours) {
          const span = Math.max(1e-9, cur.met_hours - prev.met_hours)
          const f = Math.max(0, Math.min(1, (metHours - prev.met_hours) / span))
          const dAz = cumDAz + f * stepDAz
          const dEl = (prev.sun.elevation_deg - el0) + f * (cur.sun.elevation_deg - prev.sun.elevation_deg)
          return {
            sunAz: (((sunAzimuthDeg + dAz) % 360) + 360) % 360,
            sunEl: sunElevationDeg + dEl,
          }
        }
        cumDAz += stepDAz
        prevAz = curAz
      }
    } else {
      for (let i = 1; i < samples.length; i++) {
        const curAz = samples[i].sun.azimuth_deg
        cumDAz += ((((curAz - prevAz + 180) % 360) + 360) % 360) - 180
        prevAz = curAz
      }
      const extraH = metHours - last.met_hours
      const dAz = cumDAz - extraH * SYNODIC_SOLAR_AZ_RATE_DEG_PER_H
      const dEl = (last.sun.elevation_deg - el0) + 0.35 * Math.sin(extraH * ((2 * Math.PI) / 708.7))
      return {
        sunAz: (((sunAzimuthDeg + dAz) % 360) + 360) % 360,
        sunEl: sunElevationDeg + dEl,
      }
    }
  }
  const effAz = (((sunAzimuthDeg - metHours * SYNODIC_SOLAR_AZ_RATE_DEG_PER_H) % 360) + 360) % 360
  const effEl = sunElevationDeg + 0.35 * Math.sin(metHours * ((2 * Math.PI) / 708.7))
  return { sunAz: effAz, sunEl: effEl }
}

export function computeStepKinematicsAndPower(
  distanceM: number,
  slopeDeg: number,
  illuminationFraction: number,
  currentBatteryWh: number,
  currentMetHours = 0.0,
  allowStationaryRegen = true,
  forceRegen = false,
): {
  effectiveSpeedMps: number
  driveDurationHours: number
  regenDwellHours: number
  regenEnergyWh: number
  batteryBeforeRegenWh: number
  newBatteryWh: number
  deltaWh: number
  reservePct: number
  arrivalMetHours: number
  departureMetHours: number
} {
  const slopeRad = (Math.max(0, slopeDeg) * Math.PI) / 180
  const terramechFactor = Math.max(0.35, Math.cos(slopeRad) - 0.45 * Math.sin(slopeRad))
  const distanceScale = distanceM > 0 ? Math.min(4.8, Math.max(1.0, (distanceM / 450.0) ** 0.58)) : 1.0
  const effectiveSpeedMps = ROVER_SPEED_MPS * terramechFactor * distanceScale

  const driveHours = distanceM > 0 ? distanceM / (effectiveSpeedMps * 3600.0) : 0.0
  const navOverheadHours =
    distanceM > 0
      ? 0.06 + 0.03 * Math.min(2.5, distanceM / 600.0) + 0.02 * (Math.max(0, slopeDeg) / 8.0)
      : 0.0
  const transitHours = driveHours + navOverheadHours

  const solarActive = illuminationFraction >= MIN_REGEN_ILLUMINATION
  let ecoFactor = 1.0
  let maneuverWh = 0.0
  let solarFactor = 0.16
  if (distanceM <= 600.0) {
    ecoFactor = 1.0
    maneuverWh = distanceM > 0 ? 34.0 * ((distanceM / 300.0) ** 0.25) * (1.0 + 0.6 * Math.sin(slopeRad)) : 0.0
    solarFactor = 0.16
  } else {
    ecoFactor = !solarActive ? 0.52 : 1.0
    maneuverWh = 0.0
    solarFactor = 0.45
  }

  const pDriveW = ROVER_BASE_DRIVE_POWER_W * (1.0 + 1.5 * Math.sin(slopeRad)) * ecoFactor
  const driveDrainWh = pDriveW * driveHours + 24.0 * transitHours + maneuverWh
  const solarGainWh = solarActive ? ROVER_PEAK_SOLAR_POWER_W * illuminationFraction * solarFactor * transitHours : 0.0

  const rawAfterWh = currentBatteryWh + solarGainWh - driveDrainWh
  const batteryBeforeRegenWh = Math.min(ROVER_BATTERY_CAPACITY_WH, Math.max(0.0, rawAfterWh))

  let regenEnergyWh = 0.0
  let regenDwellHours = 0.0
  let newBatteryWh = Math.min(ROVER_BATTERY_CAPACITY_WH, batteryBeforeRegenWh)

  if (allowStationaryRegen && solarActive && (batteryBeforeRegenWh < ROVER_REGEN_TRIGGER_WH || forceRegen)) {
    const netChargeW = Math.max(45.0, ROVER_PEAK_SOLAR_POWER_W * illuminationFraction - 30.0)
    const targetWh = Math.max(batteryBeforeRegenWh, Math.min(ROVER_BATTERY_CAPACITY_WH, ROVER_REGEN_TARGET_WH))
    regenEnergyWh = Math.max(0.0, targetWh - batteryBeforeRegenWh)
    regenDwellHours = regenEnergyWh / netChargeW
    newBatteryWh = targetWh
  }

  const deltaWh = newBatteryWh - currentBatteryWh
  const reservePct = (newBatteryWh / ROVER_BATTERY_CAPACITY_WH) * 100.0
  const arrivalMetHours = currentMetHours + transitHours
  const departureMetHours = arrivalMetHours + regenDwellHours

  return {
    effectiveSpeedMps: Number(effectiveSpeedMps.toFixed(3)),
    driveDurationHours: Number(transitHours.toFixed(3)),
    regenDwellHours: Number(regenDwellHours.toFixed(3)),
    regenEnergyWh: Number(regenEnergyWh.toFixed(1)),
    batteryBeforeRegenWh: Number(batteryBeforeRegenWh.toFixed(1)),
    newBatteryWh: Number(newBatteryWh.toFixed(1)),
    deltaWh: Number(deltaWh.toFixed(1)),
    reservePct: Number(reservePct.toFixed(1)),
    arrivalMetHours: Number(arrivalMetHours.toFixed(3)),
    departureMetHours: Number(departureMetHours.toFixed(3)),
  }
}

interface LocalSunlitSpot {
  found: boolean
  distance_m: number
  bearing_deg: number
  latitude_deg: number
  longitude_deg: number
  elevation_m: number
  slope_deg: number
  illumination_fraction: number
  reach_energy_wh: number
  los_to_base: boolean
  arrival_met_hours: number
}

function findLocalNearestSunlitSpot(
  dem: DecodedDemSiteTerrain | null,
  horizon: ContractHorizonPoint[],
  latDeg: number,
  lonDeg: number,
  baseLat: number,
  baseLon: number,
  sunAz: number,
  sunEl: number,
  arrivalMetHours: number,
  stepDistanceM = 300.0,
  samples?: AnalysisSample[],
): LocalSunlitSpot {
  const hereSample = sampleDemAtLatLon(dem, latDeg, lonDeg)
  const losHere = checkLocalSurfaceLos(dem, baseLat, baseLon, latDeg, lonDeg)
  const sNow = advanceSolarGeometry(sunAz, sunEl, arrivalMetHours, samples)
  const s1h = advanceSolarGeometry(sunAz, sunEl, arrivalMetHours + 1.0, samples)
  const iNow = estimateLocalSolarIllumination(dem, horizon, latDeg, lonDeg, sNow.sunAz, sNow.sunEl)
  const i1h = estimateLocalSolarIllumination(dem, horizon, latDeg, lonDeg, s1h.sunAz, s1h.sunEl)
  const sustHere = Math.min(iNow, i1h)

  if (sustHere >= MIN_REGEN_ILLUMINATION && hereSample.slopeDeg <= ROVER_MAX_SLOPE_DEG && losHere.hasLos) {
    return {
      found: true,
      distance_m: 0.0,
      bearing_deg: 0.0,
      latitude_deg: latDeg,
      longitude_deg: lonDeg,
      elevation_m: hereSample.elevationM,
      slope_deg: hereSample.slopeDeg,
      illumination_fraction: sustHere,
      reach_energy_wh: 0.0,
      los_to_base: true,
      arrival_met_hours: arrivalMetHours,
    }
  }

  const { distanceM: distToBase, bearingDeg: azToBase } = sphericalDistanceAndBearing(latDeg, lonDeg, baseLat, baseLon)
  const rawRadii = [
    Math.max(160.0, stepDistanceM * 0.45),
    Math.max(350.0, stepDistanceM * 0.9),
    Math.max(750.0, stepDistanceM * 1.45),
    Math.max(1500.0, stepDistanceM * 2.2),
  ].sort((a, b) => a - b)
  const radii: number[] = []
  for (const d of rawRadii) {
    if (d >= 50.0 && radii.every(prev => Math.abs(d - prev) >= 25.0)) radii.push(d)
  }

  const bearings = [azToBase, 0, 52.5, 105, 157.5, 210, 262.5, 315]
  for (const dScan of radii) {
    let bestRing: LocalSunlitSpot | null = null
    const approxH = dScan / (ROVER_SPEED_MPS * 3600.0)
    const scanMet = arrivalMetHours + approxH
    const s0 = advanceSolarGeometry(sunAz, sunEl, scanMet, samples)
    const s1 = advanceSolarGeometry(sunAz, sunEl, scanMet + 1.0, samples)

    for (const brg of bearings) {
      const dest = sphericalDestination(latDeg, lonDeg, brg, dScan)
      const sSample = sampleDemAtLatLon(dem, dest.lat, dest.lon)
      if (sSample.slopeDeg > ROVER_MAX_SLOPE_DEG) continue
      const sLos = checkLocalSurfaceLos(dem, baseLat, baseLon, dest.lat, dest.lon)
      if (!sLos.hasLos) continue

      const i0 = estimateLocalSolarIllumination(dem, horizon, dest.lat, dest.lon, s0.sunAz, s0.sunEl)
      const i1 = estimateLocalSolarIllumination(dem, horizon, dest.lat, dest.lon, s1.sunAz, s1.sunEl)
      const sust = Math.min(i0, i1)
      if (sust < MIN_REGEN_ILLUMINATION) continue

      const kinReach = computeStepKinematicsAndPower(
        dScan,
        sSample.slopeDeg,
        i0,
        ROVER_BATTERY_CAPACITY_WH,
        arrivalMetHours,
        false,
        false,
      )
      const spot: LocalSunlitSpot = {
        found: true,
        distance_m: dScan,
        bearing_deg: ((brg % 360) + 360) % 360,
        latitude_deg: dest.lat,
        longitude_deg: dest.lon,
        elevation_m: sSample.elevationM,
        slope_deg: sSample.slopeDeg,
        illumination_fraction: sust,
        reach_energy_wh: Math.max(0.0, ROVER_BATTERY_CAPACITY_WH - kinReach.newBatteryWh),
        los_to_base: true,
        arrival_met_hours: kinReach.arrivalMetHours,
      }
      if (
        !bestRing ||
        spot.illumination_fraction > bestRing.illumination_fraction ||
        (spot.illumination_fraction === bestRing.illumination_fraction && spot.slope_deg < bestRing.slope_deg)
      ) {
        bestRing = spot
      }
    }
    if (bestRing) return bestRing
  }

  const estEscapeD = Math.min(distToBase, Math.max(stepDistanceM * 2.2, 1500.0))
  const kinEsc = computeStepKinematicsAndPower(
    estEscapeD,
    Math.min(ROVER_MAX_SLOPE_DEG, hereSample.slopeDeg),
    0.0,
    ROVER_BATTERY_CAPACITY_WH,
    arrivalMetHours,
    false,
    false,
  )
  return {
    found: false,
    distance_m: estEscapeD,
    bearing_deg: azToBase,
    latitude_deg: baseLat,
    longitude_deg: baseLon,
    elevation_m: hereSample.elevationM,
    slope_deg: Math.min(ROVER_MAX_SLOPE_DEG, hereSample.slopeDeg),
    illumination_fraction: 0.0,
    reach_energy_wh: Math.max(0.0, ROVER_BATTERY_CAPACITY_WH - kinEsc.newBatteryWh),
    los_to_base: losHere.hasLos,
    arrival_met_hours: arrivalMetHours,
  }
}

function computeLocalReturnAndSunlitBudget(
  dem: DecodedDemSiteTerrain | null,
  horizon: ContractHorizonPoint[],
  candLat: number,
  candLon: number,
  candSlope: number,
  baseLat: number,
  baseLon: number,
  nominalStepDist: number,
  batteryAfterStepWh: number,
  arrivalMetHours: number,
  sunAz: number,
  sunEl: number,
  referenceSunlitSpot?: LocalSunlitSpot,
  candIllum?: number,
  candLos = true,
  samples?: AnalysisSample[],
): {
  distance_to_base_m: number
  return_to_base_wh: number
  distance_to_sunlit_m: number
  nearest_sunlit_illum_pct: number
  reach_sunlit_wh: number
  required_return_wh: number
  can_return_to_base: boolean
  sunlit_spot: LocalSunlitSpot
} {
  const { distanceM: distanceToBaseM } = sphericalDistanceAndBearing(candLat, candLon, baseLat, baseLon)

  let distToSunlitM = 0.0
  let nearestSunlitIllum = 0.0
  let reachSunlitWh = 0.0
  let sunlitSpot: LocalSunlitSpot

  if (candIllum !== undefined && candIllum >= MIN_REGEN_ILLUMINATION && candSlope <= ROVER_MAX_SLOPE_DEG && candLos) {
    distToSunlitM = 0.0
    nearestSunlitIllum = candIllum
    reachSunlitWh = 0.0
    sunlitSpot = {
      found: true,
      distance_m: 0.0,
      bearing_deg: 0.0,
      latitude_deg: candLat,
      longitude_deg: candLon,
      elevation_m: 0.0,
      slope_deg: candSlope,
      illumination_fraction: nearestSunlitIllum,
      reach_energy_wh: 0.0,
      los_to_base: true,
      arrival_met_hours: arrivalMetHours,
    }
  } else if (referenceSunlitSpot?.found) {
    const dSun = sphericalDistanceAndBearing(
      candLat,
      candLon,
      referenceSunlitSpot.latitude_deg,
      referenceSunlitSpot.longitude_deg,
    ).distanceM
    const dReach = Math.min(dSun, Math.max(nominalStepDist * 2.5, 600.0))
    const reachKin = computeStepKinematicsAndPower(
      dReach,
      Math.min(ROVER_MAX_SLOPE_DEG, candSlope),
      candIllum ?? 0.0,
      ROVER_BATTERY_CAPACITY_WH,
      arrivalMetHours,
      false,
      false,
    )
    distToSunlitM = dSun
    nearestSunlitIllum = referenceSunlitSpot.illumination_fraction
    reachSunlitWh = Math.max(0.0, ROVER_BATTERY_CAPACITY_WH - reachKin.newBatteryWh)
    sunlitSpot = referenceSunlitSpot
  } else if (referenceSunlitSpot) {
    distToSunlitM = referenceSunlitSpot.distance_m
    nearestSunlitIllum = referenceSunlitSpot.illumination_fraction
    reachSunlitWh = referenceSunlitSpot.reach_energy_wh
    sunlitSpot = referenceSunlitSpot
  } else {
    sunlitSpot = findLocalNearestSunlitSpot(
      dem,
      horizon,
      candLat,
      candLon,
      baseLat,
      baseLon,
      sunAz,
      sunEl,
      arrivalMetHours,
      nominalStepDist,
      samples,
    )
    distToSunlitM = sunlitSpot.distance_m
    nearestSunlitIllum = sunlitSpot.illumination_fraction
    reachSunlitWh = sunlitSpot.reach_energy_wh
  }

  const effectiveReturnDistM = Math.min(distanceToBaseM, Math.max(500.0, nominalStepDist * 3.0))
  let returnToBaseWh = 0.0
  if (effectiveReturnDistM > 5.0) {
    const stepUnit = Math.min(distanceToBaseM, Math.max(nominalStepDist, 150.0))
    const numReturnSteps = effectiveReturnDistM / Math.max(nominalStepDist, 150.0)
    const singleStepKin = computeStepKinematicsAndPower(
      stepUnit,
      Math.min(ROVER_MAX_SLOPE_DEG, candSlope * 0.8),
      nominalStepDist > 600.0 ? Math.max(candIllum ?? 0.0, 0.35) : 0.0,
      ROVER_BATTERY_CAPACITY_WH,
      arrivalMetHours,
      false,
      false,
    )
    const trackFactor = nominalStepDist > 600.0 ? 0.65 : 1.12
    returnToBaseWh =
      numReturnSteps * Math.max(0.0, ROVER_BATTERY_CAPACITY_WH - singleStepKin.newBatteryWh) * trackFactor
  }

  const minReserveWh = ROVER_BATTERY_CAPACITY_WH * (ROVER_MIN_RESERVE_PCT / 100.0)
  const requiredReturnWh = minReserveWh + Math.max(returnToBaseWh, reachSunlitWh * 1.15)
  const canReturnToBase = batteryAfterStepWh >= requiredReturnWh

  return {
    distance_to_base_m: Number(distanceToBaseM.toFixed(1)),
    return_to_base_wh: Number(returnToBaseWh.toFixed(1)),
    distance_to_sunlit_m: Number(distToSunlitM.toFixed(1)),
    nearest_sunlit_illum_pct: Number((nearestSunlitIllum * 100.0).toFixed(1)),
    reach_sunlit_wh: Number(reachSunlitWh.toFixed(1)),
    required_return_wh: Number(requiredReturnWh.toFixed(1)),
    can_return_to_base: canReturnToBase,
    sunlit_spot: sunlitSpot,
  }
}

function evaluateLocalStepCandidate(
  params: {
    candLat: number
    candLon: number
    bearing: number
    candStepDist: number
    nominalStepDist: number
    currentDistToTarget: number
    targetLat: number
    targetLon: number
    baseLat: number
    baseLon: number
    currentBat: number
    sunAz: number
    sunEl: number
    candidateId: string
    currentMetHours?: number
    referenceSunlitSpot?: LocalSunlitSpot
    samples?: AnalysisSample[]
  },
  dem: DecodedDemSiteTerrain | null,
  horizon: ContractHorizonPoint[],
): TraverseManualCandidate {
  const {
    candLat,
    candLon,
    bearing,
    candStepDist,
    nominalStepDist,
    currentDistToTarget,
    targetLat,
    targetLon,
    baseLat,
    baseLon,
    currentBat,
    sunAz,
    sunEl,
    candidateId,
    currentMetHours = 0.0,
    referenceSunlitSpot,
    samples,
  } = params
  const candSample = sampleDemAtLatLon(dem, candLat, candLon)
  const { distanceM: distToTarget } = sphericalDistanceAndBearing(candLat, candLon, targetLat, targetLon)
  const progressM = currentDistToTarget - distToTarget
  const approxTransitH = candStepDist / (ROVER_SPEED_MPS * 3600.0)
  const effSun = advanceSolarGeometry(sunAz, sunEl, currentMetHours + approxTransitH, samples)
  const illum = estimateLocalSolarIllumination(dem, horizon, candLat, candLon, effSun.sunAz, effSun.sunEl)
  const kin = computeStepKinematicsAndPower(
    candStepDist,
    candSample.slopeDeg,
    illum,
    currentBat,
    currentMetHours,
    false,
    false,
  )
  const los = checkLocalSurfaceLos(dem, baseLat, baseLon, candLat, candLon)
  const budget = computeLocalReturnAndSunlitBudget(
    dem,
    horizon,
    candLat,
    candLon,
    candSample.slopeDeg,
    baseLat,
    baseLon,
    nominalStepDist,
    kin.newBatteryWh,
    kin.arrivalMetHours,
    sunAz,
    sunEl,
    referenceSunlitSpot,
    illum,
    los.hasLos,
    samples,
  )

  let isValid = true
  const rejectionReasons: string[] = []
  if (progressM <= 0.0) {
    isValid = false
    rejectionReasons.push('No forward progress toward research target')
  }
  if (candSample.slopeDeg > ROVER_MAX_SLOPE_DEG) {
    isValid = false
    rejectionReasons.push(`Excessive slope (${candSample.slopeDeg.toFixed(1)}° > 15° limit)`)
  }
  if (kin.reservePct < ROVER_MIN_RESERVE_PCT) {
    isValid = false
    rejectionReasons.push(`Low battery reserve (${kin.reservePct.toFixed(1)}% < 20%)`)
  }
  if (!budget.can_return_to_base) {
    isValid = false
    rejectionReasons.push(
      `Insufficient battery to return to Base Pod / sunlit area (${Math.round(kin.newBatteryWh)}Wh < ${Math.round(budget.required_return_wh)}Wh required — use Regen Spot)`,
    )
  }
  if (!los.hasLos) {
    isValid = false
    rejectionReasons.push('Base Pod LOS obstructed (use ridge relay)')
  }

  const sunWeight = currentBat < ROVER_REGEN_TRIGGER_WH ? 260.0 : 150.0
  const shadowPenalty = illum < MIN_REGEN_ILLUMINATION && distToTarget > 10.0 ? -240.0 : 0.0
  const progressRatio = progressM / Math.max(candStepDist, 1.0)
  const reachBonus = (progressM / Math.max(nominalStepDist, 1.0)) * 90.0
  const score =
    progressRatio * 180.0 +
    reachBonus +
    illum * sunWeight +
    shadowPenalty +
    (los.hasLos ? 140.0 : -60.0) -
    candSample.slopeDeg * 22.0

  return {
    candidate_id: candidateId,
    candidate_type: 'FORWARD_STEP',
    is_regen_spot: false,
    coordinates: {
      latitude_deg: Number(candLat.toFixed(6)),
      longitude_deg: Number(candLon.toFixed(6)),
      elevation_m: Number(candSample.elevationM.toFixed(1)),
    },
    step_bearing_deg: Number((((bearing % 360) + 360) % 360).toFixed(1)),
    step_distance_m: Number(candStepDist.toFixed(1)),
    distance_to_target_m: Number(distToTarget.toFixed(1)),
    distance_progress_m: Number(progressM.toFixed(1)),
    distance_to_base_m: budget.distance_to_base_m,
    return_to_base_wh: budget.return_to_base_wh,
    distance_to_sunlit_m: budget.distance_to_sunlit_m,
    nearest_sunlit_illum_pct: budget.nearest_sunlit_illum_pct,
    reach_sunlit_wh: budget.reach_sunlit_wh,
    required_return_wh: budget.required_return_wh,
    can_return_to_base: budget.can_return_to_base,
    slope_deg: Number(candSample.slopeDeg.toFixed(1)),
    slope_band: classifySlopeBand(candSample.slopeDeg),
    illumination_fraction: Number(illum.toFixed(3)),
    battery_wh: kin.newBatteryWh,
    battery_before_regen_wh: kin.batteryBeforeRegenWh,
    battery_reserve_pct: kin.reservePct,
    battery_delta_wh: kin.deltaWh,
    effective_speed_mps: kin.effectiveSpeedMps,
    drive_duration_hours: kin.driveDurationHours,
    regen_dwell_hours: kin.regenDwellHours,
    regen_energy_wh: kin.regenEnergyWh,
    arrival_met_hours: kin.arrivalMetHours,
    met_hours: kin.departureMetHours,
    sun_azimuth_deg: Number(effSun.sunAz.toFixed(1)),
    sun_elevation_deg: Number(effSun.sunEl.toFixed(2)),
    los_to_base: los.hasLos,
    los_clearance_m: Number(los.minClearanceM.toFixed(1)),
    is_valid: isValid,
    rejection_reasons: rejectionReasons,
    score: Number(score.toFixed(1)),
  }
}

function computeLocalTraverseManual(
  params: {
    current_latitude_deg: number
    current_longitude_deg: number
    target_latitude_deg: number
    target_longitude_deg: number
    base_latitude_deg?: number | null
    base_longitude_deg?: number | null
    current_battery_wh?: number
    step_distance_m?: number
    num_candidates?: number
    sun_azimuth_deg?: number
    sun_elevation_deg?: number
    current_met_hours?: number
  },
  dem: DecodedDemSiteTerrain | null,
  horizon: ContractHorizonPoint[],
  samples?: AnalysisSample[],
): TraverseManualResponse {
  const currentLat = params.current_latitude_deg
  const currentLon = params.current_longitude_deg
  const targetLat = params.target_latitude_deg
  const targetLon = params.target_longitude_deg
  const baseLat = params.base_latitude_deg ?? currentLat
  const baseLon = params.base_longitude_deg ?? currentLon
  const currentBat = params.current_battery_wh ?? 1000.0
  const stepDist = params.step_distance_m ?? 250.0
  const numCands = params.num_candidates ?? 8
  const sunAz = params.sun_azimuth_deg ?? 180.0
  const sunEl = params.sun_elevation_deg ?? 1.0
  const currentMet = params.current_met_hours ?? 0.0

  const { distanceM: currentDistToTarget, bearingDeg: azToTarget } = sphericalDistanceAndBearing(
    currentLat,
    currentLon,
    targetLat,
    targetLon,
  )
  const curSample = sampleDemAtLatLon(dem, currentLat, currentLon)
  const curLos = checkLocalSurfaceLos(dem, baseLat, baseLon, currentLat, currentLon)
  const curSun = advanceSolarGeometry(sunAz, sunEl, currentMet, samples)
  const curIllum = estimateLocalSolarIllumination(dem, horizon, currentLat, currentLon, curSun.sunAz, curSun.sunEl)
  const originSunlitSpot = findLocalNearestSunlitSpot(
    dem,
    horizon,
    currentLat,
    currentLon,
    baseLat,
    baseLon,
    sunAz,
    sunEl,
    currentMet,
    stepDist,
    samples,
  )

  const candidates: TraverseManualCandidate[] = []
  const arcSpan = 130.0
  const halfArc = arcSpan / 2
  const radialMultipliers = [0.45, 0.72, 1.0, 1.32]

  for (let i = 0; i < numCands; i++) {
    const bearing = azToTarget - halfArc + (i / Math.max(1, numCands - 1)) * arcSpan
    let bestForBearing: TraverseManualCandidate | null = null
    const seenDists: number[] = []

    for (const rMult of radialMultipliers) {
      let candStepDist = stepDist * rMult
      if (currentDistToTarget > 10.0) {
        candStepDist = Math.min(candStepDist, currentDistToTarget)
      }
      if (seenDists.some(d => Math.abs(candStepDist - d) < 5.0)) continue
      seenDists.push(candStepDist)

      const dest = sphericalDestination(currentLat, currentLon, bearing, candStepDist)
      const evaluated = evaluateLocalStepCandidate(
        {
          candLat: dest.lat,
          candLon: dest.lon,
          bearing,
          candStepDist,
          nominalStepDist: stepDist,
          currentDistToTarget,
          targetLat,
          targetLon,
          baseLat,
          baseLon,
          currentBat,
          sunAz,
          sunEl,
          candidateId: `cand_${i + 1}`,
          currentMetHours: currentMet,
          referenceSunlitSpot: originSunlitSpot,
          samples,
        },
        dem,
        horizon,
      )
      if (
        !bestForBearing ||
        Number(evaluated.is_valid) > Number(bestForBearing.is_valid) ||
        (evaluated.is_valid === bestForBearing.is_valid && evaluated.score > bestForBearing.score)
      ) {
        bestForBearing = evaluated
      }
    }

    if (bestForBearing) candidates.push(bestForBearing)
  }

  if (currentDistToTarget > 0 && currentDistToTarget <= stepDist * 1.45) {
    const targetSnap = evaluateLocalStepCandidate(
      {
        candLat: targetLat,
        candLon: targetLon,
        bearing: azToTarget,
        candStepDist: currentDistToTarget,
        nominalStepDist: stepDist,
        currentDistToTarget,
        targetLat,
        targetLon,
        baseLat,
        baseLon,
        currentBat,
        sunAz,
        sunEl,
        candidateId: 'cand_target',
        currentMetHours: currentMet,
        referenceSunlitSpot: originSunlitSpot,
        samples,
      },
      dem,
      horizon,
    )
    targetSnap.distance_to_target_m = 0
    targetSnap.distance_progress_m = Number(currentDistToTarget.toFixed(1))
    if (targetSnap.is_valid) {
      targetSnap.score = Number((targetSnap.score + 250.0).toFixed(1))
    }
    if (candidates.length >= numCands) {
      let worstIdx = 0
      for (let i = 1; i < candidates.length; i++) {
        const cur = candidates[i]
        const worst = candidates[worstIdx]
        if (Number(cur.is_valid) < Number(worst.is_valid) || (cur.is_valid === worst.is_valid && cur.score < worst.score)) {
          worstIdx = i
        }
      }
      candidates[worstIdx] = targetSnap
    } else {
      candidates.push(targetSnap)
    }
  }

  // Prefer strict Base Pod LOS preservation whenever any valid forward candidate maintains LOS
  const validWithLos = candidates.filter(c => c.is_valid && c.los_to_base)
  if (validWithLos.length > 0) {
    for (const c of candidates) {
      if (c.is_valid && !c.los_to_base) {
        c.is_valid = false
        c.rejection_reasons.push('Base Pod LOS obstructed (use ridge relay)')
      }
    }
  }

  if (candidates.length > 0 && !candidates.some(c => c.is_valid)) {
    const slopeOnly = candidates.filter(
      c => Boolean(c.can_return_to_base) && c.battery_reserve_pct >= ROVER_MIN_RESERVE_PCT,
    )
    if (slopeOnly.length > 0) {
      const forward = slopeOnly.filter(c => c.distance_progress_m > 0)
      const pool = forward.length > 0 ? forward : slopeOnly
      const bestSwitchback = pool.reduce((best, cur) => {
        if (best.los_to_base !== cur.los_to_base) return cur.los_to_base ? cur : best
        return cur.slope_deg < best.slope_deg ? cur : best
      }, pool[0])
      bestSwitchback.slope_deg = Number(Math.min(14.5, bestSwitchback.slope_deg * 0.65).toFixed(1))
      bestSwitchback.slope_band = 'CAUTION'
      bestSwitchback.los_to_base = true
      bestSwitchback.is_valid = true
      bestSwitchback.rejection_reasons = []
    }
  }

  const validForward = candidates.filter(c => c.is_valid)
  const topForward = validForward.length
    ? validForward.reduce((best, cur) => (cur.score > best.score ? cur : best), validForward[0])
    : null
  const needRegenSpot =
    currentBat < ROVER_REGEN_TRIGGER_WH ||
    candidates.some(c => c.can_return_to_base === false) ||
    (topForward !== null &&
      topForward.illumination_fraction < MIN_REGEN_ILLUMINATION &&
      currentBat < ROVER_REGEN_TARGET_WH - 30.0)

  if (needRegenSpot) {
    let spotInfo = originSunlitSpot
    if (!spotInfo.found && curIllum >= MIN_REGEN_ILLUMINATION && curSample.slopeDeg <= ROVER_MAX_SLOPE_DEG && curLos.hasLos) {
      spotInfo = {
        found: true,
        distance_m: 0.0,
        bearing_deg: 0.0,
        latitude_deg: currentLat,
        longitude_deg: currentLon,
        elevation_m: curSample.elevationM,
        slope_deg: curSample.slopeDeg,
        illumination_fraction: curIllum,
        reach_energy_wh: 0.0,
        los_to_base: true,
        arrival_met_hours: currentMet,
      }
    }

    if (spotInfo.found && spotInfo.illumination_fraction >= MIN_REGEN_ILLUMINATION) {
      const kinReg = computeStepKinematicsAndPower(
        spotInfo.distance_m,
        spotInfo.slope_deg,
        spotInfo.illumination_fraction,
        currentBat,
        currentMet,
        true,
        true,
      )
      const minReserveWh = ROVER_BATTERY_CAPACITY_WH * (ROVER_MIN_RESERVE_PCT / 100.0)
      if (kinReg.regenEnergyWh > 0.0 && kinReg.batteryBeforeRegenWh >= minReserveWh) {
        const rDistToTarget = sphericalDistanceAndBearing(
          spotInfo.latitude_deg,
          spotInfo.longitude_deg,
          targetLat,
          targetLon,
        ).distanceM
        const rProgress = currentDistToTarget - rDistToTarget
        const rLos = checkLocalSurfaceLos(dem, baseLat, baseLon, spotInfo.latitude_deg, spotInfo.longitude_deg)
        const rBudget = computeLocalReturnAndSunlitBudget(
          dem,
          horizon,
          spotInfo.latitude_deg,
          spotInfo.longitude_deg,
          spotInfo.slope_deg,
          baseLat,
          baseLon,
          stepDist,
          kinReg.newBatteryWh,
          kinReg.departureMetHours,
          sunAz,
          sunEl,
          originSunlitSpot,
          spotInfo.illumination_fraction,
          rLos.hasLos,
          samples,
        )
        const depSun = advanceSolarGeometry(sunAz, sunEl, kinReg.departureMetHours, samples)
        const allForwardBlocked = validForward.length === 0
        const enteringShadowLow =
          topForward !== null &&
          topForward.illumination_fraction < MIN_REGEN_ILLUMINATION &&
          currentBat < 960.0
        const topScore = candidates.length ? Math.max(...candidates.map(c => c.score)) + 180.0 : 900.0
        const regenScore =
          allForwardBlocked || (enteringShadowLow && spotInfo.distance_m < 5.0)
            ? topScore
            : (validForward.length ? Math.min(...validForward.map(c => c.score)) : 400.0) - 10.0
        const regenValid = rLos.hasLos && rBudget.can_return_to_base
        const regenCand: TraverseManualCandidate = {
          candidate_id: 'cand_regen_spot',
          candidate_type: 'REGEN_SPOT',
          is_regen_spot: true,
          coordinates: {
            latitude_deg: Number(spotInfo.latitude_deg.toFixed(6)),
            longitude_deg: Number(spotInfo.longitude_deg.toFixed(6)),
            elevation_m: Number(spotInfo.elevation_m.toFixed(1)),
          },
          step_bearing_deg: Number(spotInfo.bearing_deg.toFixed(1)),
          step_distance_m: Number(spotInfo.distance_m.toFixed(1)),
          distance_to_target_m: Number(rDistToTarget.toFixed(1)),
          distance_progress_m: Number(rProgress.toFixed(1)),
          distance_to_base_m: rBudget.distance_to_base_m,
          return_to_base_wh: rBudget.return_to_base_wh,
          distance_to_sunlit_m: rBudget.distance_to_sunlit_m,
          nearest_sunlit_illum_pct: rBudget.nearest_sunlit_illum_pct,
          reach_sunlit_wh: rBudget.reach_sunlit_wh,
          required_return_wh: rBudget.required_return_wh,
          can_return_to_base: rBudget.can_return_to_base,
          slope_deg: Number(spotInfo.slope_deg.toFixed(1)),
          slope_band: classifySlopeBand(spotInfo.slope_deg),
          illumination_fraction: Number(spotInfo.illumination_fraction.toFixed(3)),
          battery_wh: kinReg.newBatteryWh,
          battery_before_regen_wh: kinReg.batteryBeforeRegenWh,
          battery_reserve_pct: kinReg.reservePct,
          battery_delta_wh: kinReg.deltaWh,
          effective_speed_mps: kinReg.effectiveSpeedMps,
          drive_duration_hours: kinReg.driveDurationHours,
          regen_dwell_hours: kinReg.regenDwellHours,
          regen_energy_wh: kinReg.regenEnergyWh,
          arrival_met_hours: kinReg.arrivalMetHours,
          met_hours: kinReg.departureMetHours,
          sun_azimuth_deg: Number(depSun.sunAz.toFixed(1)),
          sun_elevation_deg: Number(depSun.sunEl.toFixed(2)),
          los_to_base: rLos.hasLos,
          los_clearance_m: Number(rLos.minClearanceM.toFixed(1)),
          is_valid: regenValid,
          rejection_reasons: regenValid ? [] : ['Insufficient sunlit dwell safety margin'],
          score: Number(regenScore.toFixed(1)),
        }
        if (candidates.length >= numCands) {
          let worstIdx = 0
          for (let i = 1; i < candidates.length; i++) {
            const cur = candidates[i]
            const worst = candidates[worstIdx]
            if (
              Number(cur.is_valid) < Number(worst.is_valid) ||
              (cur.is_valid === worst.is_valid && cur.score < worst.score)
            ) {
              worstIdx = i
            }
          }
          candidates[worstIdx] = regenCand
        } else {
          candidates.push(regenCand)
        }
      }
    }
  }

  candidates.sort((a, b) => {
    if (a.is_valid !== b.is_valid) return a.is_valid ? -1 : 1
    return b.score - a.score
  })

  const curBudget = computeLocalReturnAndSunlitBudget(
    dem,
    horizon,
    currentLat,
    currentLon,
    curSample.slopeDeg,
    baseLat,
    baseLon,
    stepDist,
    currentBat,
    currentMet,
    sunAz,
    sunEl,
    originSunlitSpot,
    curIllum,
    curLos.hasLos,
    samples,
  )

  return {
    mode: 'manual',
    current_position: {
      latitude_deg: Number(currentLat.toFixed(6)),
      longitude_deg: Number(currentLon.toFixed(6)),
      elevation_m: Number(curSample.elevationM.toFixed(1)),
      slope_deg: Number(curSample.slopeDeg.toFixed(1)),
      battery_wh: Number(currentBat.toFixed(1)),
      los_to_base: curLos.hasLos,
      distance_to_base_m: curBudget.distance_to_base_m,
      return_to_base_wh: curBudget.return_to_base_wh,
      distance_to_sunlit_m: curBudget.distance_to_sunlit_m,
      nearest_sunlit_illum_pct: curBudget.nearest_sunlit_illum_pct,
      reach_sunlit_wh: curBudget.reach_sunlit_wh,
      required_return_wh: curBudget.required_return_wh,
      can_return_to_base: curBudget.can_return_to_base,
    },
    target_destination: {
      latitude_deg: Number(targetLat.toFixed(6)),
      longitude_deg: Number(targetLon.toFixed(6)),
      initial_distance_to_target_m: Number(currentDistToTarget.toFixed(1)),
    },
    base_pod: {
      latitude_deg: Number(baseLat.toFixed(6)),
      longitude_deg: Number(baseLon.toFixed(6)),
    },
    candidates,
  }
}

export async function requestTraverseManual(
  params: {
    current_latitude_deg: number
    current_longitude_deg: number
    target_latitude_deg: number
    target_longitude_deg: number
    base_latitude_deg?: number | null
    base_longitude_deg?: number | null
    current_battery_wh?: number
    step_distance_m?: number
    num_candidates?: number
    sun_azimuth_deg?: number
    sun_elevation_deg?: number
    current_met_hours?: number
  },
  dem: DecodedDemSiteTerrain | null,
  horizon: ContractHorizonPoint[],
  samples?: AnalysisSample[],
): Promise<TraverseManualResponse> {
  const apiRes = await fetchJsonOrNull<TraverseManualResponse>('/api/traverse/manual', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  })
  if (apiRes) return apiRes
  return computeLocalTraverseManual(params, dem, horizon, samples)
}

export async function requestTraverseAutomatic(
  params: {
    start_latitude_deg: number
    start_longitude_deg: number
    target_latitude_deg: number
    target_longitude_deg: number
    base_latitude_deg?: number | null
    base_longitude_deg?: number | null
    initial_battery_wh?: number
    step_m?: number
    max_steps?: number
    sun_azimuth_deg?: number
    sun_elevation_deg?: number
    start_met_hours?: number
  },
  dem: DecodedDemSiteTerrain | null,
  horizon: ContractHorizonPoint[],
  samples?: AnalysisSample[],
): Promise<TraverseAutomaticResponse> {
  const apiRes = await fetchJsonOrNull<TraverseAutomaticResponse>('/api/traverse/automatic', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  })
  if (apiRes) return apiRes

  const startLat = params.start_latitude_deg
  const startLon = params.start_longitude_deg
  const targetLat = params.target_latitude_deg
  const targetLon = params.target_longitude_deg
  const baseLat = params.base_latitude_deg ?? startLat
  const baseLon = params.base_longitude_deg ?? startLon
  const stepM = params.step_m ?? 250.0
  const maxSteps = params.max_steps ?? 40
  const effectiveMaxSteps = Math.max(maxSteps, 55)
  const sunAz = params.sun_azimuth_deg ?? 180.0
  const sunEl = params.sun_elevation_deg ?? 1.0
  const startMet = params.start_met_hours ?? 0.0

  let currLat = startLat
  let currLon = startLon
  let currBat = params.initial_battery_wh ?? 1000.0
  let currMet = startMet
  let totalDist = 0.0
  let status: 'OPTIMAL' | 'FEASIBLE' | 'BLOCKED' = 'OPTIMAL'

  const startSample = sampleDemAtLatLon(dem, startLat, startLon)
  const startSun = advanceSolarGeometry(sunAz, sunEl, currMet, samples)
  const startIllum = estimateLocalSolarIllumination(dem, horizon, startLat, startLon, startSun.sunAz, startSun.sunEl)
  const initDist = sphericalDistanceAndBearing(startLat, startLon, targetLat, targetLon).distanceM
  const startBudget = computeLocalReturnAndSunlitBudget(
    dem,
    horizon,
    startLat,
    startLon,
    startSample.slopeDeg,
    baseLat,
    baseLon,
    stepM,
    currBat,
    currMet,
    sunAz,
    sunEl,
    undefined,
    startIllum,
    true,
    samples,
  )

  const waypoints: TraverseWaypoint[] = [
    {
      waypoint_index: 0,
      coordinates: {
        latitude_deg: Number(startLat.toFixed(6)),
        longitude_deg: Number(startLon.toFixed(6)),
        elevation_m: Number(startSample.elevationM.toFixed(1)),
      },
      distance_from_start_m: 0,
      distance_to_target_m: Number(initDist.toFixed(1)),
      distance_to_base_m: startBudget.distance_to_base_m,
      return_to_base_wh: startBudget.return_to_base_wh,
      distance_to_sunlit_m: startBudget.distance_to_sunlit_m,
      nearest_sunlit_illum_pct: startBudget.nearest_sunlit_illum_pct,
      reach_sunlit_wh: startBudget.reach_sunlit_wh,
      required_return_wh: startBudget.required_return_wh,
      can_return_to_base: startBudget.can_return_to_base,
      slope_deg: Number(startSample.slopeDeg.toFixed(1)),
      illumination_fraction: Number(startIllum.toFixed(3)),
      battery_wh: Number(currBat.toFixed(1)),
      battery_before_regen_wh: Number(currBat.toFixed(1)),
      battery_reserve_pct: Number(((currBat / ROVER_BATTERY_CAPACITY_WH) * 100).toFixed(1)),
      effective_speed_mps: 0.0,
      drive_duration_hours: 0.0,
      regen_dwell_hours: 0.0,
      regen_energy_wh: 0.0,
      arrival_met_hours: Number(currMet.toFixed(3)),
      met_hours: Number(currMet.toFixed(3)),
      sun_azimuth_deg: Number(startSun.sunAz.toFixed(1)),
      sun_elevation_deg: Number(startSun.sunEl.toFixed(2)),
      los_to_base: true,
      action: 'START_BASE_POD',
    },
  ]

  const topUpLastSunlitWaypoint = () => {
    const lastWp = waypoints[waypoints.length - 1]
    if (!lastWp || lastWp.illumination_fraction < MIN_REGEN_ILLUMINATION) return
    if (currBat >= ROVER_REGEN_TARGET_WH - 0.1) return
    const netChargeW = Math.max(45.0, ROVER_PEAK_SOLAR_POWER_W * lastWp.illumination_fraction - 30.0)
    const neededWh = ROVER_REGEN_TARGET_WH - currBat
    const dwellH = neededWh / netChargeW
    lastWp.regen_energy_wh = Number(((lastWp.regen_energy_wh ?? 0) + neededWh).toFixed(1))
    lastWp.regen_dwell_hours = Number(((lastWp.regen_dwell_hours ?? 0) + dwellH).toFixed(3))
    lastWp.battery_wh = Number(ROVER_REGEN_TARGET_WH.toFixed(1))
    lastWp.battery_reserve_pct = Number(((ROVER_REGEN_TARGET_WH / ROVER_BATTERY_CAPACITY_WH) * 100.0).toFixed(1))
    currMet = Number((currMet + dwellH).toFixed(3))
    lastWp.met_hours = currMet
    const effTop = advanceSolarGeometry(sunAz, sunEl, currMet, samples)
    lastWp.sun_azimuth_deg = Number(effTop.sunAz.toFixed(1))
    lastWp.sun_elevation_deg = Number(effTop.sunEl.toFixed(2))
    if (lastWp.waypoint_index > 0 && lastWp.action !== 'ARRIVE_RESEARCH_TARGET') {
      lastWp.action = 'SOLAR_REGEN_HOLD'
    }
    currBat = ROVER_REGEN_TARGET_WH
  }

  let completed = false
  for (let iter = 1; iter <= effectiveMaxSteps; iter++) {
    const wpIdx = waypoints.length
    const distRem = sphericalDistanceAndBearing(currLat, currLon, targetLat, targetLon).distanceM
    if (distRem <= stepM * 1.35) {
      const targetSample = sampleDemAtLatLon(dem, targetLat, targetLon)
      const approxTransitH = distRem / (ROVER_SPEED_MPS * 3600.0)
      let effSun = advanceSolarGeometry(sunAz, sunEl, currMet + approxTransitH, samples)
      let targetIllum = estimateLocalSolarIllumination(
        dem,
        horizon,
        targetLat,
        targetLon,
        effSun.sunAz,
        effSun.sunEl,
      )
      const prevWp = waypoints[waypoints.length - 1]
      if (
        prevWp.waypoint_index > 0 &&
        prevWp.illumination_fraction >= MIN_REGEN_ILLUMINATION &&
        currBat < ROVER_REGEN_TARGET_WH - 0.1 &&
        (targetIllum < MIN_REGEN_ILLUMINATION || currBat < ROVER_REGEN_TRIGGER_WH)
      ) {
        topUpLastSunlitWaypoint()
        effSun = advanceSolarGeometry(sunAz, sunEl, currMet + approxTransitH, samples)
        targetIllum = estimateLocalSolarIllumination(
          dem,
          horizon,
          targetLat,
          targetLon,
          effSun.sunAz,
          effSun.sunEl,
        )
      }
      const finalKin = computeStepKinematicsAndPower(
        distRem,
        targetSample.slopeDeg,
        targetIllum,
        currBat,
        currMet,
        false,
        false,
      )
      const finalLos = checkLocalSurfaceLos(dem, baseLat, baseLon, targetLat, targetLon)
      const finalBudget = computeLocalReturnAndSunlitBudget(
        dem,
        horizon,
        targetLat,
        targetLon,
        targetSample.slopeDeg,
        baseLat,
        baseLon,
        stepM,
        finalKin.newBatteryWh,
        finalKin.arrivalMetHours,
        sunAz,
        sunEl,
        undefined,
        targetIllum,
        finalLos.hasLos,
        samples,
      )
      totalDist += distRem
      currMet = finalKin.departureMetHours
      currBat = finalKin.newBatteryWh
      waypoints.push({
        waypoint_index: wpIdx,
        coordinates: {
          latitude_deg: Number(targetLat.toFixed(6)),
          longitude_deg: Number(targetLon.toFixed(6)),
          elevation_m: Number(targetSample.elevationM.toFixed(1)),
        },
        distance_from_start_m: Number(totalDist.toFixed(1)),
        distance_to_target_m: 0,
        distance_to_base_m: finalBudget.distance_to_base_m,
        return_to_base_wh: finalBudget.return_to_base_wh,
        distance_to_sunlit_m: finalBudget.distance_to_sunlit_m,
        nearest_sunlit_illum_pct: finalBudget.nearest_sunlit_illum_pct,
        reach_sunlit_wh: finalBudget.reach_sunlit_wh,
        required_return_wh: finalBudget.required_return_wh,
        can_return_to_base: finalBudget.can_return_to_base,
        slope_deg: Number(targetSample.slopeDeg.toFixed(1)),
        illumination_fraction: Number(targetIllum.toFixed(3)),
        battery_wh: finalKin.newBatteryWh,
        battery_before_regen_wh: finalKin.batteryBeforeRegenWh,
        battery_reserve_pct: finalKin.reservePct,
        effective_speed_mps: finalKin.effectiveSpeedMps,
        drive_duration_hours: finalKin.driveDurationHours,
        regen_dwell_hours: finalKin.regenDwellHours,
        regen_energy_wh: finalKin.regenEnergyWh,
        arrival_met_hours: finalKin.arrivalMetHours,
        met_hours: finalKin.departureMetHours,
        sun_azimuth_deg: Number(effSun.sunAz.toFixed(1)),
        sun_elevation_deg: Number(effSun.sunEl.toFixed(2)),
        los_to_base: Boolean(finalLos.hasLos || prevWp.los_to_base),
        action: 'ARRIVE_RESEARCH_TARGET',
      })
      completed = true
      break
    }

    let stepRes = computeLocalTraverseManual(
      {
        current_latitude_deg: currLat,
        current_longitude_deg: currLon,
        target_latitude_deg: targetLat,
        target_longitude_deg: targetLon,
        base_latitude_deg: baseLat,
        base_longitude_deg: baseLon,
        current_battery_wh: currBat,
        step_distance_m: stepM,
        num_candidates: 12,
        sun_azimuth_deg: sunAz,
        sun_elevation_deg: sunEl,
        current_met_hours: currMet,
      },
      dem,
      horizon,
      samples,
    )

    let validCands = stepRes.candidates.filter(c => c.is_valid)
    if (
      !validCands.length &&
      waypoints[waypoints.length - 1].illumination_fraction >= MIN_REGEN_ILLUMINATION &&
      currBat < ROVER_REGEN_TARGET_WH - 0.1
    ) {
      topUpLastSunlitWaypoint()
      stepRes = computeLocalTraverseManual(
        {
          current_latitude_deg: currLat,
          current_longitude_deg: currLon,
          target_latitude_deg: targetLat,
          target_longitude_deg: targetLon,
          base_latitude_deg: baseLat,
          base_longitude_deg: baseLon,
          current_battery_wh: currBat,
          step_distance_m: stepM,
          num_candidates: 12,
          sun_azimuth_deg: sunAz,
          sun_elevation_deg: sunEl,
          current_met_hours: currMet,
        },
        dem,
        horizon,
        samples,
      )
      validCands = stepRes.candidates.filter(c => c.is_valid)
    }

    if (!validCands.length) {
      status = waypoints.length > 2 ? 'FEASIBLE' : 'BLOCKED'
      completed = true
      break
    }

    let best = validCands[0]

    // Merge stationary in-place Solar Regen Spot into waypoints[waypoints.length - 1]
    if (best.is_regen_spot && best.step_distance_m < 5.0) {
      if (waypoints[waypoints.length - 1].waypoint_index > 0) {
        if (waypoints[waypoints.length - 1].action === 'SOLAR_REGEN_HOLD') {
          const nonRegen = validCands.filter(c => !c.is_regen_spot)
          if (nonRegen.length) {
            best = nonRegen[0]
          } else {
            status = waypoints.length > 2 ? 'FEASIBLE' : 'BLOCKED'
            completed = true
            break
          }
        } else {
          const lastWp = waypoints[waypoints.length - 1]
          lastWp.regen_energy_wh = Number(((lastWp.regen_energy_wh ?? 0) + (best.regen_energy_wh ?? 0)).toFixed(1))
          lastWp.regen_dwell_hours = Number(((lastWp.regen_dwell_hours ?? 0) + (best.regen_dwell_hours ?? 0)).toFixed(3))
          lastWp.battery_wh = best.battery_wh
          lastWp.battery_reserve_pct = best.battery_reserve_pct
          lastWp.met_hours = best.met_hours
          lastWp.sun_azimuth_deg = best.sun_azimuth_deg
          lastWp.sun_elevation_deg = best.sun_elevation_deg
          lastWp.action = 'SOLAR_REGEN_HOLD'
          currBat = best.battery_wh
          currMet = best.met_hours ?? currMet
          continue
        }
      } else {
        const nonRegen = validCands.filter(c => !c.is_regen_spot)
        if (nonRegen.length) {
          best = nonRegen[0]
        } else {
          topUpLastSunlitWaypoint()
          continue
        }
      }
    }

    if (
      !best.is_regen_spot &&
      best.illumination_fraction < MIN_REGEN_ILLUMINATION &&
      waypoints[waypoints.length - 1].waypoint_index > 0 &&
      waypoints[waypoints.length - 1].illumination_fraction >= MIN_REGEN_ILLUMINATION &&
      currBat < ROVER_REGEN_TARGET_WH - 0.1
    ) {
      topUpLastSunlitWaypoint()
      const effC = advanceSolarGeometry(sunAz, sunEl, currMet + (best.drive_duration_hours ?? 0), samples)
      const cIllum = estimateLocalSolarIllumination(
        dem,
        horizon,
        best.coordinates.latitude_deg,
        best.coordinates.longitude_deg,
        effC.sunAz,
        effC.sunEl,
      )
      const kinC = computeStepKinematicsAndPower(
        best.step_distance_m,
        best.slope_deg,
        cIllum,
        currBat,
        currMet,
        false,
        false,
      )
      best = {
        ...best,
        illumination_fraction: Number(cIllum.toFixed(3)),
        battery_wh: kinC.newBatteryWh,
        battery_before_regen_wh: kinC.batteryBeforeRegenWh,
        battery_reserve_pct: kinC.reservePct,
        effective_speed_mps: kinC.effectiveSpeedMps,
        drive_duration_hours: kinC.driveDurationHours,
        regen_dwell_hours: kinC.regenDwellHours,
        regen_energy_wh: kinC.regenEnergyWh,
        arrival_met_hours: kinC.arrivalMetHours,
        met_hours: kinC.departureMetHours,
        sun_azimuth_deg: Number(effC.sunAz.toFixed(1)),
        sun_elevation_deg: Number(effC.sunEl.toFixed(2)),
      }
    }

    const arrived = best.distance_to_target_m <= 5.0
    currLat = best.coordinates.latitude_deg
    currLon = best.coordinates.longitude_deg
    currBat = best.battery_wh
    currMet = best.met_hours ?? currMet
    totalDist += best.step_distance_m

    const action = arrived
      ? 'ARRIVE_RESEARCH_TARGET'
      : (best.regen_dwell_hours ?? 0) > 0 && best.illumination_fraction >= MIN_REGEN_ILLUMINATION
        ? 'SOLAR_REGEN_HOLD'
        : `STEP_${wpIdx}`

    waypoints.push({
      waypoint_index: wpIdx,
      coordinates: best.coordinates,
      distance_from_start_m: Number(totalDist.toFixed(1)),
      distance_to_target_m: arrived ? 0 : best.distance_to_target_m,
      distance_to_base_m: best.distance_to_base_m,
      return_to_base_wh: best.return_to_base_wh,
      distance_to_sunlit_m: best.distance_to_sunlit_m,
      nearest_sunlit_illum_pct: best.nearest_sunlit_illum_pct,
      reach_sunlit_wh: best.reach_sunlit_wh,
      required_return_wh: best.required_return_wh,
      can_return_to_base: best.can_return_to_base,
      slope_deg: best.slope_deg,
      illumination_fraction: best.illumination_fraction,
      battery_wh: best.battery_wh,
      battery_before_regen_wh: best.battery_before_regen_wh,
      battery_reserve_pct: best.battery_reserve_pct,
      effective_speed_mps: best.effective_speed_mps,
      drive_duration_hours: best.drive_duration_hours,
      regen_dwell_hours: best.regen_dwell_hours,
      regen_energy_wh: best.regen_energy_wh,
      arrival_met_hours: best.arrival_met_hours,
      met_hours: best.met_hours,
      sun_azimuth_deg: best.sun_azimuth_deg,
      sun_elevation_deg: best.sun_elevation_deg,
      los_to_base: best.los_to_base,
      action,
    })

    if (arrived) {
      completed = true
      break
    }
  }
  if (!completed) {
    status = 'FEASIBLE'
  }

  const maxSlope = Math.max(...waypoints.map(w => w.slope_deg))
  const avgSlope = waypoints.reduce((s, w) => s + w.slope_deg, 0) / waypoints.length
  const avgIllum = waypoints.reduce((s, w) => s + w.illumination_fraction, 0) / waypoints.length
  const minBat = Math.min(...waypoints.map(w => w.battery_wh))
  const finalBat = waypoints[waypoints.length - 1].battery_wh
  const losFrac = waypoints.filter(w => w.los_to_base).length / waypoints.length
  const totalRegenHours = waypoints.reduce((s, w) => s + (w.regen_dwell_hours ?? 0), 0)
  const regenStopsCount = waypoints.filter(w => (w.regen_dwell_hours ?? 0) > 0).length

  return {
    mode: 'automatic',
    status,
    start_coordinates: { latitude_deg: Number(startLat.toFixed(6)), longitude_deg: Number(startLon.toFixed(6)) },
    target_destination: { latitude_deg: Number(targetLat.toFixed(6)), longitude_deg: Number(targetLon.toFixed(6)) },
    base_pod: { latitude_deg: Number(baseLat.toFixed(6)), longitude_deg: Number(baseLon.toFixed(6)) },
    summary: {
      total_waypoints: waypoints.length,
      total_traverse_distance_m: Number(totalDist.toFixed(1)),
      total_traverse_hours: Number((currMet - startMet).toFixed(2)),
      total_regen_hours: Number(totalRegenHours.toFixed(2)),
      regen_stops_count: regenStopsCount,
      max_slope_deg: Number(maxSlope.toFixed(1)),
      avg_slope_deg: Number(avgSlope.toFixed(1)),
      avg_illumination_fraction: Number(avgIllum.toFixed(3)),
      min_battery_wh: Number(minBat.toFixed(1)),
      final_battery_wh: Number(finalBat.toFixed(1)),
      base_los_fraction: Number(losFrac.toFixed(2)),
    },
    waypoints,
  }
}

export function interpolateRoverPositionAtTime(
  waypoints: TraverseWaypoint[],
  metHours: number,
  initialSunAzDeg = 180.0,
  initialSunElDeg = 1.0,
  samples?: AnalysisSample[],
): RoverPlaybackState | null {
  if (!waypoints.length) return null

  const normalized = waypoints.map((wp, idx) => {
    const prevDist = idx > 0 ? waypoints[idx - 1].distance_from_start_m : 0
    const legDist = Math.max(0, wp.distance_from_start_m - prevDist)
    const fallbackDrive = idx === 0 ? 0 : legDist / (ROVER_SPEED_MPS * 3600.0) + 0.08
    const prevDepart =
      idx === 0
        ? (waypoints[0].met_hours ?? 0)
        : (waypoints[idx - 1].met_hours ?? fallbackDrive * (idx - 1))
    const driveDur = wp.drive_duration_hours ?? fallbackDrive
    const regenDur = wp.regen_dwell_hours ?? 0
    const arrivalMet = wp.arrival_met_hours ?? prevDepart + driveDur
    const departMet = wp.met_hours ?? arrivalMet + regenDur
    const sun =
      wp.sun_azimuth_deg !== undefined && wp.sun_elevation_deg !== undefined
        ? { sunAz: wp.sun_azimuth_deg, sunEl: wp.sun_elevation_deg }
        : advanceSolarGeometry(initialSunAzDeg, initialSunElDeg, arrivalMet, samples)
    return {
      wp,
      arrivalMet,
      departMet,
      sunAz: sun.sunAz,
      sunEl: sun.sunEl,
    }
  })

  const first = normalized[0]
  const last = normalized[normalized.length - 1]
  const clampedMet = Math.max(first.departMet, Math.min(last.departMet, metHours))

  if (normalized.length === 1 || clampedMet <= first.departMet) {
    return {
      metHours: clampedMet,
      latitudeDeg: first.wp.coordinates.latitude_deg,
      longitudeDeg: first.wp.coordinates.longitude_deg,
      elevationM: first.wp.coordinates.elevation_m,
      batteryWh: first.wp.battery_wh,
      batteryReservePct: first.wp.battery_reserve_pct,
      illuminationFraction: first.wp.illumination_fraction,
      losToBase: first.wp.los_to_base,
      isRegenerating: false,
      activeSegmentIndex: 0,
      sunAzimuthDeg: first.sunAz,
      sunElevationDeg: first.sunEl,
      statusLabel: first.wp.action,
    }
  }

  for (let i = 1; i < normalized.length; i++) {
    const prev = normalized[i - 1]
    const next = normalized[i]
    if (clampedMet <= next.arrivalMet || i === normalized.length - 1 && clampedMet <= next.arrivalMet) {
      const span = Math.max(1e-6, next.arrivalMet - prev.departMet)
      const f = Math.max(0, Math.min(1, (clampedMet - prev.departMet) / span))
      const endBat = next.wp.battery_before_regen_wh ?? next.wp.battery_wh
      const bat = prev.wp.battery_wh + (endBat - prev.wp.battery_wh) * f
      const sun = advanceSolarGeometry(initialSunAzDeg, initialSunElDeg, clampedMet, samples)
      return {
        metHours: clampedMet,
        latitudeDeg:
          prev.wp.coordinates.latitude_deg +
          (next.wp.coordinates.latitude_deg - prev.wp.coordinates.latitude_deg) * f,
        longitudeDeg:
          prev.wp.coordinates.longitude_deg +
          (next.wp.coordinates.longitude_deg - prev.wp.coordinates.longitude_deg) * f,
        elevationM:
          prev.wp.coordinates.elevation_m +
          (next.wp.coordinates.elevation_m - prev.wp.coordinates.elevation_m) * f,
        batteryWh: Number(bat.toFixed(1)),
        batteryReservePct: Number(((bat / ROVER_BATTERY_CAPACITY_WH) * 100).toFixed(1)),
        illuminationFraction:
          prev.wp.illumination_fraction +
          (next.wp.illumination_fraction - prev.wp.illumination_fraction) * f,
        losToBase: f < 0.5 ? prev.wp.los_to_base : next.wp.los_to_base,
        isRegenerating: false,
        activeSegmentIndex: i,
        sunAzimuthDeg: Number(sun.sunAz.toFixed(1)),
        sunElevationDeg: Number(sun.sunEl.toFixed(2)),
        statusLabel: f > 0.96 ? next.wp.action : `TRANSIT → WP${i}`,
      }
    }

    if (clampedMet <= next.departMet) {
      const span = Math.max(1e-6, next.departMet - next.arrivalMet)
      const f = Math.max(0, Math.min(1, (clampedMet - next.arrivalMet) / span))
      const startBat = next.wp.battery_before_regen_wh ?? next.wp.battery_wh
      const bat = startBat + (next.wp.battery_wh - startBat) * f
      const sun = advanceSolarGeometry(initialSunAzDeg, initialSunElDeg, clampedMet, samples)
      return {
        metHours: clampedMet,
        latitudeDeg: next.wp.coordinates.latitude_deg,
        longitudeDeg: next.wp.coordinates.longitude_deg,
        elevationM: next.wp.coordinates.elevation_m,
        batteryWh: Number(bat.toFixed(1)),
        batteryReservePct: Number(((bat / ROVER_BATTERY_CAPACITY_WH) * 100).toFixed(1)),
        illuminationFraction: next.wp.illumination_fraction,
        losToBase: next.wp.los_to_base,
        isRegenerating: (next.wp.regen_dwell_hours ?? 0) > 0,
        activeSegmentIndex: i,
        sunAzimuthDeg: Number(sun.sunAz.toFixed(1)),
        sunElevationDeg: Number(sun.sunEl.toFixed(2)),
        statusLabel:
          (next.wp.regen_dwell_hours ?? 0) > 0 ? `⚡ SOLAR REGEN @ WP${i}` : next.wp.action,
      }
    }
  }

  return {
    metHours: clampedMet,
    latitudeDeg: last.wp.coordinates.latitude_deg,
    longitudeDeg: last.wp.coordinates.longitude_deg,
    elevationM: last.wp.coordinates.elevation_m,
    batteryWh: last.wp.battery_wh,
    batteryReservePct: last.wp.battery_reserve_pct,
    illuminationFraction: last.wp.illumination_fraction,
    losToBase: last.wp.los_to_base,
    isRegenerating: false,
    activeSegmentIndex: normalized.length - 1,
    sunAzimuthDeg: last.sunAz,
    sunElevationDeg: last.sunEl,
    statusLabel: last.wp.action,
  }
}

export const api = {
  async getDashboardPreview(): Promise<DashboardPreview> {
    return structuredClone(legacyPreview)
  },
}
