import { Clock3 } from 'lucide-react'

export function TimelineScrubber({ startDateUtc }: { startDateUtc: string }) {
  return <section className="panel timeline" aria-labelledby="timeline-title"><div className="timeline-heading"><div className="panel-heading"><Clock3 size={17} /><h2 id="timeline-title">Mission timeline</h2><span className="badge">PREVIEW</span></div><span className="timestamp">{startDateUtc ? `${startDateUtc} · 00:00 UTC` : 'Select a mission start date'}</span></div><label className="sr-only" htmlFor="timeline">Mission elapsed time (available in Phase 2)</label><input id="timeline" type="range" min={0} max={168} value={0} disabled /><div className="timeline-labels"><span>MET +0 h</span><span>Playback and synchronized scrubbing · Phase 2</span><span>+168 h</span></div></section>
}
