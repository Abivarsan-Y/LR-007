import { useEffect, useMemo, useState } from 'react'
import { Orbit } from 'lucide-react'
import { api } from './api/client'
import type { DashboardPreview, MissionSetup } from './api/types'
import { TimelineScrubber } from './components/TimelineScrubber'
import { MissionSetupPanel } from './features/mission-planner/MissionSetupPanel'
import { LunarViewport, type TerrainSource } from './features/map/LunarViewport'
import { compareSamples, createSamples, createSkyline } from './features/analysis/missionPreview'
import { LunaDiffPanel } from './features/lunadiff/LunaDiffPanel'

const skyA = createSkyline(), skyB = skyA
import { TelemetryPanel } from './features/analysis/TelemetryPanel'

export default function App() {
  const [data, setData] = useState<DashboardPreview | null>(null)
  const [setup, setSetup] = useState<MissionSetup | null>(null)
  const [error, setError] = useState(false)
  const [terrainSource, setTerrainSource] = useState<TerrainSource>('b-grid')
  const [sampleIndex, setSampleIndex] = useState(0)
  const [playing, setPlaying] = useState(false)
  const parsedStart = Date.parse(`${setup?.startDateUtc || '2026-11-14'}T00:00:00Z`)
  const start = Number.isFinite(parsedStart) ? parsedStart : Date.UTC(2026, 10, 14)
  const days = setup?.durationDays ?? 7
  const delay = setup?.delayHours ?? 48
  const a = useMemo(() => createSamples(start, days, 0, skyA), [start, days])
  const b = useMemo(() => createSamples(start, days, delay, skyB), [start, days, delay])
  const windows = useMemo(() => compareSamples(a, b), [a, b])
  const index = Math.min(sampleIndex, a.length - 1)
  const sample = a[index]
  useEffect(() => {
    let active = true
    api.getDashboardPreview().then(preview => {
      if (active) { setData(preview); setSetup(preview.defaults) }
    }).catch(() => { if (active) setError(true) })
    return () => { active = false }
  }, [])

  return <div className="app-shell"><a className="skip-link" href="#mission">Skip to mission planner</a>
    <header className="app-header"><div className="brand"><Orbit size={30} /><div>HORIZON <span>OPS</span><small>LUNAR MISSION NAVIGATOR</small></div></div><div className="header-meta"><span className="status-dot" /> SCENE INTEGRATION / PREVIEW</div></header>
    <main id="mission"><div className="page-heading"><div><span className="eyebrow">MISSION CONTROL</span><h1>Plan beyond the horizon.</h1><p>Explore the lunar south pole. Find your window.</p></div><span className="badge synthetic">TERRAIN PREVIEW · SYNTHETIC TELEMETRY</span></div>
      {error ? <div className="panel" role="alert">The preview could not load. Refresh to try again.</div> : !data || !setup ? <div className="panel" role="status">Loading mission preview…</div> : <div className="dashboard-grid"><MissionSetupPanel sites={data.sites} value={setup} onChange={next => { setSetup(next); if (next.startDateUtc !== setup.startDateUtc || next.durationDays !== setup.durationDays) { setSampleIndex(0); setPlaying(false) } }} /><LunarViewport onSiteChange={siteId => setSetup(current => current ? { ...current, siteId } : current)} siteId={setup.siteId} siteName={data.sites.find(site => site.id === setup.siteId)?.name ?? 'Select a site'} source={terrainSource} onSourceChange={setTerrainSource} sun={sample.sun} earth={sample.earth} observerHeightM={setup.observerHeightM} /><TelemetryPanel samples={a} current={sample} />
        <TimelineScrubber key={`${start}:${days}`} samples={a} sampleIndex={index} onChange={setSampleIndex} playing={playing} onPlayingChange={setPlaying} />
        <LunaDiffPanel a={a} b={b} windows={windows} sampleIndex={index} onSeek={value => { setPlaying(false); setSampleIndex(value) }} skyA={skyA} skyB={skyB} /></div>}
    </main><footer className="app-footer"><span>HORIZON OPS / NASA SPACE APPS 2026</span><span>Foundation preview · Science integration pending</span></footer>
  </div>
}
