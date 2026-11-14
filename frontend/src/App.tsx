import { useEffect, useState } from 'react'
import { Orbit } from 'lucide-react'
import { api } from './api/client'
import type { DashboardPreview, MissionSetup } from './api/types'
import { TimelineScrubber } from './components/TimelineScrubber'
import { MissionSetupPanel } from './features/mission-planner/MissionSetupPanel'
import { LunarViewport, type TerrainSource } from './features/map/LunarViewport'
import analysis from '../../data/fixtures/mock_analysis.json'
import { TelemetryPanel } from './features/analysis/TelemetryPanel'

export default function App() {
  const [data, setData] = useState<DashboardPreview | null>(null)
  const [setup, setSetup] = useState<MissionSetup | null>(null)
  const [error, setError] = useState(false)
  const [terrainSource, setTerrainSource] = useState<TerrainSource>('b-grid')
  const [sampleIndex, setSampleIndex] = useState(0)
  const sample = analysis.samples[sampleIndex]
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
      {error ? <div className="panel" role="alert">The preview could not load. Refresh to try again.</div> : !data || !setup ? <div className="panel" role="status">Loading mission preview…</div> : <div className="dashboard-grid"><MissionSetupPanel sites={data.sites} value={setup} onChange={setSetup} /><LunarViewport siteId={setup.siteId} siteName={data.sites.find(site => site.id === setup.siteId)?.name ?? 'Select a site'} source={terrainSource} onSourceChange={setTerrainSource} sun={sample.sun} earth={sample.earth} observerHeightM={setup.observerHeightM} /><TelemetryPanel metrics={data.metrics} /><TimelineScrubber samples={analysis.samples} sampleIndex={sampleIndex} onChange={setSampleIndex} enabled={terrainSource === 'synthetic'} /></div>}
    </main><footer className="app-footer"><span>HORIZON OPS / NASA SPACE APPS 2026</span><span>Foundation preview · Science integration pending</span></footer>
  </div>
}
