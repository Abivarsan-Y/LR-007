import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Compass,
  Crosshair,
  Download,
  ExternalLink,
  Eye,
  EyeOff,
  Globe,
  Info,
  Layers,
  Navigation,
  Pause,
  Play,
  RotateCcw,
  Search,
  Sparkles,
  Undo2,
  X,
} from 'lucide-react'
import {
  advanceSolarGeometry,
  buildCustomCoordinateWorkspace,
  buildResearchTargetOptions,
  CATALOG_SITES,
  classifySlopeBand,
  computeStepKinematicsAndPower,
  exportAnalysisReport,
  formatLatLonCompact,
  interpolateHorizonSample,
  interpolateRoverPositionAtTime,
  loadCatalogSiteWorkspace,
  loadCustomCoordinateWorkspace,
  normalizeLongitudeDeg,
  POLAR_LANDMARKS,
  requestTraverseAutomatic,
  requestTraverseManual,
  sampleDemAtLatLon,
  sphericalDistanceAndBearing,
} from './api/client'
import type {
  CatalogSiteEntry,
  LoadedSiteWorkspace,
  TraverseAutomaticResponse,
  TraverseManualCandidate,
  TraverseManualResponse,
  TraverseResearchTargetOption,
  TraverseWaypoint,
} from './api/types'
import { HorizonProfileCanvas } from './features/analysis/HorizonProfileCanvas'
import {
  CesiumLunarStage,
  type SurfaceCameraPreset,
  type SurfacePickEvent,
  type TerrainOverlayMode,
} from './features/map/CesiumLunarStage'
import { PolarMap } from './features/map/PolarMap'

