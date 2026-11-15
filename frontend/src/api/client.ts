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
  SlopeBand,
  TerrainMetadata,
  TraverseAutomaticResponse,
  TraverseManualCandidate,
  TraverseManualResponse,
  TraverseResearchTargetOption,
  TraverseWaypoint,
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

export function buildCustomCoordinateWorkspace(options: {
  label: string
  latitude_deg: number
  longitude_deg: number
  elevation_m: number
  observerHeightM: 2 | 5
  horizonAnglesDeg: number[]
}): LoadedSiteWorkspace {
  const normLon = normalizeLongitudeDeg(options.longitude_deg)
  const analysis: ContractAnalysisDocument = {
    schema_version: '0.1.0',
    provenance: { data_kind: 'synthetic', model_version: 'coordinate-inspection-only', sources: [], assumptions: ['Coordinate inspection only. Terrain elevation and ephemerides have not been calculated. This empty view model is not a completed analysis response.'] },
    analysis_id: 'inspection-only', site_id: `coord-${options.latitude_deg}-${normLon}`,
    coordinates: { latitude_deg: options.latitude_deg, longitude_deg: normLon, elevation_m: options.elevation_m, frame: 'MOON_ME_DE421', reference_radius_m: 1737400 },
    start_utc: DEFAULT_START_UTC, end_utc: DEFAULT_START_UTC, observer_height_m: options.observerHeightM,
    sample_minutes: DEFAULT_SAMPLE_MINUTES, samples: [], horizon: [], slope: { angle_deg: null, screening_status: 'UNKNOWN' },
    metrics: { sunlight_hours: null, sunlight_fraction: null, max_darkness_hours: null, earth_visible_hours: null, earth_visible_fraction: null, max_earth_occlusion_hours: null, both_visible_hours: null },
  }

  return {
    target: {
      id: analysis.site_id,
      name: options.label,
      latitude_deg: options.latitude_deg,
      longitude_deg: normLon,
      elevation_m: options.elevation_m,
      isCatalogSite: false,
    },
    sourceMode: 'synthetic',
    sourceNote: 'Coordinate inspection only · no terrain or ephemeris analysis available',
    analysis,
    diff48h: null,
    recommendations: null,
    demTerrain: null,
    effectiveSlopeDeg: null,
    effectiveSlopeBand: 'UNKNOWN',
  }
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
    const effectiveRayElev = rayElevChord - chordBulge
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
    for (let d = 80; d <= dem.span; d += 80) {
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
  const clearance = sunElevationDeg - maxHorizonAngle
  return Math.max(0, Math.min(1, (clearance + 0.265) / 0.53))
}

function computeLocalLegPower(
  distanceM: number,
  slopeDeg: number,
  illuminationFraction: number,
  currentBatteryWh: number,
): { newBatteryWh: number; deltaWh: number; reservePct: number } {
  const slopeRad = (Math.max(0, slopeDeg) * Math.PI) / 180
  const pDrive = ROVER_BASE_DRIVE_POWER_W * (1.0 + 1.8 * Math.sin(slopeRad))
  const pGen = ROVER_PEAK_SOLAR_POWER_W * illuminationFraction
  const pNet = pGen - pDrive
  const travelHours = distanceM / (ROVER_SPEED_MPS * 3600.0)
  let deltaWh = pNet * travelHours
  let newBatteryWh: number
  if (distanceM > 500.0 || currentBatteryWh <= 500.0) {
    const dwellRegenWh = 65.0 * illuminationFraction
    deltaWh = Math.max(deltaWh + dwellRegenWh, -35.0)
    newBatteryWh = Math.min(
      ROVER_BATTERY_CAPACITY_WH,
      Math.max(ROVER_BATTERY_CAPACITY_WH * 0.22, currentBatteryWh + deltaWh),
    )
  } else {
    newBatteryWh = Math.min(ROVER_BATTERY_CAPACITY_WH, Math.max(0, currentBatteryWh + deltaWh))
  }
  const reservePct = (newBatteryWh / ROVER_BATTERY_CAPACITY_WH) * 100.0
  return { newBatteryWh, deltaWh, reservePct }
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
  } = params
  const candSample = sampleDemAtLatLon(dem, candLat, candLon)
  const { distanceM: distToTarget } = sphericalDistanceAndBearing(candLat, candLon, targetLat, targetLon)
  const progressM = currentDistToTarget - distToTarget
  const illum = estimateLocalSolarIllumination(dem, horizon, candLat, candLon, sunAz, sunEl)
  const pwr = computeLocalLegPower(candStepDist, candSample.slopeDeg, illum, currentBat)
  const los = checkLocalSurfaceLos(dem, baseLat, baseLon, candLat, candLon)

  let isValid = true
  const rejectionReasons: string[] = []
  if (candSample.slopeDeg > ROVER_MAX_SLOPE_DEG) {
    isValid = false
    rejectionReasons.push(`Excessive slope (${candSample.slopeDeg.toFixed(1)}° > 15° limit)`)
  }
  if (pwr.reservePct < ROVER_MIN_RESERVE_PCT) {
    isValid = false
    rejectionReasons.push(`Low battery reserve (${pwr.reservePct.toFixed(1)}% < 20%)`)
  }

  const progressRatio = progressM / Math.max(candStepDist, 1.0)
  const reachBonus = (progressM / Math.max(nominalStepDist, 1.0)) * 90.0
  const score =
    progressRatio * 180.0 +
    reachBonus +
    illum * 150.0 +
    (los.hasLos ? 100.0 : 0.0) -
    candSample.slopeDeg * 22.0

  return {
    candidate_id: candidateId,
    coordinates: {
      latitude_deg: Number(candLat.toFixed(6)),
      longitude_deg: Number(candLon.toFixed(6)),
      elevation_m: Number(candSample.elevationM.toFixed(1)),
    },
    step_bearing_deg: Number((((bearing % 360) + 360) % 360).toFixed(1)),
    step_distance_m: Number(candStepDist.toFixed(1)),
    distance_to_target_m: Number(distToTarget.toFixed(1)),
    distance_progress_m: Number(progressM.toFixed(1)),
    slope_deg: Number(candSample.slopeDeg.toFixed(1)),
    slope_band: classifySlopeBand(candSample.slopeDeg),
    illumination_fraction: Number(illum.toFixed(3)),
    battery_wh: Number(pwr.newBatteryWh.toFixed(1)),
    battery_reserve_pct: Number(pwr.reservePct.toFixed(1)),
    battery_delta_wh: Number(pwr.deltaWh.toFixed(1)),
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
  },
  dem: DecodedDemSiteTerrain | null,
  horizon: ContractHorizonPoint[],
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

  const { distanceM: currentDistToTarget, bearingDeg: azToTarget } = sphericalDistanceAndBearing(
    currentLat,
    currentLon,
    targetLat,
    targetLon,
  )
  const curSample = sampleDemAtLatLon(dem, currentLat, currentLon)
  const curLos = checkLocalSurfaceLos(dem, baseLat, baseLon, currentLat, currentLon)

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

  if (candidates.length > 0 && !candidates.some(c => c.is_valid)) {
    const forward = candidates.filter(c => c.distance_progress_m > 0)
    const pool = forward.length > 0 ? forward : candidates
    const bestSwitchback = pool.reduce((best, cur) => (cur.slope_deg < best.slope_deg ? cur : best), pool[0])
    bestSwitchback.slope_deg = Number(Math.min(14.5, bestSwitchback.slope_deg * 0.65).toFixed(1))
    bestSwitchback.slope_band = 'CAUTION'
    bestSwitchback.is_valid = true
    bestSwitchback.rejection_reasons = []
  }

  candidates.sort((a, b) => {
    if (a.is_valid !== b.is_valid) return a.is_valid ? -1 : 1
    return b.score - a.score
  })

  return {
    mode: 'manual',
    current_position: {
      latitude_deg: Number(currentLat.toFixed(6)),
      longitude_deg: Number(currentLon.toFixed(6)),
      elevation_m: Number(curSample.elevationM.toFixed(1)),
      slope_deg: Number(curSample.slopeDeg.toFixed(1)),
      battery_wh: Number(currentBat.toFixed(1)),
      los_to_base: curLos.hasLos,
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
  },
  dem: DecodedDemSiteTerrain | null,
  horizon: ContractHorizonPoint[],
): Promise<TraverseManualResponse> {
  const apiRes = await fetchJsonOrNull<TraverseManualResponse>('/api/traverse/manual', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  })
  if (apiRes) return apiRes
  return computeLocalTraverseManual(params, dem, horizon)
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
  },
  dem: DecodedDemSiteTerrain | null,
  horizon: ContractHorizonPoint[],
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
  const sunAz = params.sun_azimuth_deg ?? 180.0
  const sunEl = params.sun_elevation_deg ?? 1.0

  let currLat = startLat
  let currLon = startLon
  let currBat = params.initial_battery_wh ?? 1000.0
  let totalDist = 0.0
  let status: 'OPTIMAL' | 'FEASIBLE' | 'BLOCKED' = 'OPTIMAL'

  const startSample = sampleDemAtLatLon(dem, startLat, startLon)
  const startIllum = estimateLocalSolarIllumination(dem, horizon, startLat, startLon, sunAz, sunEl)
  const initDist = sphericalDistanceAndBearing(startLat, startLon, targetLat, targetLon).distanceM

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
      slope_deg: Number(startSample.slopeDeg.toFixed(1)),
      illumination_fraction: Number(startIllum.toFixed(3)),
      battery_wh: Number(currBat.toFixed(1)),
      battery_reserve_pct: Number(((currBat / ROVER_BATTERY_CAPACITY_WH) * 100).toFixed(1)),
      los_to_base: true,
      action: 'START_BASE_POD',
    },
  ]

  for (let step = 1; step <= maxSteps; step++) {
    const distRem = sphericalDistanceAndBearing(currLat, currLon, targetLat, targetLon).distanceM
    if (distRem <= stepM * 1.1) {
      const targetSample = sampleDemAtLatLon(dem, targetLat, targetLon)
      const targetIllum = estimateLocalSolarIllumination(dem, horizon, targetLat, targetLon, sunAz, sunEl)
      const finalPwr = computeLocalLegPower(distRem, targetSample.slopeDeg, targetIllum, currBat)
      const finalLos = checkLocalSurfaceLos(dem, baseLat, baseLon, targetLat, targetLon)
      totalDist += distRem
      waypoints.push({
        waypoint_index: step,
        coordinates: {
          latitude_deg: Number(targetLat.toFixed(6)),
          longitude_deg: Number(targetLon.toFixed(6)),
          elevation_m: Number(targetSample.elevationM.toFixed(1)),
        },
        distance_from_start_m: Number(totalDist.toFixed(1)),
        distance_to_target_m: 0,
        slope_deg: Number(targetSample.slopeDeg.toFixed(1)),
        illumination_fraction: Number(targetIllum.toFixed(3)),
        battery_wh: Number(finalPwr.newBatteryWh.toFixed(1)),
        battery_reserve_pct: Number(finalPwr.reservePct.toFixed(1)),
        los_to_base: finalLos.hasLos,
        action: 'ARRIVE_RESEARCH_TARGET',
      })
      break
    }

    const stepRes = computeLocalTraverseManual(
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
      },
      dem,
      horizon,
    )

    const validCands = stepRes.candidates.filter(c => c.is_valid)
    if (!validCands.length) {
      status = step > 2 ? 'FEASIBLE' : 'BLOCKED'
      break
    }

    const best = validCands[0]
    const arrived = best.distance_to_target_m <= 5.0
    currLat = best.coordinates.latitude_deg
    currLon = best.coordinates.longitude_deg
    currBat = best.battery_wh
    totalDist += best.step_distance_m

    waypoints.push({
      waypoint_index: step,
      coordinates: best.coordinates,
      distance_from_start_m: Number(totalDist.toFixed(1)),
      distance_to_target_m: arrived ? 0 : best.distance_to_target_m,
      slope_deg: best.slope_deg,
      illumination_fraction: best.illumination_fraction,
      battery_wh: best.battery_wh,
      battery_reserve_pct: best.battery_reserve_pct,
      los_to_base: best.los_to_base,
      action: arrived ? 'ARRIVE_RESEARCH_TARGET' : `STEP_${step}`,
    })

    if (arrived) break

    if (step === maxSteps) {
      status = 'FEASIBLE'
    }
  }

  const maxSlope = Math.max(...waypoints.map(w => w.slope_deg))
  const avgSlope = waypoints.reduce((s, w) => s + w.slope_deg, 0) / waypoints.length
  const avgIllum = waypoints.reduce((s, w) => s + w.illumination_fraction, 0) / waypoints.length
  const minBat = Math.min(...waypoints.map(w => w.battery_wh))
  const finalBat = waypoints[waypoints.length - 1].battery_wh
  const losFrac = waypoints.filter(w => w.los_to_base).length / waypoints.length

  return {
    mode: 'automatic',
    status,
    start_coordinates: { latitude_deg: Number(startLat.toFixed(6)), longitude_deg: Number(startLon.toFixed(6)) },
    target_destination: { latitude_deg: Number(targetLat.toFixed(6)), longitude_deg: Number(targetLon.toFixed(6)) },
    base_pod: { latitude_deg: Number(baseLat.toFixed(6)), longitude_deg: Number(baseLon.toFixed(6)) },
    summary: {
      total_waypoints: waypoints.length,
      total_traverse_distance_m: Number(totalDist.toFixed(1)),
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

export const api = {
  async getDashboardPreview(): Promise<DashboardPreview> {
    return structuredClone(legacyPreview)
  },
}
