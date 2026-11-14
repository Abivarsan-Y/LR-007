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
  return ((((lonDeg + 180) % 360) + 360) % 360) - 180
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
  {
    scienceSiteId: string | null
    polarId: string
    shortName: string
    tag: string
    hasVerifiedAnalysis: boolean
  }
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

export const CATALOG_SITES: CatalogSiteEntry[] = sitesCatalogJson.map((raw) => {
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
  {
    name: 'Shackleton Floor',
    lat: -89.68,
    lon: 185.0,
    tag: 'Cryogenic Crater Floor',
  },
  { name: 'Cabeus Basin', lat: -84.9, lon: -38.0, tag: 'LCROSS Impact Region' },
  { name: 'Shoemaker Crater', lat: -88.1, lon: 45.0, tag: 'PSR Crater Floor' },
  { name: 'de Gerlache Rim', lat: -88.4, lon: -88.0, tag: 'Ridge Crest' },
  {
    name: 'South Pole Exact',
    lat: -90.0,
    lon: 0.0,
    tag: '90°S Rotational Axis',
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
    loadMeta: () =>
      import(
        '../../../data/processed/site01_connecting_ridge_terrain.json'
      ) as Promise<{ default: TerrainMetadata }>,
    loadBinUrl: () =>
      import('../../../data/processed/site01_connecting_ridge_terrain.bin?url'),
    loadHorizon: () =>
      import('../../../data/processed/site01_connecting_ridge_horizon.json'),
    loadRecommend: () =>
      import(
        '../../../data/processed/site01_connecting_ridge_recommend.json'
      ) as Promise<{ default: ContractRecommendDocument }>,
  },
  site04_shackleton_rim: {
    loadMeta: () =>
      import(
        '../../../data/processed/site04_shackleton_rim_terrain.json'
      ) as Promise<{ default: TerrainMetadata }>,
    loadBinUrl: () =>
      import('../../../data/processed/site04_shackleton_rim_terrain.bin?url'),
    loadHorizon: () =>
      import('../../../data/processed/site04_shackleton_rim_horizon.json'),
    loadRecommend: () =>
      import(
        '../../../data/processed/site04_shackleton_rim_recommend.json'
      ) as Promise<{ default: ContractRecommendDocument }>,
  },
  site07_malapert_mountain: {
    loadMeta: () =>
      import(
        '../../../data/processed/site07_malapert_mountain_terrain.json'
      ) as Promise<{ default: TerrainMetadata }>,
    loadBinUrl: () =>
      import(
        '../../../data/processed/site07_malapert_mountain_terrain.bin?url'
      ),
    loadHorizon: () =>
      import('../../../data/processed/site07_malapert_mountain_horizon.json'),
    loadRecommend: () =>
      import(
        '../../../data/processed/site07_malapert_mountain_recommend.json'
      ) as Promise<{ default: ContractRecommendDocument }>,
  },
  site09_haworth_floor: {
    loadMeta: () =>
      import(
        '../../../data/processed/site09_haworth_floor_terrain.json'
      ) as Promise<{ default: TerrainMetadata }>,
    loadBinUrl: () =>
      import('../../../data/processed/site09_haworth_floor_terrain.bin?url'),
    loadHorizon: () =>
      import('../../../data/processed/site09_haworth_floor_horizon.json'),
    loadRecommend: () =>
      import(
        '../../../data/processed/site09_haworth_floor_recommend.json'
      ) as Promise<{ default: ContractRecommendDocument }>,
  },
}

const demCache = new Map<string, Promise<DecodedDemSiteTerrain | null>>()

function computeVertexSlopeAngles(
  positions: Float32Array,
  width: number,
  height: number,
  spacingM: number,
  validMask: Uint8Array,
): {
  slopeDegPerVertex: Float32Array
  centerSlopeDeg: number | null
  minRelY: number
  maxRelY: number
} {
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
      if (
        !validMask[idx] ||
        !validMask[west] ||
        !validMask[east] ||
        !validMask[north] ||
        !validMask[south]
      ) {
        continue
      }
      const dzDx =
        (positions[east * 3 + 1] - positions[west * 3 + 1]) / (2 * spacingM)
      const dzDy =
        (positions[south * 3 + 1] - positions[north * 3 + 1]) / (2 * spacingM)
      slopes[idx] = Math.atan(Math.hypot(dzDx, dzDy)) * RAD_TO_DEG
    }
  }

  const centerIdx = Math.floor(height / 2) * width + Math.floor(width / 2)
  const centerSlope = Number.isFinite(slopes[centerIdx])
    ? slopes[centerIdx]
    : null
  return {
    slopeDegPerVertex: slopes,
    centerSlopeDeg: centerSlope,
    minRelY,
    maxRelY,
  }
}

