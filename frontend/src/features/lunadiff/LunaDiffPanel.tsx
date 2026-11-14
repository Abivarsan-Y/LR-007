import { useState } from 'react'
import { ArrowLeftRight } from 'lucide-react'
import { HorizonChart } from '../analysis/HorizonChart'
import type { MissionSample, WindowChange } from '../analysis/missionPreview'
import { summarize } from '../analysis/missionPreview'

const label = (interval: WindowChange) =>
  `${interval.gained ? 'Gained' : 'Lost'} ${interval.body === 'sun' ? 'sunlight' : 'Earth visibility'}`
const signed = (value: number) => `${value > 0 ? '+' : ''}${value} h`

export function LunaDiffPanel({ a, b, windows, sampleIndex, onSeek, skyA, skyB }: {
  a: MissionSample[]; b: MissionSample[]; windows: WindowChange[]; sampleIndex: number
  onSeek: (index: number) => void; skyA: number[]; skyB: number[]
}) {
  const [active, setActive] = useState<WindowChange>()
  const selected = active && windows.includes(active) && active.start === sampleIndex ? active : undefined
  const [scenario, setScenario] = useState<'A' | 'B'>('B')
  const chartScenario = selected ? (selected.gained ? 'A' : 'B') : scenario
  const summaryA = summarize(a), summaryB = summarize(b)
  const current = (chartScenario === 'A' ? a : b)[sampleIndex]

  return <section className="panel analytics-panel" aria-labelledby="lunadiff-title">
    <div className="panel-heading"><ArrowLeftRight size={17} /><h2 id="lunadiff-title">LunaDiff</h2><span className="badge synthetic">SAMPLE DATA</span></div>
    <p className="muted">Compare the planned arrival with Scenario B at the same elapsed mission time.</p>
    <p className="footnote">A starts {a[0].utc.slice(0, 10)} UTC · B starts {b[0].utc.slice(0, 10)} UTC. Both use the same illustrative terrain.</p>
    <div className="analytics-summary">
      {[
        ['Sunlight', summaryA.sun, summaryB.sun],
        ['Longest darkness', summaryA.darkest, summaryB.darkest],
        ['Earth visibility', summaryA.earth, summaryB.earth],
      ].map(([title, left, right]) => <div key={title} className="analytics-card"><span>{title}</span>
        <strong>{signed(Number(right) - Number(left))}</strong><small>A {left} h · B {right} h</small>
      </div>)}
    </div>
    {(['sun', 'earth'] as const).map(body => {
      const row = windows.filter(interval => interval.body === body)
      return <div key={body} className="diff-row">
        <strong>{body === 'sun' ? 'Sunlight' : 'Earth visibility'}</strong>
        <div className="diff-track" aria-hidden="true">{row.map(interval =>
          <span className={interval.gained ? 'gained' : 'lost'} key={interval.start}
            onClick={() => { setActive(interval); onSeek(interval.start) }}
            style={{ left: `${100 * interval.start / summaryA.durationHours}%`, width: `${100 * (interval.end - interval.start) / summaryA.durationHours}%` }} />)}</div>
        {row.length ? <div className="diff-windows" aria-label={`${body === 'sun' ? 'Sunlight' : 'Earth visibility'} change windows`}>
          {row.map(interval => <button key={interval.start} type="button" className={interval.gained ? 'gained' : 'lost'}
            aria-pressed={selected === interval} onClick={() => { setActive(interval); onSeek(interval.start) }}>
            {interval.gained ? 'Gained' : 'Lost'} · {interval.start}–{interval.end} h
          </button>)}
        </div> : <p className="footnote">No changes in this sample window.</p>}
      </div>
    })}
    {selected && <div className="analytics-card obstruction" aria-live="polite">
      <strong>{label(selected)} · {selected.start}–{selected.end} h</strong>
      <p>At the start of this interval, the {selected.body === 'sun' ? 'Sun' : 'Earth'} is below the sample terrain in Scenario {chartScenario}:
        {' '}{(selected.gained ? selected.a : selected.b).elevation_deg.toFixed(2)}° elevation versus {(selected.gained ? selected.a : selected.b).horizon_deg.toFixed(2)}° terrain at {(selected.gained ? selected.a : selected.b).azimuth_deg.toFixed(1)}° azimuth.</p>
    </div>}
    <div className="analytics-horizon-heading"><h3>Horizon skyline · {chartScenario}</h3>
      <div className="view-toggle" role="group" aria-label="Horizon scenario">
        {(['A', 'B'] as const).map(value => <button type="button" key={value} aria-pressed={chartScenario === value}
          onClick={() => { setActive(undefined); setScenario(value) }}>{value}</button>)}
      </div>
    </div>
    <HorizonChart skyline={chartScenario === 'A' ? skyA : skyB} sun={current.sun} earth={current.earth}
      highlight={selected ? (selected.gained ? selected.a : selected.b) : undefined} scenario={chartScenario} />
  </section>
}
