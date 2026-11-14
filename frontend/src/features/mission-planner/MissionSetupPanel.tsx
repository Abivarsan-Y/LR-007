import { Settings2 } from 'lucide-react'
import type { MissionSetup, Site } from '../../api/types'

interface Props {
  sites: Site[]
  value: MissionSetup
  onChange: (value: MissionSetup) => void
}

export function MissionSetupPanel({ sites, value, onChange }: Props) {
  return <section className="panel setup" aria-labelledby="setup-title">
    <div className="panel-heading"><Settings2 size={17} /><h2 id="setup-title">Mission setup</h2><span className="step">01</span></div>
    <p className="muted">Define your lunar arrival.</p>
    <label htmlFor="site">Landing site</label>
    <select id="site" value={value.siteId} onChange={e => onChange({ ...value, siteId: e.target.value })}>
      {sites.map(site => <option key={site.id} value={site.id}>{site.name}</option>)}
    </select>
    <label htmlFor="date">Mission start <span>UTC</span></label>
    <input id="date" type="date" required value={value.startDateUtc} onChange={e => onChange({ ...value, startDateUtc: e.target.value })} />
    <label htmlFor="height">Observer height</label>
    <select id="height" value={value.observerHeightM} onChange={e => onChange({ ...value, observerHeightM: Number(e.target.value) })}>
      <option value={2}>2 m · Lander deck</option><option value={5}>5 m · Raised mast</option>
    </select>
    <div className="note"><span className="eyebrow">PLANNING PREVIEW</span><p>Controls save your setup locally in this session. Analysis will connect in a later phase.</p></div>
    <div className="region"><span className="status-dot" /> LUNAR SOUTH POLE <small>85°S — 90°S</small></div>
  </section>
}
