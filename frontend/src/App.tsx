import {
  Component,
  type ReactNode,
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react'
import {
  ArrowDownToLine,
  ArrowUpRight,
  Compass,
  Pause,
  Play,
  X,
} from 'lucide-react'
import {
  CATALOG_SITES,
  exportAnalysisReport,
  formatLatLonCompact,
  loadCatalogSiteWorkspace,
} from './api/client'
import type {
  CatalogSiteEntry,
  LoadedSiteWorkspace,
  ContractAnalysisDocument,
} from './api/types'
import { HorizonProfileCanvas } from './features/analysis/HorizonProfileCanvas'
import type { SurfacePickEvent } from './features/map/LunarStage3D'
const LunarStage3D = lazy(() =>
  import('./features/map/LunarStage3D').then((module) => ({
    default: module.LunarStage3D,
  })),
)

class ViewBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  render() {
    return this.state.failed ? (
      <div className="submission-render-fallback" role="status">
        3D is unavailable on this device. The recorded observation, horizon,
        comparison and exports remain available.
      </div>
    ) : (
      this.props.children
    )
  }
}

const number = (n: number | null | undefined, unit = '', digits = 1) =>
  n == null ? 'Unknown' : `${n.toFixed(digits)}${unit}`
const visibility = (v: boolean | null | undefined) =>
  v == null ? 'Unknown' : v ? 'Visible' : 'Blocked'
const utc = (value: string) =>
  new Date(value).toLocaleString('en-GB', {
    timeZone: 'UTC',
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })

