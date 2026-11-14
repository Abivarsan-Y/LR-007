// Legacy Phase 1-3 exports preserved for untouched compatibility components.
export interface Site {
  id: string
  name: string
}

export interface MissionSetup {
  siteId: string
  startDateUtc: string
  observerHeightM: number
  durationDays: number
  delayHours: 0 | 24 | 48
}

export interface DashboardPreview {
  source: 'synthetic'
  sites: Site[]
  defaults: MissionSetup
  metrics: {
    sunlightPercent: number
    maxDarknessHours: number
    dtePercent: number
  }
}

export type DataKind = 'cached_real' | 'live' | 'synthetic'

export interface ProvenanceSource {
  id: string
  uri: string
  sha256: string
}

export interface Provenance {
  data_kind: DataKind
  model_version: string
  sources: ProvenanceSource[]
  assumptions: string[]
}

export interface Coordinates {
  latitude_deg: number
  longitude_deg: number
  elevation_m: number
  frame: string
  reference_radius_m: number
}

export interface ContractSiteDocument {
  schema_version: string
  provenance: Provenance
  site_id: string
  name: string
  coordinates: Coordinates
}

export interface SunSample {
  azimuth_deg: number
  elevation_deg: number
  angular_diameter_deg: number
  horizon_deg: number | null
  visible: boolean | null
  illumination_fraction: number | null
}

export interface EarthSample {
  azimuth_deg: number
  elevation_deg: number
  angular_diameter_deg: number
  horizon_deg: number | null
  visible: boolean | null
}

export interface AnalysisSample {
  utc: string
  met_hours: number
  sun: SunSample
  earth: EarthSample
}

export interface ContractHorizonPoint {
  azimuth_deg: number
  elevation_deg: number | null
  coverage: 'complete' | 'unknown'
}

export type SlopeBand = 'SAFE' | 'CAUTION' | 'HAZARD' | 'UNKNOWN'

export interface ContractAnalysisDocument {
  schema_version: string
  provenance: Provenance
  analysis_id: string
  site_id: string
  coordinates: Coordinates
  start_utc: string
  end_utc: string
  observer_height_m: number
  sample_minutes: number
  samples: AnalysisSample[]
  horizon: ContractHorizonPoint[]
  slope: {
    angle_deg: number | null
    screening_status: SlopeBand
  }
  metrics: {
    sunlight_hours: number | null
    sunlight_fraction: number | null
    max_darkness_hours: number | null
    earth_visible_hours: number | null
    earth_visible_fraction: number | null
    max_earth_occlusion_hours: number | null
    both_visible_hours: number | null
  }
}

export type DiffIntervalType =
  | 'GAINED_SUNLIGHT'
  | 'LOST_SUNLIGHT'
  | 'GAINED_EARTH_VISIBILITY'
  | 'LOST_EARTH_VISIBILITY'

export interface DiagnosticInterval {
  type: DiffIntervalType
  start_met_hours: number
  end_met_hours: number
  reason: string
}

export interface ContractDiffDocument {
  schema_version: string
  provenance: Provenance
  scenario_a_id: string
  scenario_b_id: string
  duration_hours: number
  alignment: 'mission_elapsed_time'
  delta_convention: 'B_minus_A'
  deltas: {
    sunlight_hours: number | null
    max_darkness_hours: number | null
    earth_visible_hours: number | null
  }
  diagnostic_intervals: DiagnosticInterval[]
}

export interface RecommendCandidate {
  site_id: string
  coordinates: Coordinates
  distance_m: number
  bearing_deg: number
  slope_deg: number
  sunlight_fraction_delta: number | null
}

export interface ContractRecommendDocument {
  schema_version: string
  provenance: Provenance
  origin_site_id: string
  search_radius_m: number
  candidates: RecommendCandidate[]
}

export interface TerrainMetadata {
  schema_version: string
  provenance: Provenance
  site_id: string
  asset_path: string
  sha256: string
  encoding: string
  width: number
  height: number
  spacing_m: number
  coordinates: Coordinates
  layout: string
  height_reference: string
  nodata_encoding: string
  scene_axes: string
}

export interface DecodedDemSiteTerrain {
  siteId: string
  metadata: TerrainMetadata
  positions: Float32Array
  indices: Uint32Array
  slopeDegPerVertex: Float32Array
  centerSlopeDeg: number | null
  minRelY: number
  maxRelY: number
  span: number
  groundY: number | null
  missingVertices: number
}

export interface CatalogSiteEntry {
  id: string
  scienceSiteId: string | null
  terrainSiteId: string | null
  polarId: string | null
  name: string
  shortName: string
  region: string
  description: string
  latitude_deg: number
  longitude_deg: number
  elevation_m: number
  recommended_mast_m: number
  hasDem: boolean
  hasVerifiedAnalysis: boolean
  tag: string
}

export type WorkspaceSourceMode = 'live_api' | 'cached_real' | 'dem_preview' | 'synthetic'

export interface LoadedSiteWorkspace {
  target: {
    id: string
    name: string
    latitude_deg: number
    longitude_deg: number
    elevation_m: number
    isCatalogSite: boolean
    catalogEntry?: CatalogSiteEntry
  }
  sourceMode: WorkspaceSourceMode
  sourceNote: string
  analysis: ContractAnalysisDocument
  diff48h: ContractDiffDocument | null
  recommendations: ContractRecommendDocument | null
  demTerrain: DecodedDemSiteTerrain | null
  effectiveSlopeDeg: number | null
  effectiveSlopeBand: SlopeBand
}
