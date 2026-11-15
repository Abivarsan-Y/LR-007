import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Compass,
  Download,
  ExternalLink,
  Eye,
  EyeOff,
  Globe,
  Info,
  Layers,
  Pause,
  Play,
  Search,
  Sparkles,
  X,
} from 'lucide-react'
import {
  buildCustomCoordinateWorkspace,
  CATALOG_SITES,
  classifySlopeBand,
  exportAnalysisReport,
  formatLatLonCompact,
  interpolateHorizonSample,
  loadCatalogSiteWorkspace,
  normalizeLongitudeDeg,
  POLAR_LANDMARKS,
} from './api/client'
import type { CatalogSiteEntry, LoadedSiteWorkspace } from './api/types'
import { HorizonProfileCanvas } from './features/analysis/HorizonProfileCanvas'
import type {
  SurfaceCameraPreset,
  SurfacePickEvent,
  TerrainOverlayMode,
} from './features/map/CesiumLunarStage'
import { PolarMap } from './features/map/PolarMap'
import { ViewerBoundary } from './features/map/ViewerBoundary'
const CesiumLunarStage = lazy(() => import('./features/map/CesiumLunarStage').then(module => ({ default: module.CesiumLunarStage })))

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
  const [streamLiveImagery,setStreamLiveImagery] = useState(false)
  const [useNasaTrekImagery, setUseNasaTrekImagery] = useState(true)
  const [nasaImageryStatus, setNasaImageryStatus] = useState<'loading' | 'loaded' | 'offline'>('loading')

  // DEM / visualization overlays
  const [overlayMode, setOverlayMode] = useState<TerrainOverlayMode>('albedo')
  const [showWireframe, setShowWireframe] = useState(false)
  const [verticalScale, setVerticalScale] = useState<1 | 2 | 4>(1)
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
      setFocusCoords({ latitude_deg: site.latitude_deg, longitude_deg: site.longitude_deg })
      if (zoomSurface) setDesiredCameraMode('SURFACE')
      setCameraPresetNonce(n => n + 1)

      try {
        const loaded = await loadCatalogSiteWorkspace(site, mast)
        if (sequence !== requestSequence.current) return
        setWorkspace(loaded)
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
      elevM = 0,
      horizonAngles: number[] = Array.from({ length: 72 }, () => 1.5),
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

      requestSequence.current += 1
      setLoadingTarget(false)
      setLoadError('')
      const custom = buildCustomCoordinateWorkspace({
        label,
        latitude_deg: lat,
        longitude_deg: lon,
        elevation_m: elevM,
        observerHeightM,
        horizonAnglesDeg: horizonAngles,
      })
      setWorkspace(custom)
      setSampleIndex(0)
    },
    [observerHeightM],
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
    if (workspace?.target.catalogEntry) await selectCatalogSite(workspace.target.catalogEntry, false, nextMast)
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
      setFocusCoords({ latitude_deg: pick.latitude_deg, longitude_deg: pick.longitude_deg })
      setSearchQuery(formatLatLonCompact(pick.latitude_deg, pick.longitude_deg))
      requestSequence.current += 1
      setLoadingTarget(false)
      setLoadError('')
      setWorkspace(
        buildCustomCoordinateWorkspace({
          label: pick.label,
          latitude_deg: pick.latitude_deg,
          longitude_deg: pick.longitude_deg,
          elevation_m: pick.elevation_m,
          observerHeightM,
          horizonAnglesDeg: pick.horizonAnglesDeg,
        }),
      )
      setSampleIndex(0)
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

  // Synchronized Timeline Playback
  const samples = workspace?.analysis.samples ?? []
  const lastSampleIdx = Math.max(samples.length - 1, 0)
  const currentSample = samples[sampleIndex] ?? samples[0] ?? null

  useEffect(() => {
    if (!playing || samples.length === 0) return
    if (sampleIndex >= lastSampleIdx) {
      setPlaying(false)
      return
    }
    const timer = window.setTimeout(() => {
      setSampleIndex(prev => {
        const next = prev + 1
        if (next >= lastSampleIdx) setPlaying(false)
        return Math.min(next, lastSampleIdx)
      })
    }, 1000 / speed)
    return () => window.clearTimeout(timer)
  }, [playing, sampleIndex, lastSampleIdx, speed, samples.length])

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

  return (
    <div className="relative w-full h-full overflow-hidden bg-[#050507] text-slate-100 select-none">
      {/* Cesium lunar sphere with streamed LROC imagery and the verified local Site01 grid */}
      <ViewerBoundary>
      <Suspense fallback={<div role="status" className="absolute inset-0 grid place-items-center text-sm text-slate-300">Loading lunar viewer…</div>}>
      <CesiumLunarStage
        catalogSites={CATALOG_SITES}
        selectedSiteId={workspace?.target.catalogEntry?.id ?? null}
        focusCoordinates={focusCoords}
        hasSelection={Boolean(workspace)}
        desiredCameraMode={desiredCameraMode}
        surfacePreset={surfacePreset}
        useNasaTrekImagery={useNasaTrekImagery}
        streamLiveImagery={streamLiveImagery}
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
        onCameraModeChange={setCameraMode}
        onPickPoint={handlePickPoint}
        onSelectCatalogSite={site => void selectCatalogSite(site, true)}
        onNasaImageryStatusChange={setNasaImageryStatus}
      />
      </Suspense>
      </ViewerBoundary>

      {loadError && <div role="alert" className="fixed top-20 left-1/2 -translate-x-1/2 z-40 glass-hud rounded-xl p-3 text-xs text-rose-200">{loadError}</div>}
      {/* Top Floating Search & Camera Control Pill */}
      <div
        ref={searchWrapperRef}
        className="fixed top-4 left-1/2 -translate-x-1/2 z-30 w-[95vw] max-w-[760px]"
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
              <button type="button" aria-pressed={streamLiveImagery} onClick={()=>setStreamLiveImagery(value=>!value)} className="w-full text-left text-[9px] text-slate-400 px-2.5 py-1.5 rounded-lg border border-white/10">
                {streamLiveImagery?'LIVE TILES ON · INTERNET REQUIRED':'BUNDLED REAL IMAGERY · NO INTERNET REQUIRED'}
              </button>
            </section>

            {/* Section 2: Safe Haven Recommender */}
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
              <div className="space-y-1 text-[9px] font-mono-tech tracking-wider uppercase text-slate-300">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-emerald-400 shrink-0" />
                  <span>Lander &amp; Observer Mast ({observerHeightM}m)</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="w-3 h-[2px] bg-amber-400 shrink-0" />
                  <span>Sun Line-of-Sight Vector</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="w-3 h-[2px] bg-emerald-400 shrink-0" />
                  <span>Earth DTE Vector (Rose = Blocked)</span>
                </div>
                {workspace.recommendations && workspace.recommendations.candidates.length > 0 && (
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full border border-cyan-300 shrink-0" />
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
                    {workspace.target.isCatalogSite ? `${workspace.target.elevation_m >= 0 ? '+' : ''}${Math.round(workspace.target.elevation_m).toLocaleString()} m` : 'Not sampled'}
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
              setPlaying(false)
              setSampleIndex(Number(e.target.value))
            }}
            aria-label="Mission elapsed timeline"
            className="hud-range flex-1 min-w-[90px]"
          />

          <span className="text-[10px] font-mono-tech text-slate-300 tabular-nums shrink-0 hidden sm:inline">
            +{currentSample.met_hours.toFixed(1)}h ·{' '}
            {currentSample.utc.replace('T', ' ').replace('Z', '').slice(0, 16)} UTC
          </span>
          <span className="text-[10px] font-mono-tech text-slate-300 tabular-nums shrink-0 sm:hidden">
            +{currentSample.met_hours.toFixed(1)}h
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