export default function App() {
  const [delayed, setDelayed] = useState<ContractAnalysisDocument | null>(null)
  const [workspace, setWorkspace] = useState<LoadedSiteWorkspace | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [sampleIndex, setSampleIndex] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [tab, setTab] = useState<'overview' | 'compare' | 'sources'>('overview')
  const [panelOpen, setPanelOpen] = useState(true)
  const [camera, setCamera] = useState<'ORBITAL' | 'SURFACE'>('ORBITAL')
  const [nonce, setNonce] = useState(0)
  const [inspection, setInspection] = useState<SurfacePickEvent | null>(null)
  const [hover, setHover] = useState<string | null>(null)
  const [candidate, setCandidate] = useState<string | null>(null)
  const [exporting, setExporting] = useState(false)
  const generation = useRef(0)
  const live = useRef(true)
  useEffect(() => {
    live.current = true
    return () => {
      live.current = false
      generation.current++
    }
  }, [])
  const selectSite = useCallback(async (site: CatalogSiteEntry) => {
    const ticket = ++generation.current
    setLoading(true)
    setError('')
    setPlaying(false)
    setInspection(null)
    setCandidate(null)
    try {
      const [next, delayedModule] = await Promise.all([
        loadCatalogSiteWorkspace(site, 2),
        import(
          '../../backend/tests/fixtures/science/site01/analysis_delay48h.json'
        ),
      ])
      if (ticket !== generation.current || !live.current) return
      setDelayed(delayedModule.default as ContractAnalysisDocument)
      setWorkspace(next)
      setSampleIndex(0)
      setTab('overview')
      setPanelOpen(true)
      setCamera('SURFACE')
      setNonce((n) => n + 1)
    } catch {
      if (ticket === generation.current && live.current)
        setError('This site could not load. Choose it again to retry.')
    } finally {
      if (ticket === generation.current && live.current) setLoading(false)
    }
  }, [])
  const analysis = workspace?.analysis
  const verified =
    workspace?.sourceMode === 'cached_real' ||
    workspace?.sourceMode === 'live_api'
  const sample = analysis?.samples[sampleIndex] ?? null
  const last = Math.max(0, (analysis?.samples.length ?? 1) - 1)
  useEffect(() => {
    if (!playing || sampleIndex >= last) {
      if (sampleIndex >= last) setPlaying(false)
      return
    }
    const timer = window.setTimeout(
      () => setSampleIndex((i) => Math.min(i + 1, last)),
      180,
    )
    return () => window.clearTimeout(timer)
  }, [playing, sampleIndex, last])
  const inspect = useCallback((pick: SurfacePickEvent) => {
    setInspection(pick)
  }, [])
  const download = async (format: 'json' | 'csv') => {
    if (!analysis) return
    setExporting(true)
    setError('')
    try {
      await exportAnalysisReport(analysis, format)
    } catch {
      setError('The report could not be exported. Please retry.')
    } finally {
      if (live.current) setExporting(false)
    }
  }
  const coordinates =
    !verified && workspace?.demTerrain
      ? workspace.demTerrain.metadata.coordinates
      : analysis?.coordinates
  const canCompare =
    verified &&
    workspace?.diff48h &&
    analysis?.analysis_id === workspace.diff48h.scenario_a_id &&
    delayed?.analysis_id === workspace.diff48h.scenario_b_id
  return (
    <div className="submission-app">
      <a className="submission-skip" href="#results">
        Skip to results
      </a>
      <div
        className="submission-stage"
        aria-label="Illustrative lunar terrain explorer"
      >
        <ViewBoundary>
          <Suspense
            fallback={
              <p className="submission-render-fallback" role="status">
                Loading lunar explorer…
              </p>
            }
          >
            <LunarStage3D
              catalogSites={CATALOG_SITES}
              selectedSiteId={workspace?.target.catalogEntry?.id ?? null}
              focusCoordinates={
                workspace
                  ? {
                      latitude_deg: workspace.target.latitude_deg,
                      longitude_deg: workspace.target.longitude_deg,
                    }
                  : null
              }
              hasSelection={!!workspace}
              desiredCameraMode={camera}
              cameraPresetNonce={nonce}
              demTerrain={workspace?.demTerrain ?? null}
              currentSample={verified ? sample : null}
              recommendations={workspace?.recommendations ?? null}
              highlightedCandidateId={candidate}
              overlayMode="albedo"
              showWireframe={false}
              verticalScale={1}
              observerHeightM={2}
              onCameraModeChange={setCamera}
              onPickPoint={inspect}
              onSelectCatalogSite={(site) => void selectSite(site)}
            />
          </Suspense>
        </ViewBoundary>
      </div>
      <header className="submission-header">
        <a
          className="submission-brand"
          href="#"
          onClick={(e) => {
            e.preventDefault()
            setCamera('ORBITAL')
            setNonce((n) => n + 1)
          }}
        >
          <Compass size={23} />
          <span>
            HORIZON OPS<small>LUNAR LANDING SITE NAVIGATOR</small>
          </span>
        </a>
        <span className="submission-event">NASA SPACE APPS · 2026</span>
      </header>
      <nav
        className="submission-navigation"
        aria-label="Site and view selection"
      >
        <label htmlFor="observation">Explore an observation</label>
        <select
          id="observation"
          value={workspace?.target.catalogEntry?.id ?? ''}
          onChange={(e) => {
            const site = CATALOG_SITES.find((s) => s.id === e.target.value)
            if (site) void selectSite(site)
          }}
        >
          <option value="" disabled>
            Choose a site
          </option>
          {CATALOG_SITES.map((s) => (
            <option key={s.id} value={s.id}>
              {s.shortName}
              {s.hasVerifiedAnalysis
                ? ' · recorded science'
                : ' · terrain inspection'}
            </option>
          ))}
        </select>
        <div className="submission-segment">
          <button
            aria-pressed={camera === 'ORBITAL'}
            onClick={() => {
              setCamera('ORBITAL')
              setNonce((n) => n + 1)
            }}
          >
            Moon
          </button>
          <button
            disabled={!workspace}
            aria-pressed={camera === 'SURFACE'}
            onClick={() => {
              setCamera('SURFACE')
              setNonce((n) => n + 1)
            }}
          >
            Surface
          </button>
        </div>
      </nav>
      {!workspace && (
        <section className="submission-welcome">
          <span className="submission-kicker">THE LUNAR SOUTH POLE</span>
          <h1>
            A place to land.
            <br />A window to stay.
          </h1>
          <p>
            Explore how terrain shapes sunlight and our view of Earth. Compare a
            recorded mission with a two-day arrival delay.
          </p>
          <button
            className="submission-primary"
            disabled={loading}
            onClick={() => void selectSite(CATALOG_SITES[0])}
          >
            {loading ? 'Loading observation…' : 'Explore the verified demo'}
            <ArrowUpRight size={18} />
          </button>
          <small>Connecting Ridge · 14 days · NASA LOLA + JPL Horizons</small>
        </section>
      )}
      {workspace && !panelOpen && (
        <button
          className="submission-reopen"
          onClick={() => setPanelOpen(true)}
        >
          Show observation results <ArrowUpRight size={16} />
        </button>
      )}
      {workspace && (
        <aside
          id="results"
          tabIndex={-1}
          className="submission-panel"
          hidden={!panelOpen}
          aria-label="Observation results"
          aria-busy={loading}
        >
          <div className="submission-panel-heading">
            <div>
              <span
                className={`submission-status ${verified ? 'recorded' : 'inspection'}`}
              >
                {verified ? 'RECORDED SCIENCE' : 'TERRAIN INSPECTION'}
              </span>
              <h1>
                {workspace.target.catalogEntry?.shortName ??
                  workspace.target.name}
              </h1>
              <p>
                {formatLatLonCompact(
                  coordinates!.latitude_deg,
                  coordinates!.longitude_deg,
                )}{' '}
                · {number(coordinates!.elevation_m, ' m')} elevation
              </p>
            </div>
            <button
              className="submission-icon"
              aria-label="Hide results panel"
              onClick={() => setPanelOpen(false)}
            >
              <X size={18} />
            </button>
          </div>
          <p className="submission-context">
            {verified
              ? 'One fixed observation, replayed from NASA data. Terrain clicks inspect a separate point; they do not move this observer.'
              : 'Inspect the terrain mesh. Matched JPL astronomy is unavailable for this site; scientific visibility results are withheld.'}
          </p>
          <div
            className="submission-tabs"
            role="group"
            aria-label="Result section"
          >
            {(['overview', 'compare', 'sources'] as const).map((t) => (
              <button
                key={t}
                aria-pressed={tab === t}
                onClick={() => setTab(t)}
              >
                {t === 'compare'
                  ? 'Arrival +48 h'
                  : t === 'sources'
                    ? 'Data & method'
                    : 'Observation'}
              </button>
            ))}
          </div>
          <div className="submission-panel-body">
            {tab === 'overview' && (
              <>
                {verified && (
                  <>
                    <div className="submission-scenario">
                      <span>15–29 NOV 2026 · UTC</span>
                      <strong>
                        14 days <span> / </span> 2 m observer
                      </strong>
                      <small>
                        Recorded scenario · other dates and heights are not
                        available in this demo.
                      </small>
                    </div>
                    <div className="submission-metrics">
                      <div>
                        <span>Sunlight equivalent</span>
                        <strong>
                          {number(
                            analysis!.metrics.sunlight_fraction === null
                              ? null
                              : analysis!.metrics.sunlight_fraction * 100,
                            '%',
                          )}
                        </strong>
                        <small>
                          {number(
                            analysis!.metrics.sunlight_hours,
                            ' full-sun hours',
                          )}
                        </small>
                      </div>
                      <div>
                        <span>Longest darkness</span>
                        <strong>
                          {number(analysis!.metrics.max_darkness_hours, ' h')}
                        </strong>
                        <small>Zero exposed solar disc</small>
                      </div>
                      <div>
                        <span>Earth visible</span>
                        <strong>
                          {number(
                            analysis!.metrics.earth_visible_fraction === null
                              ? null
                              : analysis!.metrics.earth_visible_fraction * 100,
                            '%',
                          )}
                        </strong>
                        <small>Geometric centre visibility</small>
                      </div>
                      <div>
                        <span>Longest Earth blockage</span>
                        <strong>
                          {number(
                            analysis!.metrics.max_earth_occlusion_hours,
                            ' h',
                          )}
                        </strong>
                        <small>Does not predict radio service</small>
                      </div>
                    </div>
                    <p className="submission-overlap">
                      Sunlight and Earth visible together{' '}
                      <strong>
                        {number(analysis!.metrics.both_visible_hours, ' h')}
                      </strong>
                    </p>
                    <section className="submission-horizon">
                      <h2>What blocks the horizon?</h2>
                      <p>
                        Terrain elevation by compass bearing. Dots mark the Sun
                        and Earth at the selected time.
                      </p>
                      <div className="submission-chart">
                        <HorizonProfileCanvas
                          horizon={analysis!.horizon}
                          currentSample={sample}
                          onHoverChange={setHover}
                        />
                      </div>
                      <div className="submission-chart-key">
                        <span>● Sun</span>
                        <span>● Earth</span>
                        <span>{hover ?? 'North 0° · East 90°'}</span>
                      </div>
                      <dl className="submission-directions">
                        <div>
                          <dt>Sun</dt>
                          <dd>
                            {visibility(sample?.sun.visible)} ·{' '}
                            {number(sample?.sun.elevation_deg, '°')}
                          </dd>
                        </div>
                        <div>
                          <dt>Earth</dt>
                          <dd>
                            {visibility(sample?.earth.visible)} ·{' '}
                            {number(sample?.earth.elevation_deg, '°')}
                          </dd>
                        </div>
                      </dl>
                    </section>
                  </>
                )}
                <section className="submission-section">
                  <h2>Nearby terrain candidates</h2>
                  <p>
                    Lower-slope inspection points, ranked by terrain. Their
                    sunlight and Earth visibility have not been analyzed.
                  </p>
                  {workspace.recommendations?.candidates.length ? (
                    workspace.recommendations.candidates.map((c) => (
                      <button
                        className="submission-candidate"
                        key={c.site_id}
                        aria-pressed={candidate === c.site_id}
                        onClick={() => {
                          setCandidate(
                            candidate === c.site_id ? null : c.site_id,
                          )
                          setCamera('SURFACE')
                          setNonce((n) => n + 1)
                        }}
                      >
                        <span>
                          {number(c.distance_m, ' m', 0)} away · bearing{' '}
                          {number(c.bearing_deg, '°', 0)}
                        </span>
                        <strong>{number(c.slope_deg, '° slope')}</strong>
                      </button>
                    ))
                  ) : (
                    <p>No candidate data is available for this observation.</p>
                  )}
                  <small>
                    Slope screens terrain; it does not certify a landing site.
                  </small>
                </section>
              </>
            )}
            {tab === 'compare' && (
              <section className="submission-section">
                <span className="submission-kicker">
                  SAME SITE · DIFFERENT ARRIVAL
                </span>
                <h2>What changes after two days?</h2>
                <p>
                  Compare 15–29 November with 17 November–1 December 2026. Both
                  missions last 14 days at the same 2 m observation point.
                  Changes are delayed minus nominal.
                </p>
                {canCompare ? (
                  <>
                    <div className="submission-comparison">
                      {Object.entries(workspace.diff48h!.deltas).map(
                        ([k, v]) => (
                          <div key={k}>
                            <span>
                              {k === 'sunlight_hours'
                                ? 'Sunlight-equivalent hours'
                                : k === 'max_darkness_hours'
                                  ? 'Longest darkness'
                                  : 'Earth-visible hours'}
                            </span>
                            <strong>
                              {v === null
                                ? 'Unknown'
                                : `${v > 0 ? '+' : ''}${v.toFixed(1)} h`}
                            </strong>
                          </div>
                        ),
                      )}
                    </div>
                    <h2>Changed windows</h2>
                    <p>
                      Select a window to inspect both scenarios at its start.
                    </p>
                    {workspace.diff48h!.diagnostic_intervals.map((iv, i) => (
                      <details key={i} className="submission-window">
                        <summary>
                          {iv.type.startsWith('GAINED') ? '+ Gained' : '− Lost'}{' '}
                          {iv.type.includes('SUNLIGHT')
                            ? 'sunlight'
                            : 'Earth visibility'}
                          <small>
                            Mission hour {iv.start_met_hours}–{iv.end_met_hours}
                          </small>
                        </summary>
                        <p>{iv.reason}</p>
                        <button
                          onClick={() => {
                            setSampleIndex(
                              Math.max(
                                0,
                                analysis!.samples.findIndex(
                                  (s) => s.met_hours >= iv.start_met_hours,
                                ),
                              ),
                            )
                            setPlaying(false)
                          }}
                        >
                          Inspect at interval start
                        </button>
                        <div className="submission-comparison">
                          <div>
                            <span>Nominal · {utc(sample!.utc)} UTC</span>
                            <strong>
                              {iv.type.includes('SUNLIGHT') ? 'Sun' : 'Earth'}{' '}
                              {number(
                                sample![
                                  iv.type.includes('SUNLIGHT') ? 'sun' : 'earth'
                                ].elevation_deg,
                                '°',
                              )}{' '}
                              / terrain{' '}
                              {number(
                                sample![
                                  iv.type.includes('SUNLIGHT') ? 'sun' : 'earth'
                                ].horizon_deg,
                                '°',
                              )}
                            </strong>
                          </div>
                          <div>
                            <span>
                              Delayed · {utc(delayed!.samples[sampleIndex].utc)}{' '}
                              UTC
                            </span>
                            <strong>
                              {iv.type.includes('SUNLIGHT') ? 'Sun' : 'Earth'}{' '}
                              {number(
                                delayed!.samples[sampleIndex][
                                  iv.type.includes('SUNLIGHT') ? 'sun' : 'earth'
                                ].elevation_deg,
                                '°',
                              )}{' '}
                              / terrain{' '}
                              {number(
                                delayed!.samples[sampleIndex][
                                  iv.type.includes('SUNLIGHT') ? 'sun' : 'earth'
                                ].horizon_deg,
                                '°',
                              )}
                            </strong>
                          </div>
                        </div>
                      </details>
                    ))}
                  </>
                ) : (
                  <div className="submission-empty">
                    This comparison is available only for the recorded
                    Connecting Ridge scenario.
                    <button onClick={() => void selectSite(CATALOG_SITES[0])}>
                      Open recorded observation <ArrowUpRight size={15} />
                    </button>
                  </div>
                )}
              </section>
            )}
            {tab === 'sources' && (
              <section className="submission-section">
                <h2>Traceable, sampled science</h2>
                <p>
                  {verified
                    ? 'Recorded NASA/JPL inputs; no live network query is needed for playback.'
                    : 'This view provides terrain inspection only. Preview astronomy is not presented as measured science.'}
                </p>
                <dl className="submission-facts">
                  <dt>Frame</dt>
                  <dd>{analysis!.coordinates.frame}</dd>
                  <dt>Reference sphere</dt>
                  <dd>1,737,400 m</dd>
                  <dt>Time sampling</dt>
                  <dd>30 minutes · transitions are approximate</dd>
                  <dt>Rendering</dt>
                  <dd>
                    Illustrative light and enlarged terrain context. Use the
                    horizon and numeric results for visibility.
                  </dd>
                </dl>
                <h2>Model limits</h2>
                <p>
                  Sunlight is the exposed fraction of a uniform solar disc above
                  the sampled skyline. Earth visibility uses its centre, not a
                  ground station or guaranteed radio link. Unknown coverage
                  stays unknown.
                </p>
                <details>
                  <summary>Calculation assumptions</summary>
                  <ul>
                    {analysis!.provenance.assumptions.map((a, i) => (
                      <li key={i}>{a}</li>
                    ))}
                  </ul>
                </details>
                <h2>Source records</h2>
                {analysis!.provenance.sources.map((s) => (
                  <details key={s.sha256}>
                    <summary>{s.id.split(':sha256:')[0]}</summary>
                    <a href={s.uri} target="_blank" rel="noreferrer">
                      Open source <ArrowUpRight size={14} />
                    </a>
                    <code>SHA-256 {s.sha256}</code>
                  </details>
                ))}
                <p className="submission-id">
                  Analysis {analysis!.analysis_id}
                </p>
              </section>
            )}
          </div>
          {verified && (
            <footer className="submission-panel-footer">
              <span>
                <ArrowDownToLine size={16} /> Reproduce this observation
              </span>
              <div>
                <button
                  disabled={exporting}
                  onClick={() => void download('json')}
                >
                  JSON
                </button>
                <button
                  disabled={exporting}
                  onClick={() => void download('csv')}
                >
                  CSV
                </button>
              </div>
            </footer>
          )}
        </aside>
      )}
      {inspection && (
        <div className="submission-inspection" role="status">
          <div>
            <strong>Terrain inspection</strong>
            <p>
              {formatLatLonCompact(
                inspection.latitude_deg,
                inspection.longitude_deg,
              )}{' '}
              · {number(inspection.slope_deg, '° slope')}
            </p>
            <small>
              No mission analysis at this point. Recorded observer unchanged.
            </small>
          </div>
          <button
            className="submission-icon"
            aria-label="Dismiss terrain inspection"
            onClick={() => setInspection(null)}
          >
            <X size={16} />
          </button>
        </div>
      )}
      {verified && sample && (
        <section
          className="submission-timeline"
          aria-label="Recorded mission playback"
        >
          <button
            className="submission-icon"
            aria-label={playing ? 'Pause playback' : 'Play recorded samples'}
            onClick={() => {
              if (sampleIndex >= last) setSampleIndex(0)
              setPlaying(!playing)
            }}
          >
            {playing ? <Pause size={18} /> : <Play size={18} />}
          </button>
          <div>
            <div className="submission-time">
              <strong>{utc(sample.utc)} UTC</strong>
              <span>Mission +{number(sample.met_hours, ' h')}</span>
            </div>
            <label className="sr-only" htmlFor="mission-time">
              Recorded mission sample
            </label>
            <input
              id="mission-time"
              type="range"
              min="0"
              max={last}
              value={sampleIndex}
              onChange={(e) => {
                setSampleIndex(Number(e.target.value))
                setPlaying(false)
              }}
            />
            <div className="submission-time">
              <small>15 NOV</small>
              <small>Recorded 30-minute samples</small>
              <small>29 NOV</small>
            </div>
          </div>
        </section>
      )}
      {(loading || error) && (
        <div className="submission-notice" role={error ? 'alert' : 'status'}>
          {error || 'Loading observation…'}
        </div>
      )}
      <div className="submission-caption">
        Illustrative rendering · NASA/JPL source records in Data & method
      </div>
    </div>
  )
}
