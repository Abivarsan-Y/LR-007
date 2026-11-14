import { useId, useState } from 'react'
import type { PointerEvent } from 'react'
import catalog from '../../../../data/sites.json'
import recommendations from '../../../../data/fixtures/mock_recommend.json'
import type { Point } from './lunarRendering'

const radius = 138
const radians = Math.PI / 180
const boundary = Math.tan(2.5 * radians)
const normalize = (lon: number) => ((lon + 180) % 360 + 360) % 360 - 180
const ids: Record<string, string> = { site01_connecting_ridge: 'connecting-ridge', site04_shackleton_rim: 'shackleton', site07_malapert_mountain: 'malapert', site09_haworth_floor: 'haworth' }
const sites = catalog.flatMap(site => {
  const id = ids[site.site_id]
  return id ? [{ id, canonicalId: site.site_id, name: site.name, lat: site.latitude_deg, lon: normalize(site.longitude_deg) }] : []
})
// Schematic circles from USGS Gazetteer center and diameter, in km (features 5450, 1439 and 14502).
const craters = [
  { name: 'Shackleton', lat: -89.67, lon: 129.78, diameter: 20.92 },
  { name: 'de Gerlache', lat: -88.48, lon: -88.34, diameter: 32.71 },
  { name: 'Haworth', lat: -86.90, lon: -4, diameter: 35 },
]

function project({ lat, lon }: Point) {
  const distance = radius * Math.tan((90 + lat) * radians / 2) / boundary
  return { x: distance * Math.sin(lon * radians), y: -distance * Math.cos(lon * radians) }
}

type Recommendation = {
  site_id: string; coordinates: { latitude_deg: number; longitude_deg: number }
  slope_deg: number; distance_m: number
}
type RecommendationSet = { origin_site_id: string; candidates: Recommendation[]; provenance: { data_kind: string } }
type Site = (typeof sites)[number]
type Pin = { point: Point; site?: Site; slope?: number }

const readGrid: Record<string, () => Promise<{ default: {
  grid: { rows: number; cols: number; physical_width_m: number; physical_height_m: number }
  observer: { grid_x: number; grid_y: number }; heights: (number | null)[]
} }>> = {
  'connecting-ridge': () => import('../../../../data/processed/site01_connecting_ridge.json'),
  shackleton: () => import('../../../../data/processed/site04_shackleton_rim.json'),
  malapert: () => import('../../../../data/processed/site07_malapert_mountain.json'),
  haworth: () => import('../../../../data/processed/site09_haworth_floor.json'),
}