function parseCoordinateQuery(raw: string): { lat: number; lon: number } | null {
  const cleaned = raw.trim().replace(/°/g, ' ').replace(/,/g, ' ')
  if (!cleaned) return null
  const regex = /^([+-]?\d+(?:\.\d+)?)\s*([NSns])?(?:\s+([+-]?\d+(?:\.\d+)?)\s*([EWew])?)?$/
  const m = cleaned.match(regex)
  if (!m) return null

  let lat = parseFloat(m[1])
  const latHem = m[2]?.toUpperCase()
  if (latHem === 'S') lat = -Math.abs(lat)
  if (latHem === 'N') lat = Math.abs(lat)

  let lon = m[3] !== undefined ? parseFloat(m[3]) : 0
  const lonHem = m[4]?.toUpperCase()
  if (lonHem === 'W') lon = -Math.abs(lon)
  if (lonHem === 'E') lon = Math.abs(lon)

  if (Number.isNaN(lat) || Number.isNaN(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
    return null
  }
  return { lat, lon: normalizeLongitudeDeg(lon) }
}

function extractAzimuthFromReason(reason: string): number | null {
  const match = reason.match(/azimuth\s+(\d+(?:\.\d+)?)\s*deg/i)
  return match ? Number(match[1]) : null
}

function getExternalLunarLinks(latDeg: number, lonDeg: number) {
  const lonNorm = normalizeLongitudeDeg(lonDeg)
  const lon360 = ((lonNorm % 360) + 360) % 360
  return [
    {
      name: 'LROC QuickMap',
      tag: 'South Pole Mosaic',
      url: 'https://quickmap.lroc.im-ldi.com/?prjExtent=-2984543.5643564%2C-1737400%2C2984543.5643564%2C1737400&earthShadowEnabled=true&proj=10&stack=3314&defs=N4IgzGCMAsIFygPYAcCGBjAlgFwJ70gF9Cg',
    },
    {
      name: 'NASA Moon Trek',
      tag: `${latDeg.toFixed(2)}°, ${lon360.toFixed(1)}°E`,
      url: 'https://trek.nasa.gov/moon/',
    },
    {
      name: 'JPL Horizons',
      tag: 'Sun / Earth Ephem',
      url: 'https://ssd.jpl.nasa.gov/horizons/',
    },
    {
      name: 'CSA Moon Portal',
      tag: 'Artemis & Science',
      url: 'https://www.asc-csa.gc.ca/eng/astronomy/moon-exploration/',
    },
  ]
}

export function App() {
  const [workspace, setWorkspace] = useState<LoadedSiteWorkspace | null>(null)
  const [loadingTarget, setLoadingTarget] = useState(false)
  const [loadError, setLoadError] = useState('')
  const requestSequence = useRef(0)
  const [observerHeightM, setObserverHeightM] = useState<2 | 5>(2)
  const [sampleIndex, setSampleIndex] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState<1 | 5 | 20>(1)

  // Camera, surface preset & NASA WMTS imagery state
  const [cameraMode, setCameraMode] = useState<'ORBITAL' | 'SURFACE'>('ORBITAL')
  const [desiredCameraMode, setDesiredCameraMode] = useState<'ORBITAL' | 'SURFACE'>('ORBITAL')
  const [surfacePreset, setSurfacePreset] = useState<SurfaceCameraPreset>('OBLIQUE')
  const [cameraPresetNonce, setCameraPresetNonce] = useState(0)
  const [focusCoords, setFocusCoords] = useState<{ latitude_deg: number; longitude_deg: number } | null>(null)
  const [useNasaTrekImagery, setUseNasaTrekImagery] = useState(true)
  const [nasaImageryStatus, setNasaImageryStatus] = useState<'loading' | 'loaded' | 'offline'>('loading')

  // DEM / visualization overlays
  const [overlayMode, setOverlayMode] = useState<TerrainOverlayMode>('albedo')
  const [showWireframe, setShowWireframe] = useState(false)
  const [verticalScale, setVerticalScale] = useState<1 | 2 | 4>(2)
  const [polarOpen, setPolarOpen] = useState(false)

  // Floating hideable sidebars + master HUD visibility
  const [detailsVisible, setDetailsVisible] = useState(true)
  const [leftSidebarOpen, setLeftSidebarOpen] = useState(true)
  const [rightSidebarOpen, setRightSidebarOpen] = useState(true)

  // Sub-selection & diagnostics state
  const [highlightedCandidateId, setHighlightedCandidateId] = useState<string | null>(null)
  const [diffHighlightAzimuth, setDiffHighlightAzimuth] = useState<number | null>(null)
  const [horizonHoverText, setHorizonHoverText] = useState<string | null>(null)
  const [showProvenanceInfo, setShowProvenanceInfo] = useState(false)

  // Search pill state
  const [searchQuery, setSearchQuery] = useState('')
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const searchWrapperRef = useRef<HTMLDivElement>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)

  // Lunar Rover Traverse Planner state (Manual & Automatic modes)
  const [traverseOpen, setTraverseOpen] = useState(true)
  const [traverseMode, setTraverseMode] = useState<'manual' | 'automatic'>('manual')
  const [traverseTarget, setTraverseTarget] = useState<TraverseResearchTargetOption | null>(null)
  const [pickingTraverseTarget, setPickingTraverseTarget] = useState(false)
  const [traverseStepDistanceM, setTraverseStepDistanceM] = useState(250)
  const [traverseWaypoints, setTraverseWaypoints] = useState<TraverseWaypoint[]>([])
  const [traverseCandidates, setTraverseCandidates] = useState<TraverseManualCandidate[]>([])
  const [traverseManualPos, setTraverseManualPos] = useState<TraverseManualResponse['current_position'] | null>(null)
  const [traverseAutoResult, setTraverseAutoResult] = useState<TraverseAutomaticResponse | null>(null)
  const [traverseLoading, setTraverseLoading] = useState(false)
  const [roverSimHours, setRoverSimHours] = useState(0)
  const [isRoverPlaying, setIsRoverPlaying] = useState(false)
  const traverseRequestSeq = useRef(0)
  const traverseSectionRef = useRef<HTMLElement>(null)

  const selectCatalogSite = useCallback(
    async (site: CatalogSiteEntry, zoomSurface = true, mastOverride?: 2 | 5) => {
      const sequence = ++requestSequence.current
      const mast = site.hasVerifiedAnalysis ? 2 : mastOverride ?? observerHeightM
      setObserverHeightM(mast)
      setLoadError('')
      setLoadingTarget(true)
      setDetailsVisible(true)
      setLeftSidebarOpen(true)
      setRightSidebarOpen(true)
      setHighlightedCandidateId(null)
      setDiffHighlightAzimuth(null)
      setShowProvenanceInfo(false)
      setDropdownOpen(false)
      setSearchQuery(site.shortName)

      try {
        const loaded = await loadCatalogSiteWorkspace(site, mast)
        if (sequence !== requestSequence.current) return
        setWorkspace(loaded)
        setFocusCoords({ latitude_deg: site.latitude_deg, longitude_deg: site.longitude_deg })
        if (zoomSurface) setDesiredCameraMode('SURFACE')
        setCameraPresetNonce(n => n + 1)
        setSampleIndex(idx => Math.min(idx, Math.max(loaded.analysis.samples.length - 1, 0)))
      } catch {
        if (sequence === requestSequence.current) setLoadError('Site data could not load. Select the site again to retry.')
      } finally {
        if (sequence === requestSequence.current) setLoadingTarget(false)
      }
    },
    [observerHeightM],
  )

  const selectCustomCoordinate = useCallback(
    (
      lat: number,
      lon: number,
      label: string,
      elevM?: number,
      horizonAngles: number[] = [],
      zoomSurface = true,
    ) => {
      setDetailsVisible(true)
      setLeftSidebarOpen(true)
      setRightSidebarOpen(true)
      setHighlightedCandidateId(null)
      setDiffHighlightAzimuth(null)
      setShowProvenanceInfo(false)
      setDropdownOpen(false)
      setSearchQuery(
        label === 'Coordinate Target' || label === 'Surface Coordinate' ? formatLatLonCompact(lat, lon) : label,
      )
      setFocusCoords({ latitude_deg: lat, longitude_deg: lon })
      if (zoomSurface) setDesiredCameraMode('SURFACE')
      setCameraPresetNonce(n => n + 1)

      const sequence = ++requestSequence.current
      const existingDem =
        workspace?.demTerrain && sampleDemAtLatLon(workspace.demTerrain, lat, lon).insidePatch
          ? workspace.demTerrain
          : null
      setLoadingTarget(false)
      setLoadError('')
      const custom = buildCustomCoordinateWorkspace({
        label,
        latitude_deg: lat,
        longitude_deg: lon,
        elevation_m: elevM,
        observerHeightM,
        horizonAnglesDeg: horizonAngles,
        demTerrain: existingDem,
      })
      setWorkspace(custom)
      setSampleIndex(0)
      setRoverSimHours(0)
      setIsRoverPlaying(false)

      if (horizonAngles.length < 36) {
        void loadCustomCoordinateWorkspace({
          label,
          latitude_deg: lat,
          longitude_deg: lon,
          observerHeightM,
          demTerrain: existingDem,
        }).then(loaded => {
          if (sequence !== requestSequence.current) return
          setWorkspace(loaded)
        })
      }
    },
    [observerHeightM, workspace?.demTerrain],
  )

  const clearSelection = useCallback(() => {
    requestSequence.current += 1
    setLoadingTarget(false)
    setLoadError('')
    setWorkspace(null)
    setPlaying(false)
    setSearchQuery('')
    setDropdownOpen(false)
    setHighlightedCandidateId(null)
    setDiffHighlightAzimuth(null)
    setShowProvenanceInfo(false)
    setPickingTraverseTarget(false)
    setTraverseWaypoints([])
    setTraverseCandidates([])
    setTraverseAutoResult(null)
    setRoverSimHours(0)
    setIsRoverPlaying(false)
    setDesiredCameraMode('ORBITAL')
    setCameraPresetNonce(n => n + 1)
  }, [])

  const applyCameraPreset = useCallback(
    (mode: 'ORBITAL' | 'SURFACE', preset?: SurfaceCameraPreset) => {
      if (preset) setSurfacePreset(preset)
      if (!workspace && mode === 'SURFACE') {
        void selectCatalogSite(CATALOG_SITES[0], true)
        return
      }
      setDesiredCameraMode(mode)
      setCameraPresetNonce(n => n + 1)
    },
    [selectCatalogSite, workspace],
  )

  // Only request heights supported by the selected recorded scenario.
  const handleMastToggle = useCallback(async (nextMast: 2 | 5) => {
    if (nextMast === observerHeightM || (nextMast === 5 && workspace?.target.catalogEntry?.hasVerifiedAnalysis)) return
    setObserverHeightM(nextMast)
    if (workspace?.target.catalogEntry) {
      await selectCatalogSite(workspace.target.catalogEntry, false, nextMast)
      return
    }
    if (workspace && !workspace.target.isCatalogSite) {
      const sequence = ++requestSequence.current
      const immediate = buildCustomCoordinateWorkspace({
        label: workspace.target.name,
        latitude_deg: workspace.target.latitude_deg,
        longitude_deg: workspace.target.longitude_deg,
        elevation_m: workspace.target.elevation_m,
        slopeDeg: workspace.effectiveSlopeDeg,
        observerHeightM: nextMast,
        horizonAnglesDeg: [],
        demTerrain: workspace.demTerrain,
      })
      setWorkspace(immediate)
      const evaluated = await loadCustomCoordinateWorkspace({
        label: workspace.target.name,
        latitude_deg: workspace.target.latitude_deg,
        longitude_deg: workspace.target.longitude_deg,
        observerHeightM: nextMast,
        demTerrain: workspace.demTerrain,
      })
      if (sequence === requestSequence.current) setWorkspace(evaluated)
    }
  }, [observerHeightM, workspace, selectCatalogSite])

  // Handle clicks anywhere on the 3D Moon or inside the real 129x129 DEM patch
  const handlePickPoint = useCallback(
    (pick: SurfacePickEvent) => {
      if (pick.matchedCatalogSite && workspace?.target.id === pick.matchedCatalogSite.id && workspace.demTerrain) {
        setHighlightedCandidateId(null)
        setWorkspace(prev =>
          prev
            ? {
                ...prev,
                target: {
                  ...prev.target,
                  name: pick.label,
                  latitude_deg: pick.latitude_deg,
                  longitude_deg: pick.longitude_deg,
                  elevation_m: pick.elevation_m,
                },
                effectiveSlopeDeg: pick.slope_deg ?? prev.effectiveSlopeDeg,
                effectiveSlopeBand: classifySlopeBand(pick.slope_deg ?? prev.effectiveSlopeDeg),
              }
            : prev,
        )
        return
      }

      if (pick.matchedCatalogSite) {
        void selectCatalogSite(pick.matchedCatalogSite, false)
        return
      }

      setDetailsVisible(true)
      setLeftSidebarOpen(true)
      setRightSidebarOpen(true)
      setFocusCoords({ latitude_deg: pick.latitude_deg, longitude_deg: pick.longitude_deg })
      setSearchQuery(formatLatLonCompact(pick.latitude_deg, pick.longitude_deg))
      const sequence = ++requestSequence.current
      const existingDem =
        workspace?.demTerrain &&
        sampleDemAtLatLon(workspace.demTerrain, pick.latitude_deg, pick.longitude_deg).insidePatch
          ? workspace.demTerrain
          : null
      setLoadingTarget(false)
      setLoadError('')
      setWorkspace(
        buildCustomCoordinateWorkspace({
          label: pick.label,
          latitude_deg: pick.latitude_deg,
          longitude_deg: pick.longitude_deg,
          elevation_m: pick.elevation_m,
          slopeDeg: pick.slope_deg,
          observerHeightM,
          horizonAnglesDeg: pick.horizonAnglesDeg,
          demTerrain: existingDem,
        }),
      )
      setSampleIndex(0)
      setRoverSimHours(0)
      setIsRoverPlaying(false)

      if (pick.horizonAnglesDeg.length < 36) {
        void loadCustomCoordinateWorkspace({
          label: pick.label,
          latitude_deg: pick.latitude_deg,
          longitude_deg: pick.longitude_deg,
          observerHeightM,
          demTerrain: existingDem,
        }).then(loaded => {
          if (sequence !== requestSequence.current) return
          setWorkspace(loaded)
        })
      }
    },
    [observerHeightM, selectCatalogSite, workspace],
  )

  // Keyboard Escape dismisses dropdown or HUD; H toggles HUD cleanly
  useEffect(() => {
    const onPointerDown = (e: MouseEvent) => {
      if (searchWrapperRef.current && !searchWrapperRef.current.contains(e.target as Node)) {
        setDropdownOpen(false)
      }
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (dropdownOpen) {
          setDropdownOpen(false)
          searchInputRef.current?.blur()
          return
        }
        if (polarOpen && !workspace) {
          setPolarOpen(false)
          return
        }
        if (document.activeElement !== searchInputRef.current && workspace) {
          setDetailsVisible(false)
        }
      } else if ((e.key === 'h' || e.key === 'H') && document.activeElement !== searchInputRef.current && workspace) {
        setDetailsVisible(v => !v)
      }
    }
    document.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [dropdownOpen, polarOpen, workspace])

  // Synchronized Timeline & Rover Playback
  const samples = workspace?.analysis.samples ?? []
  const lastSampleIdx = Math.max(samples.length - 1, 0)
  const currentSample = samples[sampleIndex] ?? samples[0] ?? null
  const landingSunAz = samples[0]?.sun.azimuth_deg ?? 180.0
  const landingSunEl = samples[0]?.sun.elevation_deg ?? 1.0

  const maxRoverMetHours = useMemo(() => {
    if (!traverseWaypoints.length) return 0
    const last = traverseWaypoints[traverseWaypoints.length - 1]
    return last.met_hours ?? last.arrival_met_hours ?? 0
  }, [traverseWaypoints])

  const activeRoverState = useMemo(() => {
    if (!traverseOpen || !traverseWaypoints.length) return null
    return interpolateRoverPositionAtTime(traverseWaypoints, roverSimHours, landingSunAz, landingSunEl, samples)
  }, [traverseOpen, traverseWaypoints, roverSimHours, landingSunAz, landingSunEl, samples])

  useEffect(() => {
    if (!playing || samples.length === 0) return
    if (sampleIndex >= lastSampleIdx) {
      setPlaying(false)
      return
    }
    const timer = window.setTimeout(() => {
      setSampleIndex(prev => {
        const next = Math.min(prev + 1, lastSampleIdx)
        if (next >= lastSampleIdx) setPlaying(false)
        if (maxRoverMetHours > 0) {
          const nextMet = samples[next]?.met_hours ?? next * 0.5
          setRoverSimHours(Math.min(maxRoverMetHours, nextMet))
        }
        return next
      })
    }, 1000 / speed)
    return () => window.clearTimeout(timer)
  }, [playing, sampleIndex, lastSampleIdx, speed, samples, maxRoverMetHours])

  useEffect(() => {
    if (!isRoverPlaying || maxRoverMetHours <= 0) return
    if (roverSimHours >= maxRoverMetHours) {
      setIsRoverPlaying(false)
      return
    }
    const timer = window.setTimeout(() => {
      const stepH =
        traverseMode === 'manual'
          ? Math.max(0.01, maxRoverMetHours / 45)
          : Math.max(0.02, maxRoverMetHours / 75)
      const nextH = Math.min(maxRoverMetHours, roverSimHours + stepH)
      setRoverSimHours(nextH)
      if (samples.length > 0) {
        setSampleIndex(Math.min(lastSampleIdx, Math.max(0, Math.round(nextH * 2))))
      }
      if (nextH >= maxRoverMetHours) setIsRoverPlaying(false)
    }, 85)
    return () => window.clearTimeout(timer)
  }, [isRoverPlaying, roverSimHours, maxRoverMetHours, samples.length, lastSampleIdx, traverseMode])

  // Filtered Search Options
  const parsedCoords = useMemo(() => parseCoordinateQuery(searchQuery), [searchQuery])
  const filteredCatalog = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    return CATALOG_SITES.filter(
      s => !q || s.name.toLowerCase().includes(q) || s.region.toLowerCase().includes(q) || s.tag.toLowerCase().includes(q),
    )
  }, [searchQuery])
  const filteredLandmarks = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    return POLAR_LANDMARKS.filter(
      l => !q || l.name.toLowerCase().includes(q) || l.tag.toLowerCase().includes(q),
    ).slice(0, 3)
  }, [searchQuery])

  // Horizon Peak Obstruction readout
  const peakObstruction = useMemo(() => {
    if (!workspace?.analysis.horizon.length) return null
    let bestEl = Number.NEGATIVE_INFINITY
    let bestAz = 0
    for (const pt of workspace.analysis.horizon) {
      if (pt.elevation_deg !== null && pt.elevation_deg > bestEl) {
        bestEl = pt.elevation_deg
        bestAz = pt.azimuth_deg
      }
    }
    return Number.isFinite(bestEl) ? { el: bestEl, az: bestAz } : null
  }, [workspace?.analysis.horizon])

  // Active Earth & Sun LoS Margins
  const earthHorizAtSample = useMemo(() => {
    if (!workspace || !currentSample) return null
    return currentSample.earth.horizon_deg ?? interpolateHorizonSample(workspace.analysis.horizon, currentSample.earth.azimuth_deg)
  }, [workspace, currentSample])

  const earthMarginDeg =
    currentSample && earthHorizAtSample !== null
      ? currentSample.earth.elevation_deg - earthHorizAtSample
      : null

  const sunIn = currentSample?.sun.visible === true
  const earthIn = currentSample?.earth.visible === true

  const badgeStyle = useMemo(() => {
    if (!workspace) return { label: '', cls: '' }
    switch (workspace.sourceMode) {
      case 'live_api':
        return {
          label: 'LIVE API · LOLA+JPL',
          cls: 'border-emerald-400/45 bg-emerald-400/15 text-emerald-300',
        }
      case 'cached_real':
        return {
          label: 'CACHED REAL · LOLA+JPL',
          cls: 'border-emerald-400/35 bg-emerald-400/10 text-emerald-300',
        }
      case 'dem_preview':
        return {
          label: 'REAL LOLA DEM · PREVIEW EPHEM',
          cls: 'border-amber-400/35 bg-amber-400/10 text-amber-300',
        }
      default:
        return {
          label: 'COORDINATE INSPECTION · NO ANALYSIS',
          cls: 'border-white/15 bg-white/[0.04] text-slate-300',
        }
    }
  }, [workspace])

  const slopeColorCls = useMemo(() => {
    switch (workspace?.effectiveSlopeBand) {
      case 'SAFE':
        return 'text-emerald-400'
      case 'CAUTION':
        return 'text-amber-300'
      case 'HAZARD':
        return 'text-rose-400'
      default:
        return 'text-slate-400'
    }
  }, [workspace?.effectiveSlopeBand])

  const externalLinks = useMemo(
    () =>
      getExternalLunarLinks(
        workspace?.target.latitude_deg ?? -89.46,
        workspace?.target.longitude_deg ?? -137.5,
      ),
    [workspace?.target.latitude_deg, workspace?.target.longitude_deg],
  )

  const traverseResearchTargets = useMemo(
    () => (workspace ? buildResearchTargetOptions(workspace) : []),
    [workspace],
  )
  const waterIceTargets = useMemo(
    () => traverseResearchTargets.filter(t => t.category === 'water_ice_crater'),
    [traverseResearchTargets],
  )
  const mappedRimTargets = useMemo(
    () => traverseResearchTargets.filter(t => t.category === 'mapped_site_rim'),
    [traverseResearchTargets],
  )
  const safeHavenTargets = useMemo(
    () => traverseResearchTargets.filter(t => t.category === 'safe_haven'),
    [traverseResearchTargets],
  )

  const makeBasePodWaypoint = useCallback(
    (
      ws: LoadedSiteWorkspace,
      target: { latitude_deg: number; longitude_deg: number } | null,
      illumFraction: number,
    ): TraverseWaypoint => {
      const elev =
        ws.demTerrain !== null
          ? sampleDemAtLatLon(ws.demTerrain, ws.target.latitude_deg, ws.target.longitude_deg).elevationM
          : ws.target.elevation_m
      const distToTarget = target
        ? sphericalDistanceAndBearing(
            ws.target.latitude_deg,
            ws.target.longitude_deg,
            target.latitude_deg,
            target.longitude_deg,
          ).distanceM
        : 0
      const sun0 = ws.analysis.samples[0]?.sun
      return {
        waypoint_index: 0,
        coordinates: {
          latitude_deg: ws.target.latitude_deg,
          longitude_deg: ws.target.longitude_deg,
          elevation_m: Number(elev.toFixed(1)),
        },
        distance_from_start_m: 0,
        distance_to_target_m: Number(distToTarget.toFixed(1)),
        slope_deg: Number((ws.effectiveSlopeDeg ?? 0).toFixed(1)),
        illumination_fraction: Number(illumFraction.toFixed(3)),
        battery_wh: 1000.0,
        battery_before_regen_wh: 1000.0,
        battery_reserve_pct: 83.3,
        effective_speed_mps: 0.0,
        drive_duration_hours: 0.0,
        regen_dwell_hours: 0.0,
        regen_energy_wh: 0.0,
        arrival_met_hours: 0.0,
        met_hours: 0.0,
        sun_azimuth_deg: Number((sun0?.azimuth_deg ?? 180.0).toFixed(1)),
        sun_elevation_deg: Number((sun0?.elevation_deg ?? 1.0).toFixed(2)),
        los_to_base: true,
        action: 'START_BASE_POD',
      }
    },
    [],
  )

  // Initialize Base Pod waypoint without assuming a random destination on site open
  useEffect(() => {
    if (!workspace) {
      setTraverseTarget(null)
      setTraverseWaypoints([])
      setTraverseCandidates([])
      setTraverseManualPos(null)
      setTraverseAutoResult(null)
      setPickingTraverseTarget(false)
      setTraverseStepDistanceM(250)
      setRoverSimHours(0)
      setIsRoverPlaying(false)
      return
    }
    setTraverseTarget(null)
    setPickingTraverseTarget(false)
    setTraverseAutoResult(null)
    setTraverseCandidates([])
    setTraverseManualPos(null)
    setTraverseStepDistanceM(250)
    setRoverSimHours(0)
    setIsRoverPlaying(false)
    const initIllum = workspace.analysis.samples[0]?.sun.illumination_fraction ?? 1.0
    setTraverseWaypoints([makeBasePodWaypoint(workspace, null, initIllum)])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspace?.target.id, makeBasePodWaypoint])

  // Manual Mode: fetch next forward candidate points whenever current waypoint or target changes
  const latestWaypoint = traverseWaypoints[traverseWaypoints.length - 1] ?? null

  useEffect(() => {
    if (!traverseOpen || traverseMode !== 'manual' || !workspace || !traverseTarget || !latestWaypoint) {
      return
    }
    if (
      latestWaypoint.action === 'ARRIVE_RESEARCH_TARGET' ||
      latestWaypoint.distance_to_target_m <= traverseStepDistanceM * 0.5
    ) {
      setTraverseCandidates([])
      return
    }
    const seq = ++traverseRequestSeq.current
    setTraverseLoading(true)
    void requestTraverseManual(
      {
        current_latitude_deg: latestWaypoint.coordinates.latitude_deg,
        current_longitude_deg: latestWaypoint.coordinates.longitude_deg,
        target_latitude_deg: traverseTarget.latitude_deg,
        target_longitude_deg: traverseTarget.longitude_deg,
        base_latitude_deg: workspace.target.latitude_deg,
        base_longitude_deg: workspace.target.longitude_deg,
        current_battery_wh: latestWaypoint.battery_wh,
        step_distance_m: traverseStepDistanceM,
        num_candidates: 6,
        sun_azimuth_deg: landingSunAz,
        sun_elevation_deg: landingSunEl,
        current_met_hours: latestWaypoint.met_hours ?? 0.0,
      },
      workspace.demTerrain,
      workspace.analysis.horizon,
      workspace.analysis.samples,
    )
      .then(res => {
        if (seq !== traverseRequestSeq.current) return
        setTraverseManualPos(res.current_position)
        setTraverseCandidates(res.candidates)
      })
      .finally(() => {
        if (seq === traverseRequestSeq.current) setTraverseLoading(false)
      })
  }, [
    traverseOpen,
    traverseMode,
    workspace,
    traverseTarget,
    latestWaypoint,
    traverseStepDistanceM,
    landingSunAz,
    landingSunEl,
  ])

  // Automatic Mode: compute optimal full path in one go from Base Pod to Research Target
  const runAutomaticTraversePlan = useCallback(() => {
    if (!workspace || !traverseTarget) return
    const seq = ++traverseRequestSeq.current
    const { distanceM: distToTargetM } = sphericalDistanceAndBearing(
      workspace.target.latitude_deg,
      workspace.target.longitude_deg,
      traverseTarget.latitude_deg,
      traverseTarget.longitude_deg,
    )
    const effectiveStepM = Math.max(traverseStepDistanceM, Math.min(20000, Math.ceil(distToTargetM / 25)))
    setTraverseLoading(true)
    setTraverseCandidates([])
    setTraverseManualPos(null)
    setIsRoverPlaying(false)
    setRoverSimHours(0)
    setSampleIndex(0)
    void requestTraverseAutomatic(
      {
        start_latitude_deg: workspace.target.latitude_deg,
        start_longitude_deg: workspace.target.longitude_deg,
        target_latitude_deg: traverseTarget.latitude_deg,
        target_longitude_deg: traverseTarget.longitude_deg,
        base_latitude_deg: workspace.target.latitude_deg,
        base_longitude_deg: workspace.target.longitude_deg,
        initial_battery_wh: 1000.0,
        step_m: effectiveStepM,
        max_steps: 40,
        sun_azimuth_deg: landingSunAz,
        sun_elevation_deg: landingSunEl,
        start_met_hours: 0.0,
      },
      workspace.demTerrain,
      workspace.analysis.horizon,
      workspace.analysis.samples,
    )
      .then(res => {
        if (seq !== traverseRequestSeq.current) return
        setTraverseAutoResult(res)
        setTraverseWaypoints(res.waypoints)
        if (res.waypoints.length > 1) {
          setPlaying(false)
          setSampleIndex(0)
          setRoverSimHours(0)
          setIsRoverPlaying(true)
        }
      })
      .finally(() => {
        if (seq === traverseRequestSeq.current) setTraverseLoading(false)
      })
  }, [workspace, traverseTarget, traverseStepDistanceM, landingSunAz, landingSunEl])

  useEffect(() => {
    if (!traverseOpen || traverseMode !== 'automatic' || !workspace || !traverseTarget) return
    runAutomaticTraversePlan()
  }, [traverseOpen, traverseMode, workspace, traverseTarget, runAutomaticTraversePlan])

  const handleSelectManualCandidate = useCallback(
    (cand: TraverseManualCandidate) => {
      if (!cand.is_valid || traverseMode !== 'manual') return
      const prevMet = latestWaypoint?.met_hours ?? 0
      const nextMet = cand.met_hours ?? (prevMet + (cand.drive_duration_hours ?? 0.25))
      const hasRegen = (cand.regen_dwell_hours ?? 0) > 0 && cand.illumination_fraction >= 0.15
      const isInPlaceRegen = Boolean(cand.is_regen_spot) && cand.step_distance_m < 5.0
      setTraverseWaypoints(prev => {
        const last = prev[prev.length - 1]
        if (isInPlaceRegen && last && prev.length > 1) {
          const updated: TraverseWaypoint = {
            ...last,
            distance_to_base_m: cand.distance_to_base_m ?? last.distance_to_base_m,
            return_to_base_wh: cand.return_to_base_wh ?? last.return_to_base_wh,
            distance_to_sunlit_m: cand.distance_to_sunlit_m ?? last.distance_to_sunlit_m,
            nearest_sunlit_illum_pct: cand.nearest_sunlit_illum_pct ?? last.nearest_sunlit_illum_pct,
            reach_sunlit_wh: cand.reach_sunlit_wh ?? last.reach_sunlit_wh,
            required_return_wh: cand.required_return_wh ?? last.required_return_wh,
            can_return_to_base: cand.can_return_to_base ?? last.can_return_to_base,
            battery_wh: cand.battery_wh,
            battery_reserve_pct: cand.battery_reserve_pct,
            regen_dwell_hours: Number(((last.regen_dwell_hours ?? 0) + (cand.regen_dwell_hours ?? 0)).toFixed(3)),
            regen_energy_wh: Number(((last.regen_energy_wh ?? 0) + (cand.regen_energy_wh ?? 0)).toFixed(1)),
            met_hours: nextMet,
            sun_azimuth_deg: cand.sun_azimuth_deg ?? last.sun_azimuth_deg,
            sun_elevation_deg: cand.sun_elevation_deg ?? last.sun_elevation_deg,
            action: 'SOLAR_REGEN_HOLD',
          }
          return [...prev.slice(0, -1), updated]
        }
        const prevDist = last?.distance_from_start_m ?? 0
        const nextIdx = prev.length
        const arrived = cand.distance_to_target_m <= 5.0
        return [
          ...prev,
          {
            waypoint_index: nextIdx,
            coordinates: cand.coordinates,
            distance_from_start_m: Number((prevDist + cand.step_distance_m).toFixed(1)),
            distance_to_target_m: arrived ? 0 : cand.distance_to_target_m,
            distance_to_base_m: cand.distance_to_base_m,
            return_to_base_wh: cand.return_to_base_wh,
            distance_to_sunlit_m: cand.distance_to_sunlit_m,
            nearest_sunlit_illum_pct: cand.nearest_sunlit_illum_pct,
            reach_sunlit_wh: cand.reach_sunlit_wh,
            required_return_wh: cand.required_return_wh,
            can_return_to_base: cand.can_return_to_base,
            slope_deg: cand.slope_deg,
            illumination_fraction: cand.illumination_fraction,
            battery_wh: cand.battery_wh,
            battery_before_regen_wh: cand.battery_before_regen_wh,
            battery_reserve_pct: cand.battery_reserve_pct,
            effective_speed_mps: cand.effective_speed_mps,
            drive_duration_hours: cand.drive_duration_hours,
            regen_dwell_hours: cand.regen_dwell_hours,
            regen_energy_wh: cand.regen_energy_wh,
            arrival_met_hours: cand.arrival_met_hours,
            met_hours: nextMet,
            sun_azimuth_deg: cand.sun_azimuth_deg,
            sun_elevation_deg: cand.sun_elevation_deg,
            los_to_base: cand.los_to_base,
            action: arrived ? 'ARRIVE_RESEARCH_TARGET' : hasRegen ? 'SOLAR_REGEN_HOLD' : `STEP_${nextIdx}`,
          },
        ]
      })
      setPlaying(false)
      setRoverSimHours(prevMet)
      setIsRoverPlaying(true)
      if (samples.length > 0) {
        setSampleIndex(Math.min(lastSampleIdx, Math.max(0, Math.round(prevMet * 2))))
      }
    },
    [traverseMode, latestWaypoint, samples.length, lastSampleIdx],
  )

  const handleCompleteManualArrival = useCallback(() => {
    if (!workspace || !traverseTarget || !latestWaypoint || latestWaypoint.action === 'ARRIVE_RESEARCH_TARGET') return
    const remDist = sphericalDistanceAndBearing(
      latestWaypoint.coordinates.latitude_deg,
      latestWaypoint.coordinates.longitude_deg,
      traverseTarget.latitude_deg,
      traverseTarget.longitude_deg,
    ).distanceM
    const prevMet = latestWaypoint.met_hours ?? 0
    const kin = computeStepKinematicsAndPower(
      remDist,
      latestWaypoint.slope_deg,
      latestWaypoint.illumination_fraction,
      latestWaypoint.battery_wh,
      prevMet,
    )
    const sunAfter = advanceSolarGeometry(landingSunAz, landingSunEl, kin.arrivalMetHours, samples)
    setTraverseWaypoints(prev => [
      ...prev,
      {
        waypoint_index: prev.length,
        coordinates: {
          latitude_deg: Number(traverseTarget.latitude_deg.toFixed(6)),
          longitude_deg: Number(traverseTarget.longitude_deg.toFixed(6)),
          elevation_m: Number(traverseTarget.elevation_m.toFixed(1)),
        },
        distance_from_start_m: Number((latestWaypoint.distance_from_start_m + remDist).toFixed(1)),
        distance_to_target_m: 0,
        slope_deg: latestWaypoint.slope_deg,
        illumination_fraction: latestWaypoint.illumination_fraction,
        battery_wh: kin.newBatteryWh,
        battery_before_regen_wh: kin.batteryBeforeRegenWh,
        battery_reserve_pct: kin.reservePct,
        effective_speed_mps: kin.effectiveSpeedMps,
        drive_duration_hours: kin.driveDurationHours,
        regen_dwell_hours: kin.regenDwellHours,
        regen_energy_wh: kin.regenEnergyWh,
        arrival_met_hours: kin.arrivalMetHours,
        met_hours: kin.departureMetHours,
        sun_azimuth_deg: Number(sunAfter.sunAz.toFixed(1)),
        sun_elevation_deg: Number(sunAfter.sunEl.toFixed(2)),
        los_to_base: latestWaypoint.los_to_base,
        action: 'ARRIVE_RESEARCH_TARGET',
      },
    ])
    setPlaying(false)
    setRoverSimHours(prevMet)
    setIsRoverPlaying(true)
    if (samples.length > 0) {
      setSampleIndex(Math.min(lastSampleIdx, Math.max(0, Math.round(prevMet * 2))))
    }
  }, [workspace, traverseTarget, latestWaypoint, landingSunAz, landingSunEl, samples.length, lastSampleIdx])

  const handleUndoTraverseStep = useCallback(() => {
    setIsRoverPlaying(false)
    setTraverseWaypoints(prev => {
      const next = prev.length > 1 ? prev.slice(0, -1) : prev
      const met = next[next.length - 1]?.met_hours ?? 0
      setRoverSimHours(met)
      if (samples.length > 0) {
        setSampleIndex(Math.min(lastSampleIdx, Math.max(0, Math.round(met * 2))))
      }
      return next
    })
  }, [samples.length, lastSampleIdx])

  const handleResetTraverse = useCallback(() => {
    if (!workspace) return
    const illum = workspace.analysis.samples[0]?.sun.illumination_fraction ?? 1.0
    setIsRoverPlaying(false)
    setPlaying(false)
    setRoverSimHours(0)
    setSampleIndex(0)
    setTraverseAutoResult(null)
    setTraverseManualPos(null)
    setTraverseWaypoints([makeBasePodWaypoint(workspace, traverseTarget, illum)])
    if (traverseMode === 'automatic') {
      runAutomaticTraversePlan()
    }
  }, [workspace, makeBasePodWaypoint, traverseTarget, traverseMode, runAutomaticTraversePlan])

  const handleSelectTraverseTarget = useCallback(
    (nextTarget: TraverseResearchTargetOption | null) => {
      setTraverseTarget(nextTarget)
      setPickingTraverseTarget(false)
      setTraverseAutoResult(null)
      setTraverseCandidates([])
      setTraverseManualPos(null)
      setIsRoverPlaying(false)
      setRoverSimHours(0)
      if (workspace) {
        if (nextTarget) {
          const { distanceM } = sphericalDistanceAndBearing(
            workspace.target.latitude_deg,
            workspace.target.longitude_deg,
            nextTarget.latitude_deg,
            nextTarget.longitude_deg,
          )
          setTraverseStepDistanceM(distanceM <= 2500 ? 250 : distanceM <= 30000 ? 1500 : 5000)
          if (distanceM > 1800 && desiredCameraMode === 'SURFACE') {
            setDesiredCameraMode('ORBITAL')
            setCameraPresetNonce(n => n + 1)
          }
        } else {
          setTraverseStepDistanceM(250)
        }
        const illum = workspace.analysis.samples[0]?.sun.illumination_fraction ?? 1.0
        setSampleIndex(0)
        setTraverseWaypoints([makeBasePodWaypoint(workspace, nextTarget, illum)])
      }
    },
    [workspace, makeBasePodWaypoint, desiredCameraMode],
  )

  const handlePickTraverseTargetFromMap = useCallback(
    (coords: {
      latitude_deg: number
      longitude_deg: number
      elevation_m: number
      id?: string
      label?: string
      scienceTag?: string
      category?: TraverseResearchTargetOption['category']
    }) => {
      if (coords.id) {
        const existing = traverseResearchTargets.find(t => t.id === coords.id)
        if (existing) {
          handleSelectTraverseTarget(existing)
          return
        }
      }
      const distM = workspace
        ? sphericalDistanceAndBearing(
            workspace.target.latitude_deg,
            workspace.target.longitude_deg,
            coords.latitude_deg,
            coords.longitude_deg,
          ).distanceM
        : 0
      const compactLabel = formatLatLonCompact(coords.latitude_deg, coords.longitude_deg)
      handleSelectTraverseTarget({
        id: coords.id ?? `custom:${coords.latitude_deg.toFixed(4)},${coords.longitude_deg.toFixed(4)}`,
        shortLabel: coords.label ?? `Custom Target (${compactLabel})`,
        label: coords.label ?? `Custom Target (${compactLabel})`,
        category: coords.category ?? 'custom',
        scienceTag: coords.scienceTag ?? 'Custom 3D Surface Research Point',
        latitude_deg: coords.latitude_deg,
        longitude_deg: coords.longitude_deg,
        elevation_m: coords.elevation_m,
        distance_from_base_m: Math.round(distM),
      })
    },
    [handleSelectTraverseTarget, traverseResearchTargets, workspace],
  )

  const handleSwitchTraverseMode = useCallback(
    (nextMode: 'manual' | 'automatic') => {
      if (nextMode === traverseMode) return
      setTraverseMode(nextMode)
      setIsRoverPlaying(false)
      setPlaying(false)
      setRoverSimHours(0)
      setSampleIndex(0)
      if (nextMode === 'manual' && workspace) {
        setTraverseAutoResult(null)
        const illum = workspace.analysis.samples[0]?.sun.illumination_fraction ?? 1.0
        setTraverseWaypoints([makeBasePodWaypoint(workspace, traverseTarget, illum)])
      }
    },
    [traverseMode, workspace, makeBasePodWaypoint, traverseTarget],
  )

  const handleLaunchRoverPlanner = useCallback(() => {
    setDetailsVisible(true)
    setLeftSidebarOpen(true)
    setTraverseOpen(true)
    if (!workspace) {
      void selectCatalogSite(CATALOG_SITES[0], true)
      return
    }
    window.setTimeout(() => {
      traverseSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }, 60)
  }, [workspace, selectCatalogSite])

  return (
    <div className="relative w-full h-full overflow-hidden bg-[#050507] text-slate-100 select-none">
      {/* Cesium lunar sphere with streamed LROC imagery and verified local LOLA grids */}
      <CesiumLunarStage
        catalogSites={CATALOG_SITES}
        selectedSiteId={workspace?.target.catalogEntry?.id ?? null}
        focusCoordinates={focusCoords}
        hasSelection={Boolean(workspace)}
        desiredCameraMode={desiredCameraMode}
        surfacePreset={surfacePreset}
        useNasaTrekImagery={useNasaTrekImagery}
        cameraPresetNonce={cameraPresetNonce}
        demTerrain={workspace?.demTerrain ?? null}
        currentSample={currentSample}
        analysisCoordinates={workspace?.analysis.coordinates ?? null}
        analysisObserverHeightM={workspace?.analysis.observer_height_m ?? null}
        analysisDataKind={workspace?.analysis.provenance.data_kind ?? null}
        recommendations={workspace?.recommendations ?? null}
        highlightedCandidateId={highlightedCandidateId}
        overlayMode={overlayMode}
        showWireframe={showWireframe}
        verticalScale={verticalScale}
        observerHeightM={observerHeightM}
        traverseWaypoints={traverseOpen ? traverseWaypoints : []}
        traverseCandidates={traverseOpen && traverseMode === 'manual' ? traverseCandidates : []}
        traverseTarget={traverseOpen ? traverseTarget : null}
        researchTargets={workspace && traverseOpen ? traverseResearchTargets : []}
        pickingTraverseTarget={pickingTraverseTarget}
        activeRoverState={activeRoverState}
        onSelectTraverseCandidate={handleSelectManualCandidate}
        onPickTraverseTarget={handlePickTraverseTargetFromMap}
        onCameraModeChange={setCameraMode}
        onPickPoint={handlePickPoint}
        onSelectCatalogSite={site => void selectCatalogSite(site, true)}
        onNasaImageryStatusChange={setNasaImageryStatus}
      />

      {loadError && <div role="alert" className="fixed top-20 left-1/2 -translate-x-1/2 z-40 glass-hud rounded-xl p-3 text-xs text-rose-200">{loadError}</div>}
      {/* Top Floating Search & Camera Control Pill */}
      <div
        ref={searchWrapperRef}
        className="fixed top-4 left-1/2 -translate-x-1/2 z-30 w-[95vw] max-w-[820px]"
      >
        <div className="glass-hud rounded-full px-3 sm:px-4 py-1.5 sm:py-2 flex items-center gap-1.5 sm:gap-2 shadow-[0_12px_40px_rgba(0,0,0,0.68)] transition-colors focus-within:border-white/25">
          <Search className="w-3.5 h-3.5 text-slate-400 shrink-0" />

          <input
            ref={searchInputRef}
            type="text"
            value={searchQuery}
            onFocus={() => setDropdownOpen(true)}
            onChange={e => {
              setSearchQuery(e.target.value)
              setDropdownOpen(true)
            }}
            onKeyDown={e => {
              if (e.key === 'Enter') {
                e.preventDefault()
                const parsed = parseCoordinateQuery(searchQuery)
                if (parsed) {
                  selectCustomCoordinate(parsed.lat, parsed.lon, 'Coordinate Target')
                  return
                }
                if (filteredCatalog[0]) {
                  void selectCatalogSite(filteredCatalog[0], true)
                  return
                }
                if (filteredLandmarks[0]) {
                  selectCustomCoordinate(
                    filteredLandmarks[0].lat,
                    filteredLandmarks[0].lon,
                    filteredLandmarks[0].name,
                  )
                }
              }
            }}
            autoComplete="off"
            spellCheck={false}
            placeholder="Search site or coords (e.g. Connecting Ridge, 89.46°S 137.5°W)"
            className="w-full min-w-0 bg-transparent text-xs font-mono-tech text-slate-100 placeholder-slate-500 focus:outline-none tracking-wide"
            aria-label="Search lunar site or coordinates"
          />

          {(searchQuery || workspace) && (
            <button
              type="button"
              onClick={clearSelection}
              className="text-slate-400 hover:text-white transition p-1 rounded-full hover:bg-white/10 shrink-0"
              aria-label="Clear target selection"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}

          {/* View Mode & Surface Angle Selector */}
          <div className="hidden sm:flex items-center rounded-full border border-white/10 bg-white/[0.03] p-0.5 shrink-0">
            <button
              type="button"
              onClick={() => applyCameraPreset('ORBITAL')}
              className={`px-2 py-0.5 rounded-full text-[9px] font-mono-tech tracking-[0.13em] uppercase transition ${
                cameraMode === 'ORBITAL'
                  ? 'bg-white/15 text-white'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
              title="Orbital Global Moon View"
            >
              ORBITAL
            </button>
            <button
              type="button"
              onClick={() => applyCameraPreset('SURFACE', 'OBLIQUE')}
              className={`px-2 py-0.5 rounded-full text-[9px] font-mono-tech tracking-[0.13em] uppercase transition ${
                cameraMode === 'SURFACE' && surfacePreset === 'OBLIQUE'
                  ? 'bg-emerald-400/20 text-emerald-300 border border-emerald-400/35'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
              title="Oblique verified Site01 terrain view"
            >
              OBLIQUE 3D
            </button>
            <button
              type="button"
              onClick={() => applyCameraPreset('SURFACE', 'HORIZON')}
              className={`px-2 py-0.5 rounded-full text-[9px] font-mono-tech tracking-[0.13em] uppercase transition ${
                cameraMode === 'SURFACE' && surfacePreset === 'HORIZON'
                  ? 'bg-cyan-400/20 text-cyan-200 border border-cyan-400/35'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
              title="Near-horizontal verified Site01 terrain view"
            >
              HORIZON CAM
            </button>
          </div>

          {/* Mobile compact Surface toggle */}
          <button
            type="button"
            onClick={() =>
              cameraMode === 'ORBITAL'
                ? applyCameraPreset('SURFACE', surfacePreset)
                : applyCameraPreset('ORBITAL')
            }
            className={`sm:hidden shrink-0 px-2 py-1 rounded-full text-[9px] font-mono-tech tracking-[0.12em] uppercase border transition ${
              cameraMode === 'SURFACE'
                ? 'border-emerald-400/45 bg-emerald-400/15 text-emerald-300'
                : 'border-white/10 bg-white/[0.04] text-slate-300'
            }`}
          >
            {cameraMode === 'SURFACE' ? surfacePreset : 'ORBITAL'}
          </button>

          {/* LROC WAC imagery toggle */}
          <button
            type="button"
            onClick={() => setUseNasaTrekImagery(v => !v)}
            title={`Toggle LROC WAC imagery (${nasaImageryStatus})`}
            className={`shrink-0 px-2 py-1 rounded-full text-[9px] font-mono-tech tracking-[0.12em] uppercase border transition flex items-center gap-1.5 ${
              useNasaTrekImagery
                ? 'border-emerald-400/35 bg-emerald-400/10 text-emerald-200'
                : 'border-white/10 bg-white/[0.04] text-slate-400 hover:text-white'
            }`}
          >
            <Globe className="w-3 h-3 shrink-0" />
            <span className="hidden md:inline">LRO WAC</span>
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                !useNasaTrekImagery
                  ? 'bg-slate-600'
                  : nasaImageryStatus === 'loaded'
                    ? 'bg-emerald-400'
                    : nasaImageryStatus === 'loading'
                      ? 'bg-amber-400 animate-pulse'
                      : 'bg-slate-500'
              }`}
            />
          </button>

          {/* 2D Polar Map Toggle */}
          <button
            type="button"
            title="Toggle 2D South Pole Stereographic Map"
            onClick={() => {
              const next = !polarOpen
              setPolarOpen(next)
              if (next && workspace) {
                setDetailsVisible(true)
                setLeftSidebarOpen(true)
              }
            }}
            aria-pressed={polarOpen}
            className={`shrink-0 px-2 py-1 rounded-full text-[9px] font-mono-tech tracking-[0.12em] uppercase border transition flex items-center gap-1 ${
              polarOpen
                ? 'border-cyan-400/45 bg-cyan-400/15 text-cyan-200'
                : 'border-white/10 bg-white/[0.04] text-slate-300 hover:text-white hover:border-white/25'
            }`}
          >
            <Compass className="w-3 h-3" />
            <span className="hidden sm:inline">2D</span>
          </button>

          {/* Rover Traverse Planner Launch / Focus Button */}
          <button
            type="button"
            title="Open Lunar Rover Traverse Planner (Manual & Automatic Modes)"
            onClick={handleLaunchRoverPlanner}
            aria-pressed={Boolean(workspace && traverseOpen)}
            className={`shrink-0 px-2.5 py-1 rounded-full text-[9px] font-mono-tech tracking-[0.12em] uppercase border transition flex items-center gap-1 ${
              workspace && traverseOpen
                ? 'border-emerald-400/45 bg-emerald-400/15 text-emerald-200'
                : 'border-white/10 bg-white/[0.04] text-slate-300 hover:text-white hover:border-white/25'
            }`}
          >
            <Navigation className="w-3 h-3 text-emerald-400" />
            <span className="hidden sm:inline">ROVER</span>
          </button>

          {/* Master Hide / Show HUD Pill */}
          {workspace && (
            <button
              type="button"
              onClick={() => setDetailsVisible(v => !v)}
              title={detailsVisible ? 'Hide Floating HUD Sidebars (H)' : 'Show Floating HUD Sidebars (H)'}
              aria-pressed={detailsVisible}
              className={`shrink-0 px-2 py-1 rounded-full text-[9px] font-mono-tech tracking-[0.12em] uppercase border transition flex items-center gap-1 ${
                detailsVisible
                  ? 'border-white/20 bg-white/[0.08] text-slate-100 hover:border-white/35'
                  : 'border-emerald-400/45 bg-emerald-400/15 text-emerald-300'
              }`}
            >
              {detailsVisible ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
              <span className="hidden lg:inline">{detailsVisible ? 'HIDE HUD' : 'SHOW HUD'}</span>
            </button>
          )}
        </div>

        {/* Search Autocomplete Dropdown */}
        {dropdownOpen && (
          <div className="mt-2 glass-hud rounded-2xl overflow-hidden shadow-[0_18px_48px_rgba(0,0,0,0.85)] divide-y divide-white/[0.06] max-h-[60vh] overflow-y-auto hud-scroll">
            {parsedCoords && (
              <button
                type="button"
                onClick={() => selectCustomCoordinate(parsedCoords.lat, parsedCoords.lon, 'Coordinate Target')}
                className="w-full px-4 py-2.5 flex items-center justify-between text-left hover:bg-white/[0.07] transition"
              >
                <div>
                  <div className="text-[11px] font-mono-tech text-emerald-300 tracking-wide">
                    GO TO {formatLatLonCompact(parsedCoords.lat, parsedCoords.lon)}
                  </div>
                  <div className="text-[9px] font-mono-tech text-slate-500 uppercase tracking-wider mt-0.5">
                    Exploratory Coordinate Target
                  </div>
                </div>
                <span className="text-[9px] font-mono-tech text-slate-400 uppercase">Enter ↵</span>
              </button>
            )}

            {filteredCatalog.map(site => (
              <button
                key={site.id}
                type="button"
                onClick={() => void selectCatalogSite(site, true)}
                className="w-full px-4 py-2.5 flex items-center justify-between text-left hover:bg-white/[0.07] transition"
              >
                <div className="min-w-0 pr-3">
                  <div className="flex items-center gap-2">
                    <span
                      className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                        site.hasVerifiedAnalysis ? 'bg-emerald-400' : 'bg-cyan-300'
                      }`}
                    />
                    <span className="text-[11px] font-mono-tech text-slate-100 tracking-wide truncate">
                      {site.name}
                    </span>
                  </div>
                  <div className="text-[9px] font-mono-tech text-slate-400 uppercase tracking-wider mt-0.5 pl-3.5">
                    {site.tag}
                  </div>
                </div>
                <span className="text-[10px] font-mono-tech text-slate-400 tabular-nums shrink-0">
                  {formatLatLonCompact(site.latitude_deg, site.longitude_deg)}
                </span>
              </button>
            ))}

            {filteredLandmarks.map(lm => (
              <button
                key={lm.name}
                type="button"
                onClick={() => selectCustomCoordinate(lm.lat, lm.lon, lm.name)}
                className="w-full px-4 py-2 flex items-center justify-between text-left hover:bg-white/[0.07] transition"
              >
                <div>
                  <div className="text-[11px] font-mono-tech text-slate-300 tracking-wide">{lm.name}</div>
                  <div className="text-[9px] font-mono-tech text-slate-500 uppercase tracking-wider mt-0.5">
                    {lm.tag} · Spherical Explorer
                  </div>
                </div>
                <span className="text-[10px] font-mono-tech text-slate-500 tabular-nums">
                  {formatLatLonCompact(lm.lat, lm.lon)}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Whisper Hint on Initial Global Moon View Before Site Selection */}
      {!workspace && !polarOpen && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-10 pointer-events-none text-center px-4">
          <div className="glass-hud rounded-full px-4 py-1.5 text-[10px] font-mono-tech tracking-[0.16em] uppercase text-slate-300">
            Click a glowing South Pole beacon or search Connecting Ridge · Drag to orbit, scroll to inspect 129×129 DEM
          </div>
        </div>
      )}

      {/* Standalone 2D Polar Stereographic Map Overlay when No Site is Selected */}
      {!workspace && polarOpen && (
        <div className="fixed top-20 right-4 sm:right-6 z-25 w-[92vw] sm:w-[370px] max-h-[75vh] overflow-y-auto hud-scroll glass-hud rounded-2xl p-4 shadow-[0_20px_60px_rgba(0,0,0,0.82)]">
          <div className="flex items-center justify-between pb-2.5 mb-2.5 border-b border-white/[0.08]">
            <span className="text-[10px] font-mono-tech tracking-[0.16em] uppercase text-slate-300">
              85°S – 90°S Polar Stereographic
            </span>
            <button
              type="button"
              onClick={() => setPolarOpen(false)}
              className="p-1 rounded-full text-slate-400 hover:text-white hover:bg-white/10 transition"
              aria-label="Close 2D Polar Map"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
          <PolarMap
            siteId="connecting-ridge"
            onSiteChange={polarId => {
              const matched = CATALOG_SITES.find(s => s.polarId === polarId)
              if (matched) void selectCatalogSite(matched, true)
            }}
          />
        </div>
      )}

      {/* Floating Edge Pill to Restore Collapsed Left Sidebar */}
      {workspace && detailsVisible && !leftSidebarOpen && (
        <button
          type="button"
          onClick={() => setLeftSidebarOpen(true)}
          className="fixed top-20 left-4 z-20 glass-hud rounded-full px-3.5 py-2 text-[10px] font-mono-tech tracking-[0.15em] uppercase text-slate-100 hover:border-emerald-400/45 hover:text-emerald-300 transition shadow-[0_12px_36px_rgba(0,0,0,0.75)] inline-flex items-center gap-1.5"
        >
          <span>MISSION &amp; HAVENS</span>
          <ChevronRight className="w-3.5 h-3.5 text-emerald-400" />
        </button>
      )}

      {/* Floating Edge Pill to Restore Collapsed Right Sidebar */}
      {workspace && detailsVisible && !rightSidebarOpen && (
        <button
          type="button"
          onClick={() => setRightSidebarOpen(true)}
          className="fixed top-20 right-4 z-20 glass-hud rounded-full px-3.5 py-2 text-[10px] font-mono-tech tracking-[0.15em] uppercase text-slate-100 hover:border-cyan-400/45 hover:text-cyan-300 transition shadow-[0_12px_36px_rgba(0,0,0,0.75)] inline-flex items-center gap-1.5"
        >
          <ChevronLeft className="w-3.5 h-3.5 text-cyan-300" />
          <span>TELEMETRY &amp; HORIZON</span>
        </button>
      )}

      {/* LEFT FLOATING HIDEABLE SIDEBAR: Site, Camera Controls, Safe Havens, External Lunar APIs & 2D Polar */}
      {workspace && (
        <aside
          aria-label="Mission configuration and safe haven navigation"
          aria-hidden={!detailsVisible || !leftSidebarOpen}
          className={`fixed top-20 left-4 bottom-20 z-20 w-[calc(100vw-2rem)] sm:w-[318px] lg:w-[350px] glass-hud rounded-2xl flex flex-col shadow-[0_24px_64px_rgba(0,0,0,0.82)] transition-all duration-300 ease-out ${
            detailsVisible && leftSidebarOpen
              ? 'opacity-100 translate-x-0 pointer-events-auto'
              : 'opacity-0 -translate-x-8 pointer-events-none'
          }`}
        >
          {/* Sticky Header */}
          <div className="px-4 pt-3.5 pb-2.5 border-b border-white/[0.08] shrink-0">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <span
                  className={`w-2 h-2 rounded-full shrink-0 ${
                    earthIn
                      ? 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)]'
                      : 'bg-rose-400 shadow-[0_0_8px_rgba(251,113,133,0.8)]'
                  }`}
                />
                <h1 className="text-[11px] font-mono-tech font-medium tracking-[0.14em] text-slate-100 uppercase truncate">
                  {workspace.target.name}
                </h1>
              </div>

              <div className="flex items-center gap-1 shrink-0">
                <button
                  type="button"
                  onClick={() => setLeftSidebarOpen(false)}
                  title="Collapse Mission Sidebar"
                  className="px-2 py-0.5 rounded-full text-[9px] font-mono-tech tracking-wider uppercase border border-white/10 bg-white/[0.04] text-slate-300 hover:text-white hover:border-white/25 transition inline-flex items-center gap-0.5"
                >
                  <ChevronLeft className="w-3 h-3" />
                  HIDE
                </button>
                <button
                  type="button"
                  onClick={clearSelection}
                  title="Clear Target Selection"
                  className="p-1 rounded-full text-slate-400 hover:text-white hover:bg-white/10 transition"
                  aria-label="Clear selected site"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 mt-2">
              <span className="text-[10px] font-mono-tech text-slate-400 tabular-nums">
                {formatLatLonCompact(workspace.target.latitude_deg, workspace.target.longitude_deg)}
              </span>
              <button
                type="button"
                onClick={() => setShowProvenanceInfo(p => !p)}
                title="Inspect backend / data provenance & SHA-256 verification"
                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-mono-tech tracking-wider uppercase border transition ${badgeStyle.cls}`}
              >
                <Info className="w-2.5 h-2.5" />
                {badgeStyle.label}
              </button>
            </div>

            {showProvenanceInfo && (
              <div className="mt-2.5 rounded-xl border border-white/[0.08] bg-black/45 px-2.5 py-2 text-[9px] font-mono-tech text-slate-300 space-y-1">
                <div className="text-slate-200 leading-relaxed">{workspace.sourceNote}</div>
                <div className="text-slate-400">
                  FRAME: {workspace.analysis.coordinates.frame} · {workspace.analysis.analysis_id}
                </div>
                {workspace.demTerrain && (
                  <div className="text-emerald-300/90">
                    DEM 129×129 @ {workspace.demTerrain.metadata.spacing_m}m · SHA256{' '}
                    {workspace.demTerrain.metadata.sha256.slice(0, 12)}… · NoData preserved:{' '}
                    {workspace.demTerrain.missingVertices}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Scrollable Body */}
          <div className="flex-1 overflow-y-auto hud-scroll px-4 py-3 space-y-4">
            {/* Section 1: 3D Surface & Camera Controls */}
            <section className="space-y-2.5">
              <div className="text-[9px] font-mono-tech tracking-[0.16em] text-slate-500 uppercase">
                Camera &amp; Terrain Controls
              </div>

              {/* Camera Angle Row */}
              <div className="grid grid-cols-3 gap-1.5">
                <button
                  type="button"
                  onClick={() => applyCameraPreset('SURFACE', 'OBLIQUE')}
                  className={`px-2 py-1.5 rounded-xl text-[9px] font-mono-tech uppercase tracking-wider border transition ${
                    cameraMode === 'SURFACE' && surfacePreset === 'OBLIQUE'
                      ? 'border-emerald-400/45 bg-emerald-400/15 text-emerald-300'
                      : 'border-white/10 bg-white/[0.03] text-slate-300 hover:bg-white/[0.07]'
                  }`}
                >
                  OBLIQUE
                </button>
                <button
                  type="button"
                  onClick={() => applyCameraPreset('SURFACE', 'HORIZON')}
                  className={`px-2 py-1.5 rounded-xl text-[9px] font-mono-tech uppercase tracking-wider border transition ${
                    cameraMode === 'SURFACE' && surfacePreset === 'HORIZON'
                      ? 'border-cyan-400/45 bg-cyan-400/15 text-cyan-200'
                      : 'border-white/10 bg-white/[0.03] text-slate-300 hover:bg-white/[0.07]'
                  }`}
                >
                  HORIZON
                </button>
                <button
                  type="button"
                  onClick={() => applyCameraPreset('ORBITAL')}
                  className={`px-2 py-1.5 rounded-xl text-[9px] font-mono-tech uppercase tracking-wider border transition ${
                    cameraMode === 'ORBITAL'
                      ? 'border-white/30 bg-white/15 text-white'
                      : 'border-white/10 bg-white/[0.03] text-slate-300 hover:bg-white/[0.07]'
                  }`}
                >
                  ORBITAL
                </button>
              </div>

              {/* Observer Mast Row */}
              <div className="flex items-center justify-between gap-2 bg-white/[0.03] rounded-xl px-2.5 py-1.5 border border-white/[0.06]">
                <span className="text-[9px] font-mono-tech tracking-[0.14em] text-slate-400 uppercase">
                  Observer Mast
                </span>
                <div className="flex items-center gap-1">
                  {([2, 5] as const).map(h => (
                    <button
                      key={h}
                      type="button"
                      onClick={() => void handleMastToggle(h)}
                      disabled={loadingTarget || (h === 5 && workspace?.target.catalogEntry?.hasVerifiedAnalysis === true)}
                      title={h === 5 && workspace?.target.catalogEntry?.hasVerifiedAnalysis ? "Only the 2 m observer has verified recorded analysis" : undefined}
                      className={`px-2 py-0.5 rounded-lg text-[9px] font-mono-tech uppercase border transition ${
                        observerHeightM === h
                          ? 'border-emerald-400/45 bg-emerald-400/15 text-emerald-300'
                          : 'border-white/10 text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      {h}m {h === 2 ? 'LANDER' : 'MAST'}
                    </button>
                  ))}
                </div>
              </div>

              {/* Terrain layer and LROC WAC imagery controls */}
              {workspace.demTerrain && (
                <div className="grid grid-cols-3 gap-1.5">
                  <button
                    type="button"
                    onClick={() => setOverlayMode(m => (m === 'albedo' ? 'slope' : 'albedo'))}
                    title="Toggle Slope Safety Heatmap (<8° Safe / 8–15° Caution / >15° Hazard)"
                    className={`px-2 py-1.5 rounded-xl text-[9px] font-mono-tech uppercase border transition inline-flex items-center justify-center gap-1 ${
                      overlayMode === 'slope'
                        ? 'border-emerald-400/45 bg-emerald-400/15 text-emerald-300'
                        : 'border-white/10 bg-white/[0.03] text-slate-300 hover:text-white'
                    }`}
                  >
                    <Layers className="w-2.5 h-2.5" />
                    {overlayMode === 'slope' ? 'SLOPE' : 'RELIEF'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowWireframe(w => !w)}
                    className={`px-2 py-1.5 rounded-xl text-[9px] font-mono-tech uppercase border transition ${
                      showWireframe
                        ? 'border-cyan-400/45 bg-cyan-400/15 text-cyan-200'
                        : 'border-white/10 bg-white/[0.03] text-slate-300 hover:text-white'
                    }`}
                  >
                    {showWireframe ? 'WIRE ON' : 'WIRE'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setVerticalScale(v => (v === 1 ? 2 : v === 2 ? 4 : 1))}
                    title="Cycle DEM Vertical Exaggeration (1× True Scale / 2× / 4×)"
                    className="px-2 py-1.5 rounded-xl text-[9px] font-mono-tech uppercase border border-white/10 bg-white/[0.03] text-slate-300 hover:text-white transition"
                  >
                    {verticalScale}× VERT
                  </button>
                </div>
              )}

              <button
                type="button"
                onClick={() => setUseNasaTrekImagery(v => !v)}
                className="w-full flex items-center justify-between bg-white/[0.03] hover:bg-white/[0.06] rounded-xl px-2.5 py-1.5 border border-white/[0.06] transition"
              >
                <span className="text-[9px] font-mono-tech tracking-[0.12em] text-slate-300 uppercase inline-flex items-center gap-1.5">
                  <Globe className="w-3 h-3 text-cyan-300" />
                  LROC WAC · Lunaserv
                </span>
                <span
                  className={`text-[9px] font-mono-tech uppercase ${
                    !useNasaTrekImagery
                      ? 'text-slate-500'
                      : nasaImageryStatus === 'loaded'
                        ? 'text-emerald-400'
                        : nasaImageryStatus === 'loading'
                          ? 'text-amber-300'
                          : 'text-slate-400'
                  }`}
                >
                  {!useNasaTrekImagery
                    ? 'OFF (SHADED)'
                    : nasaImageryStatus === 'loaded'
                      ? 'ACTIVE'
                      : nasaImageryStatus === 'loading'
                        ? 'LOADING…'
                        : 'FALLBACK'}
                </span>
              </button>
            </section>

            {/* Section 2: Lunar Rover Traverse Planner (Manual & Automatic Modes) */}
            <section ref={traverseSectionRef} className="space-y-2.5 pt-2 border-t border-white/[0.07]">
              <button
                type="button"
                onClick={() => setTraverseOpen(o => !o)}
                className="w-full flex items-center justify-between text-[9px] font-mono-tech tracking-[0.16em] text-slate-300 hover:text-white uppercase transition"
              >
                <span className="inline-flex items-center gap-1.5">
                  <Navigation className="w-3 h-3 text-emerald-400" />
                  Rover Traverse Planner
                </span>
                <span className="inline-flex items-center gap-1.5 text-slate-400">
                  <span className="px-1.5 py-0.5 rounded bg-emerald-400/10 border border-emerald-400/30 text-[8px] text-emerald-300">
                    {traverseMode === 'manual' ? 'MANUAL' : 'AUTO'}
                  </span>
                  {traverseOpen ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                </span>
              </button>

              {traverseOpen && (
                <div className="space-y-2.5 rounded-xl border border-white/[0.08] bg-black/35 p-2.5">
                  {/* Mode Switcher */}
                  <div className="grid grid-cols-2 gap-1 rounded-lg bg-white/[0.03] p-0.5 border border-white/[0.06]">
                    <button
                      type="button"
                      onClick={() => handleSwitchTraverseMode('manual')}
                      className={`px-2 py-1 rounded-md text-[9px] font-mono-tech uppercase tracking-wider transition ${
                        traverseMode === 'manual'
                          ? 'bg-emerald-400/20 text-emerald-200 border border-emerald-400/40'
                          : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      Manual Mode
                    </button>
                    <button
                      type="button"
                      onClick={() => handleSwitchTraverseMode('automatic')}
                      className={`px-2 py-1 rounded-md text-[9px] font-mono-tech uppercase tracking-wider transition ${
                        traverseMode === 'automatic'
                          ? 'bg-cyan-400/20 text-cyan-200 border border-cyan-400/40'
                          : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      Auto Mode
                    </button>
                  </div>

                  {/* Research Target Area Selector */}
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between text-[8px] font-mono-tech uppercase tracking-[0.14em] text-slate-400">
                      <span>Research Target Destination</span>
                      {traverseTarget && latestWaypoint ? (
                        <span className="text-pink-300 tabular-nums">
                          {latestWaypoint.distance_to_target_m >= 1000
                            ? `${(latestWaypoint.distance_to_target_m / 1000).toFixed(2)} km away`
                            : `${Math.round(latestWaypoint.distance_to_target_m).toLocaleString()}m away`}
                        </span>
                      ) : (
                        <span className="text-cyan-300">Select Crater / Rim</span>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5">
                      <select
                        aria-label="Research Target Destination"
                        value={
                          traverseTarget === null
                            ? ''
                            : traverseResearchTargets.some(p => p.id === traverseTarget.id)
                              ? traverseTarget.id
                              : 'custom'
                        }
                        onChange={e => {
                          if (!e.target.value) {
                            handleSelectTraverseTarget(null)
                            return
                          }
                          const found = traverseResearchTargets.find(p => p.id === e.target.value)
                          if (found) handleSelectTraverseTarget(found)
                        }}
                        className="flex-1 min-w-0 bg-[#0b0e14] border border-white/10 rounded-lg px-2 py-1 text-[9px] font-mono-tech text-slate-200 focus:outline-none focus:border-cyan-400/50"
                      >
                        <option value="">-- Select Research Target (Crater / Rim) --</option>
                        {waterIceTargets.length > 0 && (
                          <optgroup label="Water-Ice Craters &amp; PSR Cold Traps (H₂O)">
                            {waterIceTargets.map(preset => (
                              <option key={preset.id} value={preset.id}>
                                {preset.label}
                              </option>
                            ))}
                          </optgroup>
                        )}
                        {mappedRimTargets.length > 0 && (
                          <optgroup label="Mapped Sites &amp; Crater Rims (Shackleton, Malapert…)">
                            {mappedRimTargets.map(preset => (
                              <option key={preset.id} value={preset.id}>
                                {preset.label}
                              </option>
                            ))}
                          </optgroup>
                        )}
                        {safeHavenTargets.length > 0 && (
                          <optgroup label="Local Safe Haven Stations (&lt;8° Slope)">
                            {safeHavenTargets.map(preset => (
                              <option key={preset.id} value={preset.id}>
                                {preset.label}
                              </option>
                            ))}
                          </optgroup>
                        )}
                        {traverseTarget && !traverseResearchTargets.some(p => p.id === traverseTarget.id) && (
                          <option value="custom">{traverseTarget.label}</option>
                        )}
                      </select>
                      <button
                        type="button"
                        onClick={() => setPickingTraverseTarget(p => !p)}
                        title="Click any crater, mapped site, or point on the 3D Moon to set your Research Destination"
                        className={`shrink-0 px-2 py-1 rounded-lg text-[8px] font-mono-tech uppercase border transition inline-flex items-center gap-1 ${
                          pickingTraverseTarget
                            ? 'border-pink-400 bg-pink-500/20 text-pink-200 animate-pulse'
                            : 'border-white/10 bg-white/[0.04] text-slate-300 hover:border-pink-400/50 hover:text-pink-200'
                        }`}
                      >
                        <Crosshair className="w-2.5 h-2.5" />
                        {pickingTraverseTarget ? 'PICKING…' : 'PICK MAP'}
                      </button>
                    </div>

                    {traverseTarget ? (
                      <div className="rounded-lg border border-pink-400/25 bg-pink-500/[0.05] px-2 py-1.5 space-y-0.5">
                        <div className="flex items-center justify-between gap-1 text-[8px] font-mono-tech">
                          <span className="text-pink-200 truncate">{traverseTarget.scienceTag}</span>
                          <button
                            type="button"
                            onClick={() => handleSelectTraverseTarget(null)}
                            className="shrink-0 text-slate-400 hover:text-white uppercase underline"
                          >
                            Change
                          </button>
                        </div>
                        <div className="text-[8px] font-mono-tech text-slate-400 tabular-nums flex items-center justify-between">
                          <span>{formatLatLonCompact(traverseTarget.latitude_deg, traverseTarget.longitude_deg)}</span>
                          <span>Elev {Math.round(traverseTarget.elevation_m)} m</span>
                        </div>
                      </div>
                    ) : (
                      <div className="rounded-lg border border-cyan-400/20 bg-cyan-500/[0.04] p-2 space-y-1.5">
                        <div className="text-[8px] font-mono-tech uppercase tracking-wider text-cyan-200">
                          Select a Research Target Destination
                        </div>
                        <div className="space-y-1 max-h-[168px] overflow-y-auto hud-scroll pr-0.5">
                          {[...waterIceTargets, ...mappedRimTargets].map(opt => {
                            const isIce = opt.category === 'water_ice_crater'
                            const distText =
                              opt.distance_from_base_m < 1000
                                ? `${opt.distance_from_base_m}m`
                                : `${(opt.distance_from_base_m / 1000).toFixed(1)}km`
                            return (
                              <button
                                key={opt.id}
                                type="button"
                                onClick={() => handleSelectTraverseTarget(opt)}
                                className="w-full text-left rounded-md px-2 py-1.5 border border-white/10 bg-white/[0.03] hover:bg-white/[0.08] hover:border-cyan-400/45 transition"
                              >
                                <div className="flex items-center justify-between gap-1.5 text-[9px] font-mono-tech">
                                  <span className="text-slate-100 truncate">{opt.shortLabel}</span>
                                  <span className="text-cyan-300 tabular-nums shrink-0">{distText}</span>
                                </div>
                                <div className="flex items-center justify-between gap-1 text-[7px] font-mono-tech mt-0.5">
                                  <span className={isIce ? 'text-sky-300' : 'text-amber-300'}>
                                    {isIce ? 'WATER-ICE PSR' : 'MAPPED RIM'}
                                  </span>
                                  <span className="text-slate-400 tabular-nums">
                                    Elev {Math.round(opt.elevation_m)}m
                                  </span>
                                </div>
                              </button>
                            )
                          })}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Base Pod Comms & Solar Power Readiness */}
                  {currentSample && (
                    <div className="grid grid-cols-2 gap-1.5 rounded-lg bg-white/[0.025] border border-white/[0.06] px-2 py-1.5 text-[8px] font-mono-tech">
                      <div>
                        <span className="text-slate-500 uppercase">Base Earth DTE: </span>
                        <span className={earthIn ? 'text-emerald-300' : 'text-rose-400'}>
                          {currentSample.earth.visible === null ? 'UNKNOWN' : earthIn ? 'LINKED' : 'OCCULTED'}
                        </span>
                        {workspace.analysis.metrics.earth_visible_fraction !== null && (
                          <span className="text-slate-400 tabular-nums">
                            {' '}({Math.round(workspace.analysis.metrics.earth_visible_fraction * 100)}% 14d)
                          </span>
                        )}
                      </div>
                      <div className="text-right">
                        <span className="text-slate-500 uppercase">Base Solar: </span>
                        <span className={sunIn ? 'text-amber-300' : 'text-slate-400'}>
                          {currentSample.sun.illumination_fraction !== null
                            ? `${Math.round(currentSample.sun.illumination_fraction * 100)}%`
                            : 'N/A'}
                        </span>
                        {workspace.analysis.metrics.sunlight_fraction !== null && (
                          <span className="text-slate-400 tabular-nums">
                            {' '}({Math.round(workspace.analysis.metrics.sunlight_fraction * 100)}% 14d)
                          </span>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Rover Power, Solar & Base Pod LOS Status Bar */}
                  {latestWaypoint && (() => {
                    const liveBatWh = activeRoverState ? activeRoverState.batteryWh : latestWaypoint.battery_wh
                    const liveBatPct = activeRoverState
                      ? activeRoverState.batteryReservePct
                      : latestWaypoint.battery_reserve_pct
                    const liveIllum = activeRoverState
                      ? activeRoverState.illuminationFraction
                      : latestWaypoint.illumination_fraction
                    const liveLos = activeRoverState ? activeRoverState.losToBase : latestWaypoint.los_to_base
                    const liveMet = activeRoverState
                      ? activeRoverState.metHours
                      : (latestWaypoint.met_hours ?? 0)
                    const budgetSource = (traverseMode === 'manual' ? traverseManualPos : null) ?? latestWaypoint
                    const fallbackBaseDist = workspace
                      ? sphericalDistanceAndBearing(
                          latestWaypoint.coordinates.latitude_deg,
                          latestWaypoint.coordinates.longitude_deg,
                          workspace.target.latitude_deg,
                          workspace.target.longitude_deg,
                        ).distanceM
                      : 0
                    const distToBase = budgetSource.distance_to_base_m ?? fallbackBaseDist
                    const returnBaseWh = budgetSource.return_to_base_wh ?? 0
                    const requiredRetWh = budgetSource.required_return_wh ?? 240
                    const canReturn = budgetSource.can_return_to_base ?? liveBatWh >= requiredRetWh
                    const distSunlit = budgetSource.distance_to_sunlit_m ?? (liveIllum >= 0.15 ? 0 : null)
                    const sunlitPct = budgetSource.nearest_sunlit_illum_pct ?? Math.round(liveIllum * 100)
                    const reachSunWh = budgetSource.reach_sunlit_wh ?? 0
                    const fmtD = (m: number) => (m >= 1000 ? `${(m / 1000).toFixed(1)}km` : `${Math.round(m)}m`)
                    return (
                      <div className="space-y-1.5">
                        <div className="grid grid-cols-3 gap-1.5 rounded-lg bg-white/[0.03] border border-white/[0.06] p-2">
                          <div>
                            <div className="text-[8px] font-mono-tech text-slate-500 uppercase">
                              {activeRoverState?.isRegenerating ? '⚡ Charging' : 'Battery'}
                            </div>
                            <div
                              className={`text-[10px] font-mono-tech tabular-nums mt-0.5 ${
                                liveBatPct >= 50
                                  ? 'text-emerald-300'
                                  : liveBatPct >= 20
                                    ? 'text-amber-300'
                                    : 'text-rose-400'
                              }`}
                            >
                              {Math.round(liveBatWh)} Wh ({Math.round(liveBatPct)}%)
                            </div>
                            <div className="w-full h-1 rounded-full bg-white/10 mt-1 overflow-hidden">
                              <div
                                className={`h-full ${
                                  liveBatPct >= 50
                                    ? 'bg-emerald-400'
                                    : liveBatPct >= 20
                                      ? 'bg-amber-400'
                                      : 'bg-rose-500'
                                }`}
                                style={{ width: `${Math.min(100, Math.max(0, liveBatPct))}%` }}
                              />
                            </div>
                          </div>
                          <div>
                            <div className="text-[8px] font-mono-tech text-slate-500 uppercase">Rover Solar</div>
                            <div className="text-[10px] font-mono-tech text-amber-300 tabular-nums mt-0.5">
                              {Math.round(liveIllum * 100)}% Sun
                            </div>
                            <div className="text-[8px] font-mono-tech text-slate-400 tabular-nums">
                              {activeRoverState?.isRegenerating
                                ? '+Solar Hold'
                                : `+${Math.round(350 * liveIllum * 0.42)}W mov`}
                            </div>
                          </div>
                          <div className="text-right">
                            <div className="text-[8px] font-mono-tech text-slate-500 uppercase">Base Pod LoS</div>
                            <div
                              className={`text-[10px] font-mono-tech uppercase mt-0.5 ${
                                liveLos ? 'text-emerald-400' : 'text-rose-400'
                              }`}
                            >
                              {liveLos ? 'LINK UP' : 'BLOCKED'}
                            </div>
                            <div className="text-[8px] font-mono-tech text-cyan-300 tabular-nums">
                              T+{liveMet.toFixed(2)}h · #{latestWaypoint.waypoint_index}
                            </div>
                          </div>
                        </div>

                        {/* Base Return & Nearest Sunlit Area Strip */}
                        <div className="grid grid-cols-2 gap-1.5 rounded-lg bg-white/[0.02] border border-white/[0.06] px-2 py-1.5 text-[8px] font-mono-tech tabular-nums">
                          <div>
                            <div className="flex items-center justify-between gap-1">
                              <span className="text-slate-500 uppercase">Base Return</span>
                              <span
                                className={`px-1 py-0.2 rounded text-[7px] uppercase ${
                                  canReturn
                                    ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-400/30'
                                    : 'bg-rose-500/15 text-rose-300 border border-rose-400/35'
                                }`}
                              >
                                {canReturn ? 'RETURN SAFE' : 'REGEN NEEDED'}
                              </span>
                            </div>
                            <div className="text-slate-200 mt-0.5">
                              {fmtD(distToBase)} · ~{Math.round(returnBaseWh)}Wh (Req {Math.round(requiredRetWh)}Wh)
                            </div>
                          </div>
                          <div className="text-right">
                            <div className="text-slate-500 uppercase">Nearest Sunlit</div>
                            <div className="text-amber-300 mt-0.5">
                              {distSunlit !== null && distSunlit <= 5
                                ? `SUNLIT HERE (0m · ${Math.round(sunlitPct)}%)`
                                : distSunlit !== null
                                  ? `${fmtD(distSunlit)} · ${Math.round(sunlitPct)}%☀ (${Math.round(reachSunWh)}Wh)`
                                  : 'SCANNING…'}
                            </div>
                          </div>
                        </div>
                      </div>
                    )
                  })()}

                  {/* Step Range & Actions Row */}
                  <div className="flex items-center justify-between gap-1.5">
                    <div className="flex items-center gap-1 flex-wrap">
                      <span className="text-[8px] font-mono-tech text-slate-500 uppercase">Range</span>
                      {(traverseTarget && traverseTarget.distance_from_base_m > 2500
                        ? ([1000, 2500, 5000] as const)
                        : ([150, 250, 400] as const)
                      ).map(sz => (
                        <button
                          key={sz}
                          type="button"
                          onClick={() => setTraverseStepDistanceM(sz)}
                          className={`px-1.5 py-0.5 rounded text-[8px] font-mono-tech border transition ${
                            traverseStepDistanceM === sz
                              ? 'border-cyan-400/50 bg-cyan-400/15 text-cyan-200'
                              : 'border-white/10 text-slate-400 hover:text-white'
                          }`}
                        >
                          ~{sz >= 1000 ? `${sz / 1000}km` : `${sz}m`}
                        </button>
                      ))}
                      <span className="text-[7px] font-mono-tech text-cyan-300/80">(Auto-Varies)</span>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      {traverseMode === 'manual' && traverseWaypoints.length > 1 && (
                        <button
                          type="button"
                          onClick={handleUndoTraverseStep}
                          className="px-1.5 py-0.5 rounded text-[8px] font-mono-tech uppercase border border-white/10 bg-white/[0.04] text-slate-300 hover:text-white inline-flex items-center gap-0.5"
                        >
                          <Undo2 className="w-2.5 h-2.5" />
                          Undo
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={handleResetTraverse}
                        className="px-1.5 py-0.5 rounded text-[8px] font-mono-tech uppercase border border-white/10 bg-white/[0.04] text-slate-300 hover:text-white inline-flex items-center gap-0.5"
                      >
                        <RotateCcw className="w-2.5 h-2.5" />
                        Reset
                      </button>
                    </div>
                  </div>

                  {/* Rover Mission Clock & Synchronized Traverse Playback */}
                  {traverseWaypoints.length > 1 && maxRoverMetHours > 0 && (
                    <div className="rounded-lg border border-cyan-400/20 bg-cyan-500/[0.04] px-2 py-1.5 space-y-1">
                      <div className="flex items-center justify-between gap-1.5 text-[8px] font-mono-tech">
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => {
                              setPlaying(false)
                              if (isRoverPlaying) {
                                setIsRoverPlaying(false)
                                return
                              }
                              if (roverSimHours >= maxRoverMetHours) setRoverSimHours(0)
                              setIsRoverPlaying(true)
                            }}
                            className="px-1.5 py-0.5 rounded border border-cyan-400/40 bg-cyan-400/15 hover:bg-cyan-400/25 text-cyan-200 inline-flex items-center gap-1 uppercase"
                          >
                            {isRoverPlaying ? <Pause className="w-2.5 h-2.5" /> : <Play className="w-2.5 h-2.5" />}
                            {isRoverPlaying ? 'Pause' : 'Play'}
                          </button>
                          <span className="text-slate-200 tabular-nums">
                            MET +{roverSimHours.toFixed(2)}h / +{maxRoverMetHours.toFixed(2)}h
                          </span>
                        </div>
                        <span
                          className={`truncate ${
                            activeRoverState?.isRegenerating ? 'text-amber-300' : 'text-cyan-300'
                          }`}
                        >
                          {activeRoverState?.statusLabel ?? 'READY'}
                        </span>
                      </div>
                      <input
                        type="range"
                        aria-label="Rover traverse mission elapsed time"
                        min={0}
                        max={maxRoverMetHours}
                        step={0.02}
                        value={Math.min(roverSimHours, maxRoverMetHours)}
                        onChange={e => {
                          const h = Number(e.target.value)
                          setPlaying(false)
                          setIsRoverPlaying(false)
                          setRoverSimHours(h)
                          if (samples.length > 0) {
                            setSampleIndex(Math.min(lastSampleIdx, Math.max(0, Math.round(h * 2))))
                          }
                        }}
                        className="hud-range w-full"
                      />
                      {activeRoverState && (
                        <div className="flex items-center justify-between text-[7px] font-mono-tech text-slate-400 tabular-nums">
                          <span>☀ AZ {activeRoverState.sunAzimuthDeg.toFixed(1)}° · EL {activeRoverState.sunElevationDeg.toFixed(2)}°</span>
                          <span>{activeRoverState.isRegenerating ? 'STATIONARY REGEN' : 'LUNAR REGOLITH TRANSIT'}</span>
                        </div>
                      )}
                    </div>
                  )}

                  {/* MANUAL MODE BODY */}
                  {traverseMode === 'manual' && (
                    <div className="space-y-1.5">
                      {!traverseTarget ? (
                        <div className="text-[9px] font-mono-tech text-slate-400 py-1">
                          Choose a Water-Ice Crater, PSR Cold Trap, or Mapped Rim above (or click PICK MAP) to plot candidate steps.
                        </div>
                      ) : latestWaypoint?.action === 'ARRIVE_RESEARCH_TARGET' ? (
                        <div className="rounded-lg border border-emerald-400/40 bg-emerald-400/10 p-2 text-[9px] font-mono-tech text-emerald-200">
                          Arrived at Research Destination (
                          {latestWaypoint.distance_from_start_m >= 1000
                            ? `${(latestWaypoint.distance_from_start_m / 1000).toFixed(2)}km`
                            : `${Math.round(latestWaypoint.distance_from_start_m)}m`}{' '}
                          total traverse · {Math.round(latestWaypoint.battery_wh)} Wh remaining).
                        </div>
                      ) : latestWaypoint && latestWaypoint.distance_to_target_m <= traverseStepDistanceM * 0.75 ? (
                        <button
                          type="button"
                          onClick={handleCompleteManualArrival}
                          className="w-full py-2 px-3 rounded-lg bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-400/50 text-[9px] font-mono-tech uppercase tracking-wider text-emerald-200 transition"
                        >
                          Touchdown at Research Target ({Math.round(latestWaypoint.distance_to_target_m)}m remaining)
                        </button>
                      ) : (
                        <>
                          <div className="flex items-center justify-between text-[8px] font-mono-tech uppercase tracking-wider text-slate-400">
                            <span>Suggested Next Waypoints</span>
                            {traverseLoading && <span className="text-cyan-300">Evaluating…</span>}
                          </div>
                          {traverseCandidates.length > 0 ? (
                            <div className="space-y-1 max-h-[195px] overflow-y-auto hud-scroll pr-0.5">
                              {traverseCandidates.map(cand => {
                                const bandCls = !cand.is_valid
                                  ? 'border-rose-500/35 bg-rose-500/5 text-rose-300 opacity-75'
                                  : cand.is_regen_spot
                                    ? 'border-amber-400/65 bg-amber-400/15 hover:bg-amber-400/25 hover:border-amber-300'
                                    : cand.slope_band === 'SAFE'
                                      ? 'border-emerald-400/25 bg-white/[0.03] hover:bg-emerald-400/10 hover:border-emerald-400/50'
                                      : 'border-amber-400/30 bg-white/[0.03] hover:bg-amber-400/10'
                                const fmtDist = (m: number) => (m >= 1000 ? `${(m / 1000).toFixed(1)}km` : `${Math.round(m)}m`)
                                return (
                                  <button
                                    key={cand.candidate_id}
                                    type="button"
                                    disabled={!cand.is_valid}
                                    onClick={() => handleSelectManualCandidate(cand)}
                                    className={`w-full text-left rounded-lg p-2 border transition ${bandCls}`}
                                  >
                                    {cand.is_regen_spot && (
                                      <div className="flex items-center justify-between text-[8px] font-mono-tech uppercase tracking-wider text-amber-300 font-semibold mb-1">
                                        <span>⚡ SOLAR REGEN SPOT</span>
                                        <span className="text-amber-200">
                                          +{Math.round(cand.regen_energy_wh ?? 0)}Wh Recharge
                                        </span>
                                      </div>
                                    )}
                                    <div className="flex items-center justify-between gap-1 text-[9px] font-mono-tech">
                                      <span className="text-slate-100 tabular-nums">
                                        {cand.is_regen_spot && cand.step_distance_m < 5.0
                                          ? 'HOLD @ CURRENT SUNLIT SPOT'
                                          : `${fmtDist(cand.step_distance_m)} @ ${Math.round(cand.step_bearing_deg)}°`}
                                      </span>
                                      <span className="text-pink-300 tabular-nums">
                                        {cand.distance_to_target_m <= 5.0
                                          ? 'DIRECT TOUCHDOWN'
                                          : `${fmtDist(cand.distance_to_target_m)} to target`}
                                      </span>
                                    </div>
                                    <div className="flex items-center justify-between text-[8px] font-mono-tech mt-1 tabular-nums text-slate-400">
                                      <span
                                        className={
                                          cand.slope_band === 'SAFE'
                                            ? 'text-emerald-400'
                                            : cand.slope_band === 'CAUTION'
                                              ? 'text-amber-300'
                                              : 'text-rose-400'
                                        }
                                      >
                                        {cand.slope_deg.toFixed(1)}° {cand.slope_band}
                                      </span>
                                      <span className="text-amber-300">
                                        {Math.round(cand.illumination_fraction * 100)}% Sun
                                      </span>
                                      <span>
                                        {Math.round(cand.battery_wh)}Wh ({cand.battery_delta_wh >= 0 ? '+' : ''}
                                        {cand.battery_delta_wh.toFixed(0)})
                                      </span>
                                      <span className={cand.los_to_base ? 'text-emerald-400' : 'text-rose-400'}>
                                        {cand.los_to_base ? 'LOS OK' : 'NO LOS'}
                                      </span>
                                    </div>
                                    {cand.distance_to_base_m !== undefined && (
                                      <div className="flex items-center justify-between text-[7px] font-mono-tech mt-0.5 tabular-nums text-slate-400">
                                        <span className={cand.can_return_to_base === false ? 'text-rose-300' : 'text-slate-300'}>
                                          Base: {fmtDist(cand.distance_to_base_m)} (Need {Math.round(cand.required_return_wh ?? 240)}Wh)
                                        </span>
                                        <span className="text-amber-200/90">
                                          Sunlit: {cand.distance_to_sunlit_m !== undefined ? fmtDist(cand.distance_to_sunlit_m) : '0m'}
                                        </span>
                                      </div>
                                    )}
                                    <div className="flex items-center justify-between text-[7px] font-mono-tech mt-0.5 tabular-nums text-slate-400">
                                      <span className="text-cyan-300">
                                        +{(cand.drive_duration_hours ?? 0).toFixed(2)}h drive
                                        {cand.effective_speed_mps ? ` @ ${cand.effective_speed_mps.toFixed(2)}m/s` : ''}
                                      </span>
                                      {(cand.regen_dwell_hours ?? 0) > 0 ? (
                                        <span className="text-amber-300 font-semibold">
                                          ⚡ +{(cand.regen_dwell_hours ?? 0).toFixed(2)}h Regen
                                        </span>
                                      ) : cand.sun_azimuth_deg !== undefined ? (
                                        <span>☀ AZ {Math.round(cand.sun_azimuth_deg)}°</span>
                                      ) : null}
                                    </div>
                                    {!cand.is_valid && cand.rejection_reasons.length > 0 && (
                                      <div className="text-[8px] font-mono-tech text-rose-400 mt-0.5">
                                        {cand.rejection_reasons[0]}
                                      </div>
                                    )}
                                  </button>
                                )
                              })}
                            </div>
                          ) : (
                            <div className="text-[9px] font-mono-tech text-slate-400 py-1">
                              {traverseLoading ? 'Computing candidate steps…' : 'Evaluating next forward waypoints…'}
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  )}

                  {/* AUTOMATIC MODE BODY */}
                  {traverseMode === 'automatic' && (
                    <div className="space-y-2">
                      {!traverseTarget ? (
                        <div className="text-[9px] font-mono-tech text-slate-400 py-1">
                          Select a Water-Ice Crater, PSR Cold Trap, or Mapped Rim above to compute the full optimal path automatically.
                        </div>
                      ) : (
                        <>
                          <button
                            type="button"
                            onClick={runAutomaticTraversePlan}
                            disabled={traverseLoading || !traverseTarget}
                            className="w-full py-1.5 px-2.5 rounded-lg bg-cyan-500/20 hover:bg-cyan-500/30 border border-cyan-400/45 text-[9px] font-mono-tech uppercase tracking-wider text-cyan-200 transition disabled:opacity-50"
                          >
                            {traverseLoading ? 'Computing Optimal Traverse…' : 'Recompute Optimal Route'}
                          </button>

                          {traverseAutoResult && (
                            <>
                              <div className="grid grid-cols-3 gap-1 text-center rounded-lg bg-white/[0.03] border border-white/[0.06] p-1.5">
                                <div>
                                  <div className="text-[7px] font-mono-tech text-slate-500 uppercase">Status</div>
                                  <div
                                    className={`text-[9px] font-mono-tech uppercase ${
                                      traverseAutoResult.status === 'OPTIMAL'
                                        ? 'text-emerald-400'
                                        : traverseAutoResult.status === 'FEASIBLE'
                                          ? 'text-amber-300'
                                          : 'text-rose-400'
                                    }`}
                                  >
                                    {traverseAutoResult.status}
                                  </div>
                                </div>
                                <div>
                                  <div className="text-[7px] font-mono-tech text-slate-500 uppercase">Total Dist</div>
                                  <div className="text-[9px] font-mono-tech text-slate-200 tabular-nums">
                                    {traverseAutoResult.summary.total_traverse_distance_m >= 1000
                                      ? `${(traverseAutoResult.summary.total_traverse_distance_m / 1000).toFixed(1)}km`
                                      : `${Math.round(traverseAutoResult.summary.total_traverse_distance_m)}m`}
                                  </div>
                                </div>
                                <div>
                                  <div className="text-[7px] font-mono-tech text-slate-500 uppercase">Base LoS</div>
                                  <div className="text-[9px] font-mono-tech text-cyan-300 tabular-nums">
                                    {Math.round(traverseAutoResult.summary.base_los_fraction * 100)}%
                                  </div>
                                </div>
                                <div>
                                  <div className="text-[7px] font-mono-tech text-slate-500 uppercase">Total MET</div>
                                  <div className="text-[9px] font-mono-tech text-cyan-200 tabular-nums">
                                    +{(traverseAutoResult.summary.total_traverse_hours ?? maxRoverMetHours).toFixed(1)}h
                                  </div>
                                </div>
                                <div>
                                  <div className="text-[7px] font-mono-tech text-slate-500 uppercase">Regen Holds</div>
                                  <div className="text-[9px] font-mono-tech text-amber-300 tabular-nums">
                                    {traverseAutoResult.summary.regen_stops_count ?? 0} (+{(traverseAutoResult.summary.total_regen_hours ?? 0).toFixed(1)}h)
                                  </div>
                                </div>
                                <div>
                                  <div className="text-[7px] font-mono-tech text-slate-500 uppercase">Final Bat</div>
                                  <div className="text-[9px] font-mono-tech text-emerald-300 tabular-nums">
                                    {Math.round(traverseAutoResult.summary.final_battery_wh)}Wh
                                  </div>
                                </div>
                              </div>

                              <div className="space-y-1 max-h-[155px] overflow-y-auto hud-scroll pr-0.5">
                                {traverseAutoResult.waypoints.map(wp => {
                                  const wpMet = wp.met_hours ?? wp.arrival_met_hours ?? 0
                                  const isActiveSeg = activeRoverState?.activeSegmentIndex === wp.waypoint_index
                                  const hasRegen = (wp.regen_dwell_hours ?? 0) > 0
                                  return (
                                    <button
                                      key={wp.waypoint_index}
                                      type="button"
                                      onClick={() => {
                                        setPlaying(false)
                                        setIsRoverPlaying(false)
                                        setRoverSimHours(wpMet)
                                        if (samples.length > 0) {
                                          setSampleIndex(Math.min(lastSampleIdx, Math.max(0, Math.round(wpMet * 2))))
                                        }
                                      }}
                                      className={`w-full flex items-center justify-between text-[8px] font-mono-tech rounded border px-2 py-1 tabular-nums text-left transition ${
                                        isActiveSeg
                                          ? 'bg-cyan-400/15 border-cyan-400/50'
                                          : 'bg-white/[0.02] border-white/[0.05] hover:bg-white/[0.06]'
                                      }`}
                                    >
                                      <span className="text-slate-300 truncate max-w-[78px]">
                                        #{wp.waypoint_index} {wp.action === 'START_BASE_POD' ? 'BASE' : wp.action === 'ARRIVE_RESEARCH_TARGET' ? 'TARGET' : hasRegen ? '⚡REGEN' : `WP ${wp.waypoint_index}`}
                                      </span>
                                      <span className="text-cyan-300">T+{wpMet.toFixed(1)}h</span>
                                      <span className={wp.slope_deg <= 8 ? 'text-emerald-400' : 'text-amber-300'}>
                                        {wp.slope_deg.toFixed(1)}°
                                      </span>
                                      <span className="text-amber-300">
                                        {hasRegen ? `+${wp.regen_dwell_hours?.toFixed(1)}h` : `${Math.round(wp.illumination_fraction * 100)}%☀`}
                                      </span>
                                      <span className={wp.los_to_base ? 'text-emerald-400' : 'text-rose-400'}>
                                        {wp.los_to_base ? 'LOS' : 'BLK'}
                                      </span>
                                    </button>
                                  )
                                })}
                              </div>
                            </>
                          )}
                        </>
                      )}
                    </div>
                  )}
                </div>
              )}
            </section>

            {/* Section 3: Safe Haven Recommender */}
            <section className="space-y-2 pt-2 border-t border-white/[0.07]">
              <div className="flex items-center justify-between">
                <span className="text-[9px] font-mono-tech tracking-[0.16em] text-slate-500 uppercase">
                  Safe Havens (&lt;8° Slope)
                </span>
                {workspace.recommendations && (
                  <span className="text-[9px] font-mono-tech text-slate-400 tabular-nums">
                    {workspace.recommendations.candidates.length} within{' '}
                    {Math.round(workspace.recommendations.search_radius_m).toLocaleString()}m
                  </span>
                )}
              </div>

              {workspace.recommendations?.candidates.length ? (
                <div className="space-y-1.5">
                  {workspace.recommendations.candidates.map(cand => {
                    const active = highlightedCandidateId === cand.site_id
                    const band = classifySlopeBand(cand.slope_deg)
                    return (
                      <button
                        key={cand.site_id}
                        type="button"
                        onClick={() => {
                          setHighlightedCandidateId(prev => (prev === cand.site_id ? null : cand.site_id))
                          if (cameraMode !== 'SURFACE') {
                            applyCameraPreset('SURFACE', surfacePreset)
                          }
                        }}
                        className={`w-full text-left rounded-xl p-2.5 border transition ${
                          active
                            ? 'border-amber-400/55 bg-amber-400/10'
                            : 'border-white/[0.08] bg-white/[0.03] hover:bg-white/[0.06]'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[10px] font-mono-tech text-slate-100 uppercase tracking-wider truncate flex items-center gap-1.5">
                            <Sparkles className="w-3 h-3 text-emerald-400 shrink-0" />
                            {cand.site_id.replace(/^site\d+_[a-z_]+_/, '').replaceAll('_', ' ')}
                          </span>
                          <span className="text-[9px] font-mono-tech text-emerald-400 shrink-0 tabular-nums">
                            {cand.slope_deg.toFixed(2)}° {band}
                          </span>
                        </div>
                        <div className="flex items-center justify-between text-[9px] font-mono-tech text-slate-400 mt-1 tabular-nums">
                          <span>
                            {cand.distance_m.toFixed(0)}m @ {cand.bearing_deg.toFixed(0)}° ·{' '}
                            {cand.coordinates.elevation_m >= 0 ? '+' : ''}
                            {Math.round(cand.coordinates.elevation_m)}m
                          </span>
                          {cand.sunlight_fraction_delta !== null && (
                            <span className="text-cyan-300">
                              +{(cand.sunlight_fraction_delta * 100).toFixed(0)}% SUN
                            </span>
                          )}
                        </div>
                      </button>
                    )
                  })}
                </div>
              ) : (
                <div className="rounded-xl border border-white/[0.07] bg-black/30 px-3 py-2.5 text-[10px] font-mono-tech text-slate-400 leading-relaxed">
                  Select a NASA LOLA catalog site (Connecting Ridge, Shackleton, Malapert, or Haworth) to inspect &lt;8° safe-haven divert spots.
                </div>
              )}
            </section>

            {/* Section 3: Collapsible 2D Polar Stereographic Map */}
            <section className="space-y-2 pt-2 border-t border-white/[0.07]">
              <button
                type="button"
                onClick={() => setPolarOpen(o => !o)}
                className="w-full flex items-center justify-between text-[9px] font-mono-tech tracking-[0.16em] text-slate-400 hover:text-slate-100 uppercase transition"
              >
                <span className="inline-flex items-center gap-1.5">
                  <Compass className="w-3 h-3 text-cyan-300" />
                  2D Polar Stereographic (85°S–90°S)
                </span>
                {polarOpen ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
              </button>

              {polarOpen && (
                <div className="rounded-xl border border-white/[0.08] bg-black/35 p-2.5">
                  <PolarMap
                    siteId={workspace.target.catalogEntry?.polarId ?? 'connecting-ridge'}
                    onSiteChange={polarId => {
                      const matched = CATALOG_SITES.find(s => s.polarId === polarId)
                      if (matched) void selectCatalogSite(matched, true)
                    }}
                    nearby={workspace.recommendations ?? undefined}
                  />
                </div>
              )}
            </section>

            {/* Section 4: 3D Markers Legend & External Reference APIs */}
            <section className="space-y-2.5 pt-2 border-t border-white/[0.07]">
              <div className="text-[9px] font-mono-tech tracking-[0.16em] text-slate-500 uppercase">
                3D Scene Legend
              </div>
              <div className="space-y-1.5 text-[9px] font-mono-tech tracking-wider uppercase text-slate-300">
                <div className="flex items-center gap-2">
                  <svg width="14" height="14" viewBox="0 0 32 32" className="shrink-0" aria-hidden="true">
                    <polygon points="16,2 28,9 28,23 16,30 4,23 4,9" fill="#061318" stroke="#2dd4bf" strokeWidth="2.5" />
                    <rect x="11" y="11" width="10" height="7" rx="1.5" fill="none" stroke="#6ee7b7" strokeWidth="2" />
                    <circle cx="16" cy="6" r="2.5" fill="#34d399" />
                  </svg>
                  <span>Initial Landing Site · Base Pod ({observerHeightM}m)</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="w-3.5 h-[2px] bg-amber-400 shrink-0" />
                  <span>Sun Line-of-Sight Vector</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="w-3.5 h-[2px] bg-emerald-400 shrink-0" />
                  <span>Earth DTE Vector (Rose = Blocked)</span>
                </div>
                {traverseOpen && (
                  <>
                    <div className="flex items-center gap-2">
                      <svg width="14" height="14" viewBox="0 0 34 34" className="shrink-0" aria-hidden="true">
                        <path d="M5,10 V5 H10 M24,5 H29 V10 M5,24 V29 H10 M24,29 H29 V24" fill="none" stroke="#38bdf8" strokeWidth="2.5" />
                        <polygon points="17,5 29,17 17,29 5,17" fill="#1a0918" stroke="#f472b6" strokeWidth="2.5" />
                        <circle cx="17" cy="17" r="3" fill="#f472b6" />
                      </svg>
                      <span>Research Target Location (PSR / Rim)</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="inline-flex items-center w-3.5 shrink-0">
                        <span className="w-2.5 h-[2px] bg-cyan-400" />
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 -ml-0.5" />
                      </span>
                      <span>Rover Traverse Path &amp; Waypoints</span>
                    </div>
                  </>
                )}
                {workspace.recommendations && workspace.recommendations.candidates.length > 0 && (
                  <div className="flex items-center gap-2">
                    <span className="w-3 h-3 ml-0.5 rounded-full border border-cyan-300 shrink-0" />
                    <span>Safe Havens (&lt;8° Slope)</span>
                  </div>
                )}
              </div>

              <div className="pt-2">
                <div className="text-[9px] font-mono-tech tracking-[0.16em] text-slate-500 uppercase mb-1.5">
                  External Reference Portals
                </div>
                <div className="grid grid-cols-2 gap-1.5">
                  {externalLinks.map(link => (
                    <a
                      key={link.name}
                      href={link.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="rounded-xl border border-white/[0.08] bg-white/[0.03] hover:bg-white/[0.08] px-2.5 py-1.5 transition group"
                    >
                      <div className="flex items-center justify-between gap-1 text-[9px] font-mono-tech text-slate-200 group-hover:text-cyan-200 uppercase">
                        <span className="truncate">{link.name}</span>
                        <ExternalLink className="w-2.5 h-2.5 shrink-0 opacity-60 group-hover:opacity-100" />
                      </div>
                      <div className="text-[8px] font-mono-tech text-slate-500 truncate mt-0.5">{link.tag}</div>
                    </a>
                  ))}
                </div>
              </div>
            </section>
          </div>
        </aside>
      )}

      {/* RIGHT FLOATING HIDEABLE SIDEBAR: Live Telemetry, 360° Horizon Canvas, LunaDiff +48h & Export */}
      {workspace && (
        <aside
          aria-label="Live telemetry, horizon profile, and +48h launch delay comparison"
          aria-hidden={!detailsVisible || !rightSidebarOpen}
          className={`fixed top-20 right-4 bottom-20 z-20 w-[calc(100vw-2rem)] sm:w-[344px] lg:w-[388px] glass-hud rounded-2xl flex flex-col shadow-[0_24px_64px_rgba(0,0,0,0.82)] transition-all duration-300 ease-out ${
            detailsVisible && rightSidebarOpen
              ? 'opacity-100 translate-x-0 pointer-events-auto'
              : 'opacity-0 translate-x-8 pointer-events-none'
          }`}
        >
          {/* Sticky Header */}
          <div className="px-4 pt-3.5 pb-2.5 border-b border-white/[0.08] flex items-center justify-between gap-2 shrink-0">
            <span className="text-[10px] font-mono-tech font-medium tracking-[0.16em] text-slate-200 uppercase">
              Telemetry &amp; Horizon
            </span>
            <div className="flex items-center gap-1.5 shrink-0">
              <button
                type="button"
                onClick={() => void exportAnalysisReport(workspace.analysis, 'csv')}
                disabled={workspace.analysis.samples.length < 2}
                title="Export 14-day mission visibility timeline as CSV"
                className="px-2 py-0.5 rounded-full text-[9px] font-mono-tech tracking-wider uppercase border border-white/10 bg-white/[0.04] text-slate-300 hover:text-white hover:border-white/25 transition inline-flex items-center gap-1"
              >
                <Download className="w-2.5 h-2.5" />
                CSV
              </button>
              <button
                type="button"
                onClick={() => void exportAnalysisReport(workspace.analysis, 'json')}
                disabled={workspace.analysis.samples.length < 2}
                title="Export contract analysis JSON"
                className="px-2 py-0.5 rounded-full text-[9px] font-mono-tech tracking-wider uppercase border border-white/10 bg-white/[0.04] text-slate-300 hover:text-white hover:border-white/25 transition inline-flex items-center gap-1"
              >
                JSON
              </button>
              <button
                type="button"
                onClick={() => setRightSidebarOpen(false)}
                title="Collapse Telemetry Sidebar"
                className="px-2 py-0.5 rounded-full text-[9px] font-mono-tech tracking-wider uppercase border border-white/10 bg-white/[0.04] text-slate-300 hover:text-white hover:border-white/25 transition inline-flex items-center gap-0.5"
              >
                HIDE
                <ChevronRight className="w-3 h-3" />
              </button>
            </div>
          </div>

          {/* Scrollable Body */}
          <div className="flex-1 overflow-y-auto hud-scroll px-4 py-3 space-y-4">
            {/* Section 1: Live Timestamp Earth / Solar Telemetry */}
            <section className="space-y-2">
              <div className="flex items-center justify-between bg-white/[0.03] rounded-xl px-3 py-2 border border-white/[0.06]">
                <div>
                  <div className="flex items-center gap-2">
                    <span
                      className={`w-2 h-2 rounded-full ${
                        earthIn
                          ? 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.75)]'
                          : 'bg-rose-400 shadow-[0_0_8px_rgba(251,113,133,0.75)]'
                      }`}
                    />
                    <span className="text-[10px] font-mono-tech tracking-[0.14em] text-slate-300 uppercase">
                      Earth DTE LoS
                    </span>
                  </div>
                  {currentSample && (
                    <div className="text-[9px] font-mono-tech text-slate-500 mt-0.5 pl-4 tabular-nums">
                      AZ {String(Math.round(currentSample.earth.azimuth_deg)).padStart(3, '0')}° · EL{' '}
                      {currentSample.earth.elevation_deg >= 0 ? '+' : ''}
                      {currentSample.earth.elevation_deg.toFixed(1)}°
                    </div>
                  )}
                </div>
                <div
                  className={`text-[11px] font-mono-tech font-medium tracking-wider uppercase tabular-nums ${
                    earthIn ? 'text-emerald-400' : 'text-rose-400'
                  }`}
                >
                  {currentSample?.earth.visible == null ? 'Unknown' : earthIn ? 'Visible' : 'Obstructed'}{' '}
                  {earthMarginDeg !== null && `(${earthMarginDeg >= 0 ? '+' : ''}${earthMarginDeg.toFixed(1)}°)`}
                </div>
              </div>

              <div className="flex items-center justify-between bg-white/[0.03] rounded-xl px-3 py-2 border border-white/[0.06]">
                <div>
                  <div className="flex items-center gap-2">
                    <span
                      className={`w-2 h-2 rounded-full ${
                        sunIn ? 'bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.75)]' : 'bg-slate-500'
                      }`}
                    />
                    <span className="text-[10px] font-mono-tech tracking-[0.14em] text-slate-300 uppercase">
                      Solar Disc
                    </span>
                  </div>
                  {currentSample && (
                    <div className="text-[9px] font-mono-tech text-slate-500 mt-0.5 pl-4 tabular-nums">
                      AZ {String(Math.round(currentSample.sun.azimuth_deg)).padStart(3, '0')}° · EL{' '}
                      {currentSample.sun.elevation_deg >= 0 ? '+' : ''}
                      {currentSample.sun.elevation_deg.toFixed(1)}°
                    </div>
                  )}
                </div>
                <div
                  className={`text-[11px] font-mono-tech font-medium tracking-wider uppercase tabular-nums ${
                    sunIn ? 'text-amber-300' : 'text-slate-400'
                  }`}
                >
                  {currentSample?.sun.illumination_fraction !== null &&
                  currentSample?.sun.illumination_fraction !== undefined
                    ? `${Math.round(currentSample.sun.illumination_fraction * 100)}% Lit`
                    : 'Unknown'}
                </div>
              </div>

              {/* Terrain Elevation, Slope & Max Rim */}
              <div className="grid grid-cols-3 gap-2 rounded-xl bg-white/[0.02] border border-white/[0.06] px-3 py-2">
                <div>
                  <div className="text-[8px] font-mono-tech tracking-[0.14em] text-slate-500 uppercase">Elev</div>
                  <div className="text-[11px] font-mono-tech text-slate-200 tabular-nums mt-0.5">
                    {`${workspace.target.elevation_m >= 0 ? '+' : ''}${Math.round(workspace.target.elevation_m).toLocaleString()} m`}
                  </div>
                </div>
                <div>
                  <div className="text-[8px] font-mono-tech tracking-[0.14em] text-slate-500 uppercase">Slope</div>
                  <div className={`text-[11px] font-mono-tech tabular-nums mt-0.5 ${slopeColorCls}`}>
                    {workspace.effectiveSlopeDeg !== null
                      ? `${workspace.effectiveSlopeDeg.toFixed(1)}° ${workspace.effectiveSlopeBand}`
                      : 'N/A'}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-[8px] font-mono-tech tracking-[0.14em] text-slate-500 uppercase">Max Rim</div>
                  <div className="text-[11px] font-mono-tech text-slate-200 tabular-nums mt-0.5">
                    {peakObstruction
                      ? `${peakObstruction.el.toFixed(1)}°@${String(Math.round(peakObstruction.az)).padStart(3, '0')}°`
                      : 'N/A'}
                  </div>
                </div>
              </div>
            </section>

            {/* Section 2: 14-Day Mission Aggregate Summary */}
            <section className="space-y-1.5 pt-2 border-t border-white/[0.07]">
              <div className="text-[9px] font-mono-tech tracking-[0.16em] text-slate-500 uppercase">
                14-Day Window Summary ({workspace.analysis.observer_height_m}m Mast)
              </div>
              <div className="grid grid-cols-4 gap-1.5 text-center">
                <div className="rounded-xl bg-white/[0.03] border border-white/[0.06] py-1.5 px-1">
                  <div className="text-[8px] font-mono-tech text-slate-500 uppercase">Sun</div>
                  <div className="text-[11px] font-mono-tech text-amber-300 tabular-nums mt-0.5">
                    {workspace.analysis.metrics.sunlight_fraction !== null
                      ? `${(workspace.analysis.metrics.sunlight_fraction * 100).toFixed(1)}%`
                      : '—'}
                  </div>
                </div>
                <div className="rounded-xl bg-white/[0.03] border border-white/[0.06] py-1.5 px-1">
                  <div className="text-[8px] font-mono-tech text-slate-500 uppercase">Max Dark</div>
                  <div className="text-[11px] font-mono-tech text-slate-200 tabular-nums mt-0.5">
                    {workspace.analysis.metrics.max_darkness_hours !== null
                      ? `${workspace.analysis.metrics.max_darkness_hours.toFixed(0)}h`
                      : '—'}
                  </div>
                </div>
                <div className="rounded-xl bg-white/[0.03] border border-white/[0.06] py-1.5 px-1">
                  <div className="text-[8px] font-mono-tech text-slate-500 uppercase">Earth DTE</div>
                  <div className="text-[11px] font-mono-tech text-emerald-400 tabular-nums mt-0.5">
                    {workspace.analysis.metrics.earth_visible_fraction !== null
                      ? `${(workspace.analysis.metrics.earth_visible_fraction * 100).toFixed(1)}%`
                      : '—'}
                  </div>
                </div>
                <div className="rounded-xl bg-white/[0.03] border border-white/[0.06] py-1.5 px-1">
                  <div className="text-[8px] font-mono-tech text-slate-500 uppercase">Both Vis</div>
                  <div className="text-[11px] font-mono-tech text-cyan-300 tabular-nums mt-0.5">
                    {workspace.analysis.metrics.both_visible_hours !== null
                      ? `${workspace.analysis.metrics.both_visible_hours.toFixed(0)}h`
                      : '—'}
                  </div>
                </div>
              </div>
            </section>

            {/* Section 3: Interactive 360° Horizon Profile */}
            <section className="space-y-1.5 pt-2 border-t border-white/[0.07]">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[9px] font-mono-tech tracking-[0.16em] text-slate-500 uppercase">
                  360° Horizon Profile
                </span>
                <div className="flex items-center gap-2">
                  {diffHighlightAzimuth !== null && (
                    <button
                      type="button"
                      onClick={() => setDiffHighlightAzimuth(null)}
                      className="text-[9px] font-mono-tech text-rose-300 hover:text-white uppercase"
                    >
                      Clear Pin
                    </button>
                  )}
                  <span className="text-[9px] font-mono-tech text-slate-400 tabular-nums">
                    {horizonHoverText ?? 'HOVER PROFILE'}
                  </span>
                </div>
              </div>
              <div className="relative w-full h-[112px] rounded-xl bg-black/50 border border-white/[0.07] overflow-hidden">
                <HorizonProfileCanvas
                  horizon={workspace.analysis.horizon}
                  currentSample={currentSample}
                  highlightAzimuthDeg={diffHighlightAzimuth}
                  onHoverChange={setHorizonHoverText}
                />
              </div>
            </section>

            {/* Section 4: LunaDiff +48h Launch Delay Analysis */}
            <section className="space-y-2 pt-2 border-t border-white/[0.07]">
              <div className="text-[9px] font-mono-tech tracking-[0.16em] text-slate-500 uppercase">
                LunaDiff · +48h Launch Delay
              </div>

              {workspace.diff48h ? (
                <>
                  <div className="grid grid-cols-3 gap-1.5">
                    <div className="bg-white/[0.03] rounded-xl px-2.5 py-2 border border-white/[0.06]">
                      <div className="text-[8px] font-mono-tech text-slate-500 uppercase">Δ Sun</div>
                      <div
                        className={`text-xs font-mono-tech tabular-nums mt-0.5 ${
                          (workspace.diff48h.deltas.sunlight_hours ?? 0) >= 0 ? 'text-emerald-400' : 'text-rose-400'
                        }`}
                      >
                        {workspace.diff48h.deltas.sunlight_hours !== null
                          ? `${workspace.diff48h.deltas.sunlight_hours >= 0 ? '+' : ''}${workspace.diff48h.deltas.sunlight_hours.toFixed(1)}h`
                          : 'N/A'}
                      </div>
                    </div>
                    <div className="bg-white/[0.03] rounded-xl px-2.5 py-2 border border-white/[0.06]">
                      <div className="text-[8px] font-mono-tech text-slate-500 uppercase">Δ Dark</div>
                      <div className="text-xs font-mono-tech text-slate-200 tabular-nums mt-0.5">
                        {workspace.diff48h.deltas.max_darkness_hours !== null
                          ? `${workspace.diff48h.deltas.max_darkness_hours >= 0 ? '+' : ''}${workspace.diff48h.deltas.max_darkness_hours.toFixed(1)}h`
                          : 'N/A'}
                      </div>
                    </div>
                    <div className="bg-white/[0.03] rounded-xl px-2.5 py-2 border border-white/[0.06]">
                      <div className="text-[8px] font-mono-tech text-slate-500 uppercase">Δ DTE</div>
                      <div
                        className={`text-xs font-mono-tech tabular-nums mt-0.5 ${
                          (workspace.diff48h.deltas.earth_visible_hours ?? 0) >= 0
                            ? 'text-emerald-400'
                            : 'text-rose-400'
                        }`}
                      >
                        {workspace.diff48h.deltas.earth_visible_hours !== null
                          ? `${workspace.diff48h.deltas.earth_visible_hours >= 0 ? '+' : ''}${workspace.diff48h.deltas.earth_visible_hours.toFixed(1)}h`
                          : 'N/A'}
                      </div>
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    {workspace.diff48h.diagnostic_intervals.map((iv, idx) => {
                      const gained = iv.type.startsWith('GAINED')
                      const az = extractAzimuthFromReason(iv.reason)
                      return (
                        <button
                          key={`${iv.type}-${idx}`}
                          type="button"
                          onClick={() => {
                            setPlaying(false)
                            const closestIdx = samples.findIndex(s => s.met_hours >= iv.start_met_hours)
                            if (closestIdx >= 0) setSampleIndex(closestIdx)
                            setDiffHighlightAzimuth(az)
                          }}
                          className="w-full text-left px-2.5 py-2 rounded-xl bg-white/[0.03] hover:bg-white/[0.07] border border-white/[0.06] transition"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span
                              className={`text-[9px] font-mono-tech tracking-wider uppercase ${
                                gained ? 'text-emerald-400' : 'text-rose-400'
                              }`}
                            >
                              {iv.type.replaceAll('_', ' ')} · +{iv.start_met_hours}h→+{iv.end_met_hours}h
                            </span>
                            <span className="text-[9px] font-mono-tech text-cyan-300 shrink-0 uppercase">
                              Inspect →
                            </span>
                          </div>
                          <p className="text-[10px] text-slate-400 mt-0.5 leading-snug">{iv.reason}</p>
                        </button>
                      )
                    })}
                  </div>
                </>
              ) : (
                <div className="rounded-xl border border-white/[0.07] bg-black/30 px-3 py-2.5 text-[10px] font-mono-tech text-slate-400 leading-relaxed">
                  Verified +48h LunaDiff schedule comparison is currently populated for Connecting Ridge (Site 01) where 16-day JPL Horizons ephemerides exist.
                </div>
              )}
            </section>
          </div>
        </aside>
      )}

      {/* COMPACT FLOATING BOTTOM MISSION TIMELINE SCRUBBER */}
      {workspace && detailsVisible && samples.length > 0 && currentSample && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-25 w-[94vw] max-w-[620px] glass-hud rounded-full px-3.5 sm:px-4 py-2 flex items-center gap-2.5 shadow-[0_16px_48px_rgba(0,0,0,0.8)]">
          <button
            type="button"
            onClick={() => {
              if (playing) {
                setPlaying(false)
                return
              }
              if (sampleIndex >= lastSampleIdx) setSampleIndex(0)
              setPlaying(true)
            }}
            className="px-2.5 py-1 rounded-full border border-white/15 bg-white/[0.06] hover:bg-white/15 text-[10px] font-mono-tech text-slate-100 inline-flex items-center gap-1 transition shrink-0"
          >
            {playing ? <Pause className="w-3 h-3" /> : <Play className="w-3 h-3" />}
            {playing ? 'PAUSE' : 'PLAY'}
          </button>

          <div className="flex items-center rounded-full border border-white/10 bg-white/[0.03] p-0.5 shrink-0">
            {([1, 5, 20] as const).map(s => (
              <button
                key={s}
                type="button"
                onClick={() => setSpeed(s)}
                className={`px-1.5 py-0.5 rounded-full text-[9px] font-mono-tech transition ${
                  speed === s ? 'bg-white/15 text-white' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {s}×
              </button>
            ))}
          </div>

          <input
            type="range"
            min={0}
            max={lastSampleIdx}
            step={1}
            value={sampleIndex}
            onChange={e => {
              const nextIdx = Number(e.target.value)
              setPlaying(false)
              setIsRoverPlaying(false)
              setSampleIndex(nextIdx)
              if (maxRoverMetHours > 0) {
                const nextMet = samples[nextIdx]?.met_hours ?? nextIdx * 0.5
                setRoverSimHours(Math.min(maxRoverMetHours, nextMet))
              }
            }}
            aria-label="Mission elapsed timeline"
            className="hud-range flex-1 min-w-[90px]"
          />

          <span className="text-[10px] font-mono-tech text-slate-300 tabular-nums shrink-0 hidden sm:inline">
            +{(traverseOpen && maxRoverMetHours > 0 ? roverSimHours : currentSample.met_hours).toFixed(2)}h ·{' '}
            {currentSample.utc.replace('T', ' ').replace('Z', '').slice(0, 16)} UTC
          </span>
          <span className="text-[10px] font-mono-tech text-slate-300 tabular-nums shrink-0 sm:hidden">
            +{(traverseOpen && maxRoverMetHours > 0 ? roverSimHours : currentSample.met_hours).toFixed(2)}h
          </span>

          <button
            type="button"
            onClick={() => setDetailsVisible(false)}
            title="Hide HUD (press H)"
            className="p-1 rounded-full text-slate-400 hover:text-white hover:bg-white/10 transition shrink-0"
            aria-label="Hide floating HUD"
          >
            <EyeOff className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Compact Show HUD Pill When Entire HUD Is Hidden */}
      {workspace && !detailsVisible && (
        <div className="fixed bottom-5 left-1/2 -translate-x-1/2 z-20">
          <button
            type="button"
            onClick={() => setDetailsVisible(true)}
            className="glass-hud rounded-full px-4 py-2 text-[10px] font-mono-tech tracking-[0.16em] uppercase text-slate-100 hover:border-emerald-400/45 hover:text-emerald-300 transition shadow-[0_12px_36px_rgba(0,0,0,0.75)] inline-flex items-center gap-2"
          >
            <ChevronUp className="w-3.5 h-3.5 text-emerald-400" />
            <span>{workspace.target.name}</span>
            <span className="text-slate-500">·</span>
            <span className="text-emerald-300">SHOW HUD (H)</span>
          </button>
        </div>
      )}
    </div>
  )
}

export default App