export async function loadDemTerrain(
  terrainSiteId: string,
): Promise<DecodedDemSiteTerrain | null> {
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

      const { slopeDegPerVertex, centerSlopeDeg, minRelY, maxRelY } =
        computeVertexSlopeAngles(
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

function circularHorizonLookup(
  horizon: ContractHorizonPoint[],
  azimuthDeg: number,
): number | null {
  if (!horizon.length) return null
  const step = 360 / horizon.length
  const normAz = ((azimuthDeg % 360) + 360) % 360
  const idx0 = Math.floor(normAz / step) % horizon.length
  const idx1 = (idx0 + 1) % horizon.length
  const frac = normAz / step - Math.floor(normAz / step)
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
  let unknownSun = false
  let unknownEarth = false
  let unknownBoth = false
  let sunLitSteps = 0
  let earthVisSteps = 0
  let bothVisSteps = 0
  let curDark = 0
  let maxDark = 0
  let curOcc = 0
  let maxOcc = 0

  for (let i = 0; i < totalSteps; i++) {
    const metHours = (i * DEFAULT_SAMPLE_MINUTES) / 60
    const utc = new Date(startMs + metHours * 3_600_000)
      .toISOString()
      .replace('.000Z', 'Z')
    // Exploratory synodic solar azimuth rotation + lunar librations around south pole.
    const sunAz =
      (((180 +
        metHours * 0.508 -
        normalizeLongitudeDeg(options.longitude_deg)) %
        360) +
        360) %
      360
    const sunEl =
      1.15 + Math.sin(metHours * 0.012 + options.latitude_deg * 0.1) * 0.55
    const earthAz =
      (((-normalizeLongitudeDeg(options.longitude_deg) +
        Math.sin(metHours * 0.0096) * 5.2) %
        360) +
        360) %
      360
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
      unknownSun ||= sunVis === null
      unknownEarth ||= earthVis === null
      unknownBoth ||=
        sunVis !== false &&
        earthVis !== false &&
        (sunVis === null || earthVis === null)
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
      sunlight_hours: unknownSun ? null : sunHours,
      sunlight_fraction: unknownSun ? null : sunHours / DEFAULT_DURATION_HOURS,
      max_darkness_hours: unknownSun ? null : maxDark,
      earth_visible_hours: unknownEarth ? null : earthHours,
      earth_visible_fraction: unknownEarth
        ? null
        : earthHours / DEFAULT_DURATION_HOURS,
      max_earth_occlusion_hours: unknownEarth ? null : maxOcc,
      both_visible_hours: unknownBoth ? null : bothHours,
    },
  }
}

async function fetchJsonOrNull<T>(
  url: string,
  init?: RequestInit,
): Promise<T | null> {
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
    ...analysis.provenance.sources.map(
      (s) => `# source: ${s.id}|${s.sha256}|${s.uri}`,
    ),
    ...analysis.provenance.assumptions.map(
      (a) => `# assumption: ${a.replace(/[\r\n]+/g, ' ')}`,
    ),
    `# reference_radius_m: ${analysis.coordinates.reference_radius_m}`,
    `# sample_minutes: ${analysis.sample_minutes}`,
    `# metrics: ${JSON.stringify(analysis.metrics)}`,
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

  const rows = analysis.samples.map((s) =>
    [
      s.utc,
      s.met_hours,
      s.sun.azimuth_deg,
      s.sun.elevation_deg,
      s.sun.angular_diameter_deg,
      s.sun.horizon_deg === null ? '' : s.sun.horizon_deg,
      s.sun.visible === null ? '' : String(s.sun.visible),
      s.sun.illumination_fraction === null ? '' : s.sun.illumination_fraction,
      s.earth.azimuth_deg,
      s.earth.elevation_deg,
      s.earth.angular_diameter_deg,
      s.earth.horizon_deg === null ? '' : s.earth.horizon_deg,
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
        body: JSON.stringify({ analysis_id: analysis.analysis_id, format }),
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
  const mime =
    format === 'json'
      ? 'application/json;charset=utf-8'
      : 'text/csv;charset=utf-8'
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
  if (observerHeightM !== 2)
    throw new Error('Only the recorded 2 m observer is supported.')
  const demPromise = site.terrainSiteId
    ? loadDemTerrain(site.terrainSiteId)
    : Promise.resolve(null)
  const recommendLoader = site.terrainSiteId
    ? PROCESSED_ASSET_LOADERS[site.terrainSiteId]
    : undefined

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

  const [demTerrain, liveAnalysis] = await Promise.all([
    demPromise,
    livePromise,
  ])

  let recommendations: ContractRecommendDocument | null = null
  if (site.scienceSiteId) {
    recommendations = await fetchJsonOrNull<ContractRecommendDocument>(
      '/api/recommend',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          origin_site_id: site.scienceSiteId,
          search_radius_m: DEFAULT_RECOMMEND_RADIUS_M,
        }),
      },
    )
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
    const effectiveSlope =
      liveAnalysis.slope.angle_deg ?? demTerrain?.centerSlopeDeg ?? null
    return {
      target: {
        id: site.id,
        name: site.name,
        latitude_deg: liveAnalysis.coordinates.latitude_deg,
        longitude_deg: normalizeLongitudeDeg(
          liveAnalysis.coordinates.longitude_deg,
        ),
        elevation_m: liveAnalysis.coordinates.elevation_m,
        isCatalogSite: true,
        catalogEntry: site,
      },
      sourceMode:
        liveAnalysis.provenance.data_kind === 'live_real'
          ? 'live_api'
          : 'cached_real',
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
  if (site.id === 'site01_connecting_ridge') {
    const [{ default: nominal }, { default: diff }] = await Promise.all([
      import(
        '../../../backend/tests/fixtures/science/site01/analysis_nominal.json'
      ) as Promise<{
        default: ContractAnalysisDocument
      }>,
      import(
        '../../../backend/tests/fixtures/science/site01/diff_delay48h.json'
      ) as Promise<{
        default: ContractDiffDocument
      }>,
    ])
    const effectiveSlope =
      nominal.slope.angle_deg ?? demTerrain?.centerSlopeDeg ?? null
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
        elevation_deg:
          typeof angle === 'number' && Number.isFinite(angle) ? angle : null,
        coverage:
          typeof angle === 'number' && Number.isFinite(angle)
            ? 'complete'
            : 'unknown',
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
    sourceNote:
      'Real NASA LOLA 129×129 DEM + real 360° horizon · Preview ephemeris',
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
  const step = 360 / Math.max(options.horizonAnglesDeg.length, 1)
  const horizon: ContractHorizonPoint[] = options.horizonAnglesDeg.map(
    (el, i) => ({
      azimuth_deg: i * step,
      elevation_deg: Number.isFinite(el) ? el : null,
      coverage: Number.isFinite(el) ? 'complete' : 'unknown',
    }),
  )

  const analysis = buildExploratoryAnalysis({
    siteId: `coord-${options.latitude_deg.toFixed(2)}-${normLon.toFixed(1)}`,
    latitude_deg: options.latitude_deg,
    longitude_deg: normLon,
    elevation_m: options.elevation_m,
    observerHeightM: options.observerHeightM,
    horizon,
    slopeDeg: null,
    modelVersion: 'spherical-explorer-preview-v1',
    assumptions: [
      'Unverified exploratory coordinate outside the 4 pre-processed NASA LOLA high-res DEM patches.',
      'Horizon and visibility values reflect spherical analytical exploration only; not flight-certified.',
    ],
  })

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
    sourceNote:
      'Exploratory spherical terrain preview (outside LOLA DEM patches)',
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

export const api = {
  async getDashboardPreview(): Promise<DashboardPreview> {
    return structuredClone(legacyPreview)
  },
}
