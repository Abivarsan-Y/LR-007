import { Clock3 } from 'lucide-react'
type Props = {
  samples: { utc: string; met_hours: number }[]
  sampleIndex: number
  onChange: (index: number) => void
  enabled: boolean
}
export function TimelineScrubber({ samples, sampleIndex, onChange, enabled }: Props) {
  const sample = samples[sampleIndex]
  return <section className="panel timeline" aria-labelledby="timeline-title"><div className="timeline-heading"><div className="panel-heading"><Clock3 size={17}/><h2 id="timeline-title">Fixture timeline</h2><span className="badge">SYNTHETIC</span></div><span className="timestamp">{sample.utc} · MET +{sample.met_hours} h</span></div><label className="sr-only" htmlFor="timeline">Synthetic mission time sample</label><input id="timeline" type="range" min={0} max={samples.length - 1} step={1} value={sampleIndex} onChange={e => onChange(Number(e.target.value))} disabled={!enabled} aria-describedby="timeline-help"/><div className="timeline-labels"><span>MET +0 h</span><span>{samples.length} discrete test samples</span><span>+{samples.at(-1)?.met_hours} h</span></div><p className="footnote" id="timeline-help">{enabled ? 'Updates synthetic Sun/Earth directions only. Mission date/site edits do not recalculate these fixture values.' : 'Choose “Synthetic direction demo” in the terrain input to enable scrubbing. Site terrain is shown without celestial overlays.'}</p></section>
}
