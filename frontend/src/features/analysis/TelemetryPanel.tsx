import { Moon, Radio, Sun } from 'lucide-react'
import type { MissionSample } from './missionPreview'
import { summarize } from './missionPreview'

export function TelemetryPanel({ samples, current }: { samples: MissionSample[]; current: MissionSample }) {
  const { sun, earth, darkest, durationHours } = summarize(samples)
  return <aside className="telemetry" aria-label="Sample mission telemetry">
    <section className="panel">
      <div className="panel-heading"><Radio size={17} /><h2>Mission telemetry</h2></div>
      <p className="muted">Sample data · Scenario A</p>
      <div className="metric"><Sun size={19} className="amber" /><span>Sunlight availability<strong>{(100 * sun / durationHours).toFixed(1)}<small>%</small></strong></span></div>
      <div className="metric"><Moon size={19} /><span>Longest darkness<strong>{darkest}<small>h</small></strong></span></div>
      <div className="metric"><Radio size={19} className="cyan" /><span>Earth visibility<strong>{(100 * earth / durationHours).toFixed(1)}<small>%</small></strong></span></div>
      <div className="analytics-card analytics-now">
        <strong>At +{current.met_hours} h</strong>
        <span>Sun {current.sun.visible ? 'visible' : 'obscured'}</span>
        <span>Earth {current.earth.visible ? 'visible' : 'obscured'}</span>
      </div>
    </section>
  </aside>
}