export function PolarMap({ siteId, onSiteChange, nearby = recommendations }: {
  siteId: string; onSiteChange: (id: string) => void; nearby?: RecommendationSet
}) {
  const [pin, setPin] = useState<Pin>()
  const [sampled, setSampled] = useState<{ id: string; slope: number | null }>()
  const [loading, setLoading] = useState(false)
  const clip = useId()
  const currentSite = sites.find(site => site.id === siteId)
  const selected = pin ?? (currentSite && { point: currentSite, site: currentSite })
  const site = selected?.site
  const slope = pin?.slope ?? (site?.id === sampled?.id ? sampled?.slope : undefined)
  const matchesOrigin = !!site && (nearby.origin_site_id === site.canonicalId || nearby.origin_site_id === site.id)
  const candidates = matchesOrigin ? nearby.candidates : []

  function drop(event: PointerEvent<SVGSVGElement>) {
    if (event.button !== 0) return
    const svg = event.currentTarget
    const matrix = svg.getScreenCTM()
    if (!matrix) return
    const { x, y } = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse())
    const distance = Math.hypot(x, y)
    if (distance > radius) return
    setPin({ point: { lat: 2 * Math.atan(distance * boundary / radius) / radians - 90, lon: distance < .0001 ? 0 : normalize(Math.atan2(x, -y) / radians) } })
  }

  async function sampleSlope(siteId: string) {
    setLoading(true)
    let slope: number | null = null
    try {
      const { grid, observer, heights } = (await readGrid[siteId]()).default
      const { cols, rows, physical_width_m, physical_height_m } = grid
      const { grid_x: x, grid_y: y } = observer
      if (x > 0 && x < cols - 1 && y > 0 && y < rows - 1) {
        const west = heights[y * cols + x - 1], east = heights[y * cols + x + 1]
        const north = heights[(y - 1) * cols + x], south = heights[(y + 1) * cols + x]
        if ([west, east, north, south, heights[y * cols + x]].every(v => typeof v === 'number' && Number.isFinite(v))) {
          slope = Math.atan(Math.hypot(
            (east! - west!) / (2 * physical_width_m / (cols - 1)),
            (south! - north!) / (2 * physical_height_m / (rows - 1)),
          )) / radians
        }
      }
    } catch { /* Keep the unavailable state when a grid cannot be read. */ }
    setSampled({ id: siteId, slope })
    setLoading(false)
  }

  return <div className="polar-map">
    <svg viewBox="-165 -158 330 316" tabIndex={0}
      aria-label="Lunar south pole. Tap to inspect coordinates, or use the arrow keys to move the pin." onPointerUp={drop}
      onKeyDown={event => {
        const offsets: Record<string, [number, number]> = { ArrowUp: [.1, 0], ArrowDown: [-.1, 0], ArrowLeft: [0, -5], ArrowRight: [0, 5] }
        const offset = offsets[event.key]
        if (!offset) return
        event.preventDefault()
        const point = selected?.point ?? { lat: -89, lon: 0 }
        setPin({ point: { lat: Math.max(-90, Math.min(-85, point.lat + offset[0])), lon: normalize(point.lon + offset[1]) } })
      }}>
      <defs><clipPath id={clip}><circle r={radius} /></clipPath></defs>
      {[85, 87, 89].map(lat => <circle key={lat} r={-project({ lat: -lat, lon: 0 }).y} fill={lat === 85 ? '#0c1428' : 'none'} stroke="#526584" />)}
      {[0, 45, 90, 135, 180, 225, 270, 315].map(lon => {
        const point = project({ lat: -85, lon })
        return <line key={lon} x1={0} y1={0} x2={point.x} y2={point.y} stroke="#31405e" />
      })}
      <g clipPath={`url(#${clip})`}>{craters.map(crater => {
        const point = project(crater)
        return <g key={crater.name}><circle cx={point.x} cy={point.y} r={crater.diameter * radius / 303} fill="#52658430" stroke="#91a9cb" />
          <text x={point.x + 5} y={point.y + 12}>{crater.name}</text></g>
      })}</g>
      {sites.map(site => {
        const point = project(site)
        return <circle key={site.id} cx={point.x} cy={point.y} r={4.8} fill="#79e8f2"
          onPointerUp={event => {
            if (event.button !== 0) return
            event.stopPropagation()
            setPin({ point: site, site })
            onSiteChange(site.id)
          }}><title>{site.name}</title></circle>
      })}
      {selected && <circle cx={project(selected.point).x} cy={project(selected.point).y} r={7} fill="none" stroke="#dfbdff" strokeWidth={2} />}
      <text y={-145} textAnchor="middle">0°E</text><text x={144} y={4}>90°E</text>
      <text y={153} textAnchor="middle">180°</text><text x={-164} y={4}>90°W</text>
    </svg>
    <p className="footnote">85°S–90°S · dots mark catalog sites. Crater outlines are approximate.</p>
    <div className="diff-windows" aria-label="Catalog sites">{sites.map(site => <button key={site.id} type="button" aria-pressed={selected?.site?.id === site.id}
      onClick={() => { setPin({ point: site, site }); onSiteChange(site.id) }}>{site.name.replace(/ \(Site \d+\)/, '')}</button>)}</div>
    <div className="analytics-card polar-detail" aria-live="polite">
      {selected ? <>
        <strong>{site?.name ?? 'Map pin'}</strong>
        <p>{selected.point.lat.toFixed(4)}°, {selected.point.lon.toFixed(4)}° · east positive</p>
        <p>{typeof slope === 'number' ? `${slope.toFixed(1)}° · ${slope > 15 ? 'Steep' : slope < 8 ? 'Low slope' : 'Caution'} (screening only)` : 'Slope unavailable for this point.'}</p>
        {site && <button type="button" className="analytics-button" disabled={loading} onClick={() => { void sampleSlope(site.id) }}>
          {loading ? 'Reading terrain…' : 'Check catalog grid slope'}
        </button>}
        {site?.id === sampled?.id && typeof slope === 'number' && pin?.slope === undefined && <p>From the unverified site grid at its stored observer sample.</p>}
        <p>{candidates.length ? `Nearby candidates · ${nearby.provenance.data_kind.replaceAll('_', ' ')}` : 'No matching nearby recommendations are available.'}</p>
        {candidates.map(candidate => <button key={candidate.site_id} type="button" className="analytics-button" onClick={() => {
          const point = { lat: candidate.coordinates.latitude_deg, lon: candidate.coordinates.longitude_deg }
          const match = sites.find(site => (site.canonicalId === candidate.site_id || site.id === candidate.site_id)
            && Math.abs(site.lat - point.lat) < 0.00001 && Math.abs(normalize(site.lon - point.lon)) < 0.00001)
          setPin({ point, site: match, slope: candidate.slope_deg })
          if (match) onSiteChange(match.id)
        }}>{candidate.site_id} · {(candidate.distance_m / 1000).toFixed(1)} km · {candidate.slope_deg.toFixed(1)}°</button>)}
      </> : <p>Tap the map or select a catalog site.</p>}
    </div>
  </div>
}
