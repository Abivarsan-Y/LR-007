import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Compass,
  Download,
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
import { LunarStage3D, type SurfacePickEvent, type TerrainOverlayMode } from './features/map/LunarStage3D'
import { PolarMap } from './features/map/PolarMap'

type HudTab = 'telemetry' | 'diff' | 'havens'

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

export function App() {
  const [workspace, setWorkspace] = useState<LoadedSiteWorkspace | null>(null)
  const [loadingTarget, setLoadingTarget] = useState(false)
  const [observerHeightM, setObserverHeightM] = useState<2 | 5>(2)
  const [sampleIndex, setSampleIndex] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState<1 | 5 | 20>(1)

  // Camera & visualization controls
  const [cameraMode, setCameraMode] = useState<'ORBITAL' | 'SURFACE'>('ORBITAL')
  const [desiredCameraMode, setDesiredCameraMode] = useState<'ORBITAL' | 'SURFACE'>('ORBITAL')
  const [cameraPresetNonce, setCameraPresetNonce] = useState(0)
  const [focusCoords, setFocusCoords] = useState<{ latitude_deg: number; longitude_deg: number } | null>(null)

  const [overlayMode, setOverlayMode] = useState<TerrainOverlayMode>('albedo')
  const [showWireframe, setShowWireframe] = useState(false)
  const [verticalScale, setVerticalScale] = useState<1 | 2>(2)
  const [polarOpen, setPolarOpen] = useState(false)

  // HUD tabs & sub-selection states
  const [activeTab, setActiveTab] = useState<HudTab>('telemetry')
  const [highlightedCandidateId, setHighlightedCandidateId] = useState<string | null>(null)
  const [diffHighlightAzimuth, setDiffHighlightAzimuth] = useState<number | null>(null)
  const [horizonHoverText, setHorizonHoverText] = useState<string | null>(null)
  const [showProvenanceInfo, setShowProvenanceInfo] = useState(false)

  // Minimal search bar state
  const [searchQuery, setSearchQuery] = useState('')
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const searchWrapperRef = useRef<HTMLDivElement>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)

  const selectCatalogSite = useCallback(
    async (site: CatalogSiteEntry, zoomSurface = true, mastOverride?: 2 | 5) => {
      const mast = mastOverride ?? observerHeightM
      setLoadingTarget(true)
      setHighlightedCandidateId(null)
      setDiffHighlightAzimuth(null)
      setShowProvenanceInfo(false)
      setActiveTab('telemetry')
      setDropdownOpen(false)
      setSearchQuery(site.shortName)
      setFocusCoords({ latitude_deg: site.latitude_deg, longitude_deg: site.longitude_deg })
      if (zoomSurface) setDesiredCameraMode('SURFACE')
      setCameraPresetNonce(n => n + 1)

      const loaded = await loadCatalogSiteWorkspace(site, mast)
      setWorkspace(loaded)
      setSampleIndex(idx => Math.min(idx, Math.max(loaded.analysis.samples.length - 1, 0)))
      setLoadingTarget(false)
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
      setHighlightedCandidateId(null)
      setDiffHighlightAzimuth(null)
      setShowProvenanceInfo(false)
      setActiveTab('telemetry')
      setDropdownOpen(false)
      setSearchQuery(label === 'Coordinate Target' || label === 'Surface Coordinate' ? formatLatLonCompact(lat, lon) : label)
      setFocusCoords({ latitude_deg: lat, longitude_deg: lon })
      if (zoomSurface) setDesiredCameraMode('SURFACE')
      setCameraPresetNonce(n => n + 1)

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

  // Handle mast height reload when focused on a catalog site
  const handleMastToggle = useCallback(
    async (nextMast: 2 | 5) => {
      if (nextMast === observerHeightM) return
      setObserverHeightM(nextMast)
      if (!workspace) return
      if (workspace.target.catalogEntry) {
        setLoadingTarget(true)
        const reloaded = await loadCatalogSiteWorkspace(workspace.target.catalogEntry, nextMast)
        setWorkspace(reloaded)
        setLoadingTarget(false)
      }
    },
    [observerHeightM, workspace],
  )

  // Handle clicks anywhere on the 3D Moon or inside the real 129x129 DEM patch
  const handlePickPoint = useCallback(
    (pick: SurfacePickEvent) => {
      if (pick.matchedCatalogSite && workspace?.target.id === pick.matchedCatalogSite.id && workspace.demTerrain) {
        // User clicked inside the currently active 129x129 real DEM mesh: update local sampled elev & slope!
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

      setFocusCoords({ latitude_deg: pick.latitude_deg, longitude_deg: pick.longitude_deg })
      setSearchQuery(formatLatLonCompact(pick.latitude_deg, pick.longitude_deg))
      setActiveTab('telemetry')
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

  // Keyboard Escape dismisses dropdown or HUD card; outside click closes dropdown
  useEffect(() => {
    const onPointerDown = (e: MouseEvent) => {
      if (searchWrapperRef.current && !searchWrapperRef.current.contains(e.target as Node)) {
        setDropdownOpen(false)
      }
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (polarOpen) {
          setPolarOpen(false)
          return
        }
        if (dropdownOpen) {
          setDropdownOpen(false)
          searchInputRef.current?.blur()
          return
        }
        if (document.activeElement !== searchInputRef.current) {
          clearSelection()
        }
      }
    }
    document.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [clearSelection, dropdownOpen, polarOpen])

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
          label: 'SYNTHETIC EXPLORER',
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

  return (
    <div className="relative w-full h-full overflow-hidden bg-[#050507] text-slate-100 select-none">
      {/* Dual-State 3D WebGL Moon Globe <-> Verified NASA LOLA 129x129 DEM Surface */}
      <LunarStage3D
        catalogSites={CATALOG_SITES}
        selectedSiteId={workspace?.target.catalogEntry?.id ?? null}
        focusCoordinates={focusCoords}
        hasSelection={Boolean(workspace)}
        desiredCameraMode={desiredCameraMode}
        cameraPresetNonce={cameraPresetNonce}
        demTerrain={workspace?.demTerrain ?? null}
        currentSample={currentSample}
        recommendations={workspace?.recommendations ?? null}
        highlightedCandidateId={highlightedCandidateId}
        overlayMode={overlayMode}
        showWireframe={showWireframe}
        verticalScale={verticalScale}
        onCameraModeChange={setCameraMode}
        onPickPoint={handlePickPoint}
        onSelectCatalogSite={site => void selectCatalogSite(site, true)}
      />

      {/* Top Minimal Floating Search Pill */}
      <div
        ref={searchWrapperRef}
        className="fixed top-4 sm:top-6 left-1/2 -translate-x-1/2 z-30 w-[94vw] max-w-[520px]"
      >
        <div className="glass-hud rounded-full px-3.5 sm:px-4 py-2 flex items-center gap-2 shadow-[0_12px_40px_rgba(0,0,0,0.65)] transition-colors focus-within:border-white/25">
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
            placeholder="Site or coords (e.g. Connecting Ridge, 89.46°S 137.5°W)"
            className="w-full bg-transparent text-xs font-mono-tech text-slate-100 placeholder-slate-500 focus:outline-none tracking-wide"
            aria-label="Search lunar site or coordinates"
          />

          {(searchQuery || workspace) && (
            <button
              type="button"
              onClick={clearSelection}
              className="text-slate-400 hover:text-white transition p-1 rounded-full hover:bg-white/10"
              aria-label="Clear target selection"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}

          {/* Orbital <-> Surface 3D Mode Toggle */}
          <button
            type="button"
            title="Toggle Orbital Globe / High-Res DEM Surface View"
            onClick={() => {
              const nextMode = cameraMode === 'ORBITAL' ? 'SURFACE' : 'ORBITAL'
              if (!workspace && nextMode === 'SURFACE') {
                void selectCatalogSite(CATALOG_SITES[0], true)
                return
              }
              setDesiredCameraMode(nextMode)
              setCameraPresetNonce(n => n + 1)
            }}
            className={`shrink-0 px-2.5 py-1 rounded-full text-[9px] font-mono-tech tracking-[0.15em] uppercase border transition ${
              cameraMode === 'SURFACE'
                ? 'border-emerald-400/45 bg-emerald-400/15 text-emerald-300'
                : 'border-white/10 bg-white/[0.04] text-slate-300 hover:text-white hover:border-white/25'
            }`}
          >
            {cameraMode === 'SURFACE' ? 'SURFACE 3D' : 'ORBITAL'}
          </button>

          {/* 2D Polar South Pole Explorer Toggle */}
          <button
            type="button"
            title="Toggle 2D South Pole Projection Map"
            onClick={() => setPolarOpen(o => !o)}
            aria-pressed={polarOpen}
            className={`shrink-0 px-2.5 py-1 rounded-full text-[9px] font-mono-tech tracking-[0.14em] uppercase border transition flex items-center gap-1 ${
              polarOpen
                ? 'border-cyan-400/45 bg-cyan-400/15 text-cyan-200'
                : 'border-white/10 bg-white/[0.04] text-slate-300 hover:text-white hover:border-white/25'
            }`}
          >
            <Compass className="w-3 h-3" />
            <span className="hidden sm:inline">2D</span>
          </button>
        </div>

        {/* Autocomplete Dropdown */}
        {dropdownOpen && (
          <div className="mt-2 glass-hud rounded-2xl overflow-hidden shadow-[0_18px_48px_rgba(0,0,0,0.82)] divide-y divide-white/[0.06] max-h-[60vh] overflow-y-auto hud-scroll">
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

      {/* Whisper Hint on Launch Before Selection */}
      {!workspace && !polarOpen && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-10 pointer-events-none text-center px-4">
          <div className="glass-hud rounded-full px-4 py-1.5 text-[10px] font-mono-tech tracking-[0.16em] uppercase text-slate-400">
            Click a glowing South Pole beacon or search Connecting Ridge · Scroll to inspect 129×129 DEM relief
          </div>
        </div>
      )}

      {/* Optional 2D South Pole Map Modal (Member C PolarMap integrated cleanly on demand) */}
      {polarOpen && (
        <div className="fixed top-20 right-4 sm:right-6 z-25 w-[92vw] sm:w-[370px] max-h-[75vh] overflow-y-auto hud-scroll glass-hud rounded-2xl p-4 shadow-[0_20px_60px_rgba(0,0,0,0.8)]">
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
            siteId={workspace?.target.catalogEntry?.polarId ?? 'connecting-ridge'}
            onSiteChange={polarId => {
              const matched = CATALOG_SITES.find(s => s.polarId === polarId)
              if (matched) void selectCatalogSite(matched, true)
            }}
            nearby={workspace?.recommendations ?? undefined}
          />
        </div>
      )}

      {/* On-Demand Bottom Glass HUD Card (Hidden until a target or location is selected) */}
      <main
        aria-hidden={!workspace}
        className={`fixed bottom-3 left-3 right-3 sm:bottom-5 sm:left-1/2 sm:-translate-x-1/2 sm:w-[820px] max-w-[96vw] z-20 glass-hud rounded-2xl p-3.5 sm:p-4.5 shadow-[0_24px_64px_rgba(0,0,0,0.82)] transition-all duration-300 ease-out ${
          workspace
            ? 'opacity-100 translate-y-0 pointer-events-auto'
            : 'opacity-0 translate-y-6 pointer-events-none'
        }`}
      >
        {workspace && (
          <>
            {/* Card Header: Site Identity, Provenance, Tabs, Mast Toggle & Exports */}
            <div className="flex flex-wrap items-center justify-between gap-2 pb-2.5 mb-3 border-b border-white/[0.08]">
              <div className="flex items-center gap-2 min-w-0">
                <span
                  className={`w-2 h-2 rounded-full shrink-0 ${
                    earthIn
                      ? 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)]'
                      : 'bg-rose-400 shadow-[0_0_8px_rgba(251,113,133,0.8)]'
                  }`}
                />
                <h1 className="text-[11px] font-mono-tech font-medium tracking-[0.15em] text-slate-100 uppercase truncate">
                  {workspace.target.name}
                </h1>
                <span className="text-slate-600 font-mono-tech text-[10px] hidden sm:inline">·</span>
                <span className="text-[10px] font-mono-tech text-slate-400 tabular-nums shrink-0">
                  {formatLatLonCompact(workspace.target.latitude_deg, workspace.target.longitude_deg)}
                </span>
                <button
                  type="button"
                  onClick={() => setShowProvenanceInfo(p => !p)}
                  title="Inspect data provenance & DEM source verification"
                  className={`hidden md:inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-mono-tech tracking-wider uppercase border transition ${badgeStyle.cls}`}
                >
                  <Info className="w-2.5 h-2.5" />
                  {badgeStyle.label}
                </button>
              </div>

              <div className="flex items-center gap-1.5 shrink-0">
                {/* Compact HUD Section Tabs */}
                <div className="flex items-center rounded-full border border-white/10 bg-white/[0.03] p-0.5">
                  {(
                    [
                      { id: 'telemetry', label: 'TELEMETRY' },
                      { id: 'diff', label: '+48H DIFF' },
                      { id: 'havens', label: 'HAVENS' },
                    ] as const
                  ).map(tab => (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => setActiveTab(tab.id)}
                      className={`px-2.5 py-0.5 rounded-full text-[9px] font-mono-tech tracking-[0.14em] uppercase transition ${
                        activeTab === tab.id
                          ? 'bg-white/15 text-white'
                          : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>

                {/* CSV & JSON Export */}
                <button
                  type="button"
                  onClick={() => void exportAnalysisReport(workspace.analysis, 'csv')}
                  title="Export 14-day mission visibility timeline as CSV"
                  className="px-2 py-1 rounded-full text-[9px] font-mono-tech tracking-wider uppercase border border-white/10 bg-white/[0.03] text-slate-300 hover:text-white hover:border-white/25 transition inline-flex items-center gap-1"
                >
                  <Download className="w-2.5 h-2.5" />
                  CSV
                </button>
                <button
                  type="button"
                  onClick={() => void exportAnalysisReport(workspace.analysis, 'json')}
                  title="Export contract analysis JSON"
                  className="px-2 py-1 rounded-full text-[9px] font-mono-tech tracking-wider uppercase border border-white/10 bg-white/[0.03] text-slate-300 hover:text-white hover:border-white/25 transition hidden sm:inline-flex items-center gap-1"
                >
                  JSON
                </button>

                <button
                  type="button"
                  onClick={clearSelection}
                  className="p-1 rounded-full text-slate-400 hover:text-white hover:bg-white/10 transition"
                  aria-label="Close telemetry panel"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            {/* Expandable Provenance Inspection Strip */}
            {showProvenanceInfo && (
              <div className="mb-3 rounded-xl border border-white/[0.08] bg-black/40 px-3 py-2 text-[10px] font-mono-tech text-slate-300 space-y-1">
                <div className="flex flex-wrap items-center justify-between gap-2 text-slate-200">
                  <span>{workspace.sourceNote}</span>
                  <span className="text-slate-500">
                    FRAME: {workspace.analysis.coordinates.frame} · {workspace.analysis.analysis_id}
                  </span>
                </div>
                {workspace.demTerrain && (
                  <div className="text-slate-400">
                    DEM: 129×129 @ {workspace.demTerrain.metadata.spacing_m}m · SHA256{' '}
                    {workspace.demTerrain.metadata.sha256.slice(0, 12)}… · Missing cells preserved:{' '}
                    {workspace.demTerrain.missingVertices}
                  </div>
                )}
                <div className="text-slate-500 truncate">
                  {workspace.analysis.provenance.assumptions[0] ?? 'Real LOLA DEM & geometry provenance attached.'}
                </div>
              </div>
            )}

            {/* Main HUD Content by Active Tab */}
            {activeTab === 'telemetry' && (
              <div className="grid grid-cols-1 sm:grid-cols-12 gap-3.5 items-center">
                {/* Left 5 Columns: Real-Time Visibility + Terrain Safety Strip */}
                <div className="sm:col-span-5 flex flex-col gap-2 border-b sm:border-b-0 sm:border-r border-white/10 pb-3 sm:pb-0 sm:pr-4">
                  {/* Earth Direct-to-Earth Pill */}
                  <div className="flex items-center justify-between bg-white/[0.03] rounded-xl px-3 py-1.5 border border-white/[0.06]">
                    <div className="flex items-center gap-2">
                      <span
                        className={`w-2 h-2 rounded-full ${
                          earthIn
                            ? 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.75)]'
                            : 'bg-rose-400 shadow-[0_0_8px_rgba(251,113,133,0.75)]'
                        }`}
                      />
                      <span className="text-[10px] font-mono-tech tracking-[0.14em] text-slate-400 uppercase">
                        Earth DTE
                      </span>
                    </div>
                    <div
                      className={`text-[11px] font-mono-tech font-medium tracking-wider uppercase tabular-nums ${
                        earthIn ? 'text-emerald-400' : 'text-rose-400'
                      }`}
                    >
                      {earthIn ? 'In Range' : 'Obstructed'}{' '}
                      {earthMarginDeg !== null && `(${earthMarginDeg >= 0 ? '+' : ''}${earthMarginDeg.toFixed(1)}°)`}
                    </div>
                  </div>

                  {/* Solar Illumination Pill */}
                  <div className="flex items-center justify-between bg-white/[0.03] rounded-xl px-3 py-1.5 border border-white/[0.06]">
                    <div className="flex items-center gap-2">
                      <span
                        className={`w-2 h-2 rounded-full ${
                          sunIn
                            ? 'bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.75)]'
                            : 'bg-slate-500'
                        }`}
                      />
                      <span className="text-[10px] font-mono-tech tracking-[0.14em] text-slate-400 uppercase">
                        Solar Disc
                      </span>
                    </div>
                    <div
                      className={`text-[11px] font-mono-tech font-medium tracking-wider uppercase tabular-nums ${
                        sunIn ? 'text-amber-300' : 'text-slate-400'
                      }`}
                    >
                      {currentSample?.sun.illumination_fraction !== null &&
                      currentSample?.sun.illumination_fraction !== undefined
                        ? `${Math.round(currentSample.sun.illumination_fraction * 100)}% Lit · ${
                            currentSample.sun.elevation_deg >= 0 ? '+' : ''
                          }${currentSample.sun.elevation_deg.toFixed(1)}°`
                        : 'Unknown'}
                    </div>
                  </div>

                  {/* Elevation, Local DEM Slope & Max Horizon Obstruction */}
                  <div className="grid grid-cols-3 gap-2 pt-0.5">
                    <div>
                      <div className="text-[9px] font-mono-tech tracking-[0.14em] text-slate-500 uppercase">Elev</div>
                      <div className="text-[11px] font-mono-tech text-slate-200 tabular-nums mt-0.5">
                        {workspace.target.elevation_m >= 0 ? '+' : ''}
                        {Math.round(workspace.target.elevation_m).toLocaleString()} m
                      </div>
                    </div>
                    <div>
                      <div className="text-[9px] font-mono-tech tracking-[0.14em] text-slate-500 uppercase">Slope</div>
                      <div className={`text-[11px] font-mono-tech tabular-nums mt-0.5 ${slopeColorCls}`}>
                        {workspace.effectiveSlopeDeg !== null
                          ? `${workspace.effectiveSlopeDeg.toFixed(1)}° ${workspace.effectiveSlopeBand}`
                          : 'N/A'}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-[9px] font-mono-tech tracking-[0.14em] text-slate-500 uppercase">Max Rim</div>
                      <div className="text-[11px] font-mono-tech text-slate-200 tabular-nums mt-0.5">
                        {peakObstruction
                          ? `${peakObstruction.el.toFixed(1)}° @ ${String(Math.round(peakObstruction.az)).padStart(3, '0')}°`
                          : 'N/A'}
                      </div>
                    </div>
                  </div>

                  {/* 14-Day Aggregate Telemetry Strip */}
                  <div className="flex items-center justify-between text-[9px] font-mono-tech text-slate-400 pt-1 border-t border-white/[0.06] tabular-nums">
                    <span>
                      SUN{' '}
                      {workspace.analysis.metrics.sunlight_fraction !== null
                        ? `${(workspace.analysis.metrics.sunlight_fraction * 100).toFixed(1)}%`
                        : '—'}
                    </span>
                    <span>
                      DARK{' '}
                      {workspace.analysis.metrics.max_darkness_hours !== null
                        ? `${workspace.analysis.metrics.max_darkness_hours.toFixed(0)}h`
                        : '—'}
                    </span>
                    <span>
                      DTE{' '}
                      {workspace.analysis.metrics.earth_visible_fraction !== null
                        ? `${(workspace.analysis.metrics.earth_visible_fraction * 100).toFixed(1)}%`
                        : '—'}
                    </span>
                    <span>
                      BOTH{' '}
                      {workspace.analysis.metrics.both_visible_hours !== null
                        ? `${workspace.analysis.metrics.both_visible_hours.toFixed(0)}h`
                        : '—'}
                    </span>
                  </div>
                </div>

                {/* Right 7 Columns: 360° Horizon Profile + Subtle 3D Surface Controls */}
                <div className="sm:col-span-7 flex flex-col">
                  <div className="flex flex-wrap items-center justify-between gap-2 mb-1.5">
                    <span className="text-[9px] font-mono-tech tracking-[0.16em] text-slate-500 uppercase">
                      360° Horizon
                    </span>

                    <div className="flex items-center gap-2">
                      {/* 3D Terrain Overlay Controls when zoomed or viewing DEM */}
                      {workspace.demTerrain && (
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => setOverlayMode(m => (m === 'albedo' ? 'slope' : 'albedo'))}
                            title="Toggle Slope Safety Heatmap (<8° Safe / 8–15° Caution / >15° Hazard)"
                            className={`px-1.5 py-0.5 rounded text-[9px] font-mono-tech uppercase border transition inline-flex items-center gap-1 ${
                              overlayMode === 'slope'
                                ? 'border-emerald-400/45 bg-emerald-400/15 text-emerald-300'
                                : 'border-white/10 text-slate-400 hover:text-slate-200'
                            }`}
                          >
                            <Layers className="w-2.5 h-2.5" />
                            {overlayMode === 'slope' ? 'SLOPE' : 'RELIEF'}
                          </button>
                          <button
                            type="button"
                            onClick={() => setShowWireframe(w => !w)}
                            className={`px-1.5 py-0.5 rounded text-[9px] font-mono-tech uppercase border transition ${
                              showWireframe
                                ? 'border-cyan-400/45 bg-cyan-400/15 text-cyan-200'
                                : 'border-white/10 text-slate-400 hover:text-slate-200'
                            }`}
                          >
                            WIRE
                          </button>
                          <button
                            type="button"
                            onClick={() => setVerticalScale(v => (v === 1 ? (2 as 1 | 2) : (1 as 1 | 2)))}
                            className="px-1.5 py-0.5 rounded text-[9px] font-mono-tech uppercase border border-white/10 text-slate-400 hover:text-slate-200 transition"
                            title="Toggle DEM Vertical Exaggeration"
                          >
                            {verticalScale}×Z
                          </button>
                        </div>
                      )}

                      <span className="text-[10px] font-mono-tech text-slate-400 tabular-nums">
                        {horizonHoverText ??
                          (currentSample
                            ? `EARTH ${String(Math.round(currentSample.earth.azimuth_deg)).padStart(3, '0')}° · ${
                                currentSample.earth.elevation_deg >= 0 ? '+' : ''
                              }${currentSample.earth.elevation_deg.toFixed(1)}°`
                            : 'HOVER PROFILE')}
                      </span>
                    </div>
                  </div>

                  <div className="relative w-full h-[94px] sm:h-[106px] rounded-xl bg-black/45 border border-white/[0.06] overflow-hidden">
                    <HorizonProfileCanvas
                      horizon={workspace.analysis.horizon}
                      currentSample={currentSample}
                      highlightAzimuthDeg={diffHighlightAzimuth}
                      onHoverChange={setHorizonHoverText}
                    />
                  </div>
                </div>
              </div>
            )}

            {/* Tab 2: LunaDiff +48h Launch Delay Analysis */}
            {activeTab === 'diff' && (
              <div className="space-y-2.5">
                {workspace.diff48h ? (
                  <>
                    <div className="grid grid-cols-3 gap-2">
                      <div className="bg-white/[0.03] rounded-xl px-3 py-2 border border-white/[0.06]">
                        <div className="text-[9px] font-mono-tech text-slate-500 uppercase tracking-wider">
                          Δ Sunlight (+48h)
                        </div>
                        <div
                          className={`text-sm font-mono-tech tabular-nums mt-0.5 ${
                            (workspace.diff48h.deltas.sunlight_hours ?? 0) >= 0
                              ? 'text-emerald-400'
                              : 'text-rose-400'
                          }`}
                        >
                          {workspace.diff48h.deltas.sunlight_hours !== null
                            ? `${workspace.diff48h.deltas.sunlight_hours >= 0 ? '+' : ''}${workspace.diff48h.deltas.sunlight_hours.toFixed(1)} h`
                            : 'N/A'}
                        </div>
                      </div>
                      <div className="bg-white/[0.03] rounded-xl px-3 py-2 border border-white/[0.06]">
                        <div className="text-[9px] font-mono-tech text-slate-500 uppercase tracking-wider">
                          Δ Max Darkness
                        </div>
                        <div className="text-sm font-mono-tech text-slate-200 tabular-nums mt-0.5">
                          {workspace.diff48h.deltas.max_darkness_hours !== null
                            ? `${workspace.diff48h.deltas.max_darkness_hours >= 0 ? '+' : ''}${workspace.diff48h.deltas.max_darkness_hours.toFixed(1)} h`
                            : 'N/A'}
                        </div>
                      </div>
                      <div className="bg-white/[0.03] rounded-xl px-3 py-2 border border-white/[0.06]">
                        <div className="text-[9px] font-mono-tech text-slate-500 uppercase tracking-wider">
                          Δ Earth DTE
                        </div>
                        <div
                          className={`text-sm font-mono-tech tabular-nums mt-0.5 ${
                            (workspace.diff48h.deltas.earth_visible_hours ?? 0) >= 0
                              ? 'text-emerald-400'
                              : 'text-rose-400'
                          }`}
                        >
                          {workspace.diff48h.deltas.earth_visible_hours !== null
                            ? `${workspace.diff48h.deltas.earth_visible_hours >= 0 ? '+' : ''}${workspace.diff48h.deltas.earth_visible_hours.toFixed(1)} h`
                            : 'N/A'}
                        </div>
                      </div>
                    </div>

                    <div className="max-h-[92px] overflow-y-auto hud-scroll space-y-1.5 pr-1">
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
                              setActiveTab('telemetry')
                            }}
                            className="w-full text-left px-3 py-1.5 rounded-xl bg-white/[0.03] hover:bg-white/[0.07] border border-white/[0.06] transition flex items-start justify-between gap-2"
                          >
                            <div className="min-w-0">
                              <span
                                className={`text-[9px] font-mono-tech tracking-wider uppercase ${
                                  gained ? 'text-emerald-400' : 'text-rose-400'
                                }`}
                              >
                                {iv.type.replaceAll('_', ' ')} · +{iv.start_met_hours}h→+{iv.end_met_hours}h
                              </span>
                              <p className="text-[10px] text-slate-400 truncate mt-0.5">{iv.reason}</p>
                            </div>
                            <span className="text-[9px] font-mono-tech text-cyan-300 shrink-0 uppercase">
                              Inspect →
                            </span>
                          </button>
                        )
                      })}
                    </div>
                  </>
                ) : (
                  <div className="rounded-xl border border-white/[0.08] bg-black/30 px-4 py-4 text-[11px] font-mono-tech text-slate-400">
                    Verified +48h LunaDiff schedule comparison is currently populated for Connecting Ridge (Site 01) where 16-day JPL Horizons ephemerides exist. Select Connecting Ridge to inspect causal terrain windows.
                  </div>
                )}
              </div>
            )}

            {/* Tab 3: Safe Haven Recommender */}
            {activeTab === 'havens' && (
              <div className="space-y-2">
                {workspace.recommendations?.candidates.length ? (
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
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
                              setDesiredCameraMode('SURFACE')
                              setCameraPresetNonce(n => n + 1)
                            }
                          }}
                          className={`text-left rounded-xl p-2.5 border transition ${
                            active
                              ? 'border-amber-400/50 bg-amber-400/10'
                              : 'border-white/[0.08] bg-white/[0.03] hover:bg-white/[0.06]'
                          }`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-[10px] font-mono-tech text-slate-100 uppercase tracking-wider truncate flex items-center gap-1">
                              <Sparkles className="w-3 h-3 text-emerald-400 shrink-0" />
                              {cand.site_id.replace(/^site\d+_[a-z_]+_/, '').replaceAll('_', ' ')}
                            </span>
                            <span className="text-[9px] font-mono-tech text-emerald-400 shrink-0">
                              {cand.slope_deg.toFixed(2)}° {band}
                            </span>
                          </div>
                          <div className="text-[10px] font-mono-tech text-slate-400 mt-1 tabular-nums">
                            {cand.distance_m.toFixed(0)}m @ {cand.bearing_deg.toFixed(0)}° · +{Math.round(cand.coordinates.elevation_m)}m
                          </div>
                          {cand.sunlight_fraction_delta !== null && (
                            <div className="text-[9px] font-mono-tech text-cyan-300 mt-0.5 tabular-nums">
                              Sun Δ +{(cand.sunlight_fraction_delta * 100).toFixed(0)}% vs crater wall
                            </div>
                          )}
                        </button>
                      )
                    })}
                  </div>
                ) : (
                  <div className="rounded-xl border border-white/[0.08] bg-black/30 px-4 py-4 text-[11px] font-mono-tech text-slate-400">
                    No DEM proximity safe-haven candidates are populated for arbitrary coordinate targets. Select one of the 4 NASA LOLA catalog sites.
                  </div>
                )}
              </div>
            )}

            {/* Synchronized Bottom Mission Timeline Scrubber & Mast Selector */}
            {samples.length > 0 && currentSample && (
              <div className="mt-3 pt-2.5 border-t border-white/[0.08] flex flex-wrap items-center gap-2.5">
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
                  className="px-2.5 py-1 rounded-full border border-white/15 bg-white/[0.05] hover:bg-white/10 text-[10px] font-mono-tech text-slate-100 inline-flex items-center gap-1 transition shrink-0"
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
                  className="hud-range flex-1 min-w-[120px]"
                />

                <span className="text-[10px] font-mono-tech text-slate-300 tabular-nums shrink-0">
                  +{currentSample.met_hours.toFixed(1)}h · {currentSample.utc.replace('T', ' ').replace('Z', '').slice(0, 16)} UTC
                </span>

                {/* Mast Height Selector (2m Lander vs 5m Mast) */}
                <div className="flex items-center gap-1 shrink-0" title="Observer mast height">
                  <span className="text-[9px] font-mono-tech text-slate-500 uppercase">Mast</span>
                  {([2, 5] as const).map(h => (
                    <button
                      key={h}
                      type="button"
                      onClick={() => void handleMastToggle(h)}
                      disabled={loadingTarget}
                      className={`px-1.5 py-0.5 rounded text-[9px] font-mono-tech border transition ${
                        observerHeightM === h
                          ? 'border-emerald-400/45 bg-emerald-400/15 text-emerald-300'
                          : 'border-white/10 text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      {h}m
                    </button>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </main>
    </div>
  )
}

export default App
