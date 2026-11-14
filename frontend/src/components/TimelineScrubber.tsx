import { useEffect, useState } from 'react'
import { Clock3, Pause, Play } from 'lucide-react'

type Props = {
  samples: { utc: string; met_hours: number }[]
  sampleIndex: number
  onChange: (index: number) => void
  playing: boolean
  onPlayingChange: (playing: boolean) => void
}

export function TimelineScrubber({ samples, sampleIndex, onChange, playing, onPlayingChange }: Props) {
  const [speed, setSpeed] = useState(1)
  const last = samples.length - 1
  const sample = samples[sampleIndex]
  const advancing = playing && sampleIndex < last

  useEffect(() => {
    if (!advancing) return
    const timer = window.setTimeout(() => {
      onChange(sampleIndex + 1)
      if (sampleIndex + 1 === last) onPlayingChange(false)
    }, 1000 / speed)
    return () => window.clearTimeout(timer)
  }, [advancing, last, onChange, onPlayingChange, sampleIndex, speed])

  return <section className="panel timeline" aria-labelledby="timeline-title">
    <div className="timeline-heading">
      <div className="panel-heading"><Clock3 size={17} /><h2 id="timeline-title">Mission timeline</h2><span className="badge synthetic">SAMPLE DATA</span></div>
      <span className="timestamp">{sample.utc.replace('T', ' ').replace('.000Z', ' UTC')} · +{sample.met_hours} h</span>
    </div>
    <div className="timeline-tools">
      <button type="button" className="analytics-button" onClick={() => {
        if (advancing) { onPlayingChange(false); return }
        if (sampleIndex === last) onChange(0)
        onPlayingChange(true)
      }}>{advancing ? <><Pause size={15} /> Pause</> : <><Play size={15} /> Play</>}</button>
      <div className="view-toggle" role="group" aria-label="Playback speed">
        {[1, 5, 20].map(value => <button type="button" key={value} aria-pressed={speed === value}
          onClick={() => setSpeed(value)}>{value}×</button>)}
      </div>
    </div>
    <label className="sr-only" htmlFor="timeline">Elapsed mission hours</label>
    <input id="timeline" type="range" min={0} max={last} step={1} value={sampleIndex}
      onChange={e => { onPlayingChange(false); onChange(Number(e.target.value)) }} />
    <div className="timeline-labels"><span>0 h</span><span>{samples[last].met_hours} h</span></div>
    <p className="footnote">One mission hour per second at 1×. Playback updates the chart and sample indicators, and the 3D scene in synthetic mode.</p>
  </section>
}
