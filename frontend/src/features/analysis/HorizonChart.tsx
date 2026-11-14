import { useId } from 'react'
import type { Direction } from './missionPreview'

export function HorizonChart({ skyline, sun, earth, highlight, scenario }: {
  skyline: number[]; sun: Direction; earth: Direction; highlight?: Direction; scenario: 'A' | 'B'
}) {
  const titleId = useId()
  const x = (azimuth: number) => 37 + azimuth * 1.5
  const y = (elevation: number) => 143 - elevation * 14
  const path = skyline.map((value, index) => `${x(index)},${y(value)}`).join(' ')
  return <div className="analytics-chart">
    <svg viewBox="0 0 600 214" role="img" aria-labelledby={titleId}>
      <title id={titleId}>Scenario {scenario} sample terrain horizon, Sun and Earth elevation by azimuth</title>
      {[-2, 0, 4, 8].map(tick => <g key={tick}>
        <line x1={37} x2={577} y1={y(tick)} y2={y(tick)} stroke={tick === 0 ? '#64748b' : '#303a58'} />
        <text x={30} y={y(tick) + 4} textAnchor="end">{tick}°</text>
      </g>)}
      {['N', 'E', 'S', 'W', 'N'].map((label, i) => <text key={i} x={x(i * 90)} y={195} textAnchor="middle">{label} · {i * 90}°</text>)}
      <polygon points={`37,173 ${path} 577,173`} fill="#253552" />
      <polyline points={path} fill="none" stroke="#a9c8e3" strokeWidth={2} />
      {highlight && <g>
        <line x1={x(highlight.azimuth_deg)} x2={x(highlight.azimuth_deg)} y1={21} y2={173} stroke="#f2adc4" strokeDasharray="4 4" />
        <circle cx={x(highlight.azimuth_deg)} cy={y(highlight.horizon_deg)} r={5} stroke="#f2adc4" strokeWidth={2} fill="#0d1428" />
      </g>}
      {[{ d: sun, color: '#ffd38a' }, { d: earth, color: '#79ebf6' }].map(({ d, color }) =>
        <circle key={color} cx={x(d.azimuth_deg)} cy={y(d.elevation_deg)} r={5} fill={color} stroke="#121a2e" strokeWidth={1.5} />)}
    </svg>
    <p className="analytics-key"><span className="sun-key">● Sun</span><span className="earth-key">● Earth</span><span>― Terrain horizon</span>{highlight && <span>┊ Obstruction azimuth</span>}</p>
  </div>
}
