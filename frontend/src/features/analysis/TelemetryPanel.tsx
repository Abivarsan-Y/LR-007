import { Moon, Radio, Sun, ArrowLeftRight } from 'lucide-react'
import type { DashboardPreview } from '../../api/types'

export function TelemetryPanel({ metrics }: { metrics: DashboardPreview['metrics'] }) {
  return <aside className="telemetry" aria-label="Telemetry and comparison">
    <section className="panel"><div className="panel-heading"><Radio size={17} /><h2>Mission telemetry</h2></div><p className="muted">Sample data</p>
      <div className="metric"><Sun size={19} className="amber" /><span>Sunlight availability<strong>{metrics.sunlightPercent}<small>%</small></strong></span></div>
      <div className="metric"><Moon size={19} /><span>Longest darkness<strong>{metrics.maxDarknessHours}<small>h</small></strong></span></div>
      <div className="metric"><Radio size={19} className="cyan" /><span>Direct-to-Earth visibility<strong>{metrics.dtePercent}<small>%</small></strong></span></div>
      <p className="footnote">Sample values do not change with mission setup and are not landing guidance.</p>
    </section>
    <section className="panel comparison"><div className="panel-heading"><ArrowLeftRight size={17} /><h2>LunaDiff</h2></div><p className="muted">See what changed. See why.</p><div className="comparison-row"><span>Sunlight delta</span><strong>—</strong></div><div className="comparison-row"><span>Darkness delta</span><strong>—</strong></div><div className="comparison-row"><span>Earth-link delta</span><strong>—</strong></div><p className="footnote">Scenario comparison arrives in a later phase.</p></section>
  </aside>
}
