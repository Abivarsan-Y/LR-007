import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { ArrowLeft, Box, Map, Minus, Plus, Search } from 'lucide-react'
import { drawMoon, parseLocation } from './lunarRendering'
import type { Point } from './lunarRendering'
import sitesJson from '../../../../data/sites.json'
import type { TerrainMeshData, BodyDirection } from '../../scene/SceneView'
import { adaptTerrainJson } from '../../scene/terrain-json.mjs'
import { decodeTerrain, verifyTerrainChecksum } from '../../scene/terrain.mjs'
import metadata from '../../../../data/fixtures/mock_terrain.json'
import terrainUrl from '../../../../data/fixtures/mock_height_grid.bin?url'

const catalogIds: Record<string, string> = {
  site01_connecting_ridge: 'connecting-ridge',
  site04_shackleton_rim: 'shackleton',
  site07_malapert_mountain: 'malapert',
  site09_haworth_floor: 'haworth',
}
const sites = sitesJson.flatMap(site => {
  const id = catalogIds[site.site_id]
  return id ? [{ id, name: site.name.replace(/ \(Site \d+\)$/, ''), lat: site.latitude_deg, lon: ((site.longitude_deg + 180) % 360) - 180 }] : []
})
const degrees = (n: number) => n * Math.PI / 180

function nearbySite(center: Point) {
  let result: (typeof sites)[number] | undefined
  let best = Math.cos(degrees(.5))
  for (const site of sites) {
    const similarity = Math.sin(degrees(center.lat)) * Math.sin(degrees(site.lat))
      + Math.cos(degrees(center.lat)) * Math.cos(degrees(site.lat)) * Math.cos(degrees(center.lon - site.lon))
    if (similarity > best) { result = site; best = similarity }
  }
  return result
}

function MoonGlobe({ point, onSelect }: { point?: Point; onSelect: (id: string, point: Point) => void }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const last = useRef<{ x: number; y: number } | null>(null)
  const [center, setCenter] = useState<Point>(point ?? { lat: -37, lon: -15 })
  const [zoom, setZoom] = useState(point ? 1.2 : 1)
  const [size, setSize] = useState({ width: 480, height: 340 })

  useEffect(() => {
    const target = canvas.current
    if (!target) return
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect
      setSize({ width: Math.min(800, Math.max(1, Math.round(width))), height: Math.max(1, Math.round(height)) })
    })
    observer.observe(target)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const context = canvas.current?.getContext('2d')
    if (!context) return
    const frame = requestAnimationFrame(() => drawMoon(context, center, zoom, point))
    return () => cancelAnimationFrame(frame)
  }, [center, zoom, point, size])

  function rotate(dx: number, dy: number) {
    setCenter(view => ({ lat: Math.max(-90, Math.min(90, view.lat + dy)), lon: (view.lon + dx) % 360 }))
  }

  function changeZoom(direction: number) {
    const next = Math.max(.8, Math.min(1.85, zoom + direction * .2))
    const site = direction > 0 && next >= 1.55 ? nearbySite(center) : undefined
    if (site) onSelect(site.id, site)
    else setZoom(next)
  }

  useEffect(() => {
    const target = canvas.current
    if (!target) return
    const onWheel = (event: WheelEvent) => {
      if (!event.deltaY) return
      event.preventDefault()
      changeZoom(event.deltaY < 0 ? 1 : -1)
    }
    target.addEventListener('wheel', onWheel, { passive: false })
    return () => target.removeEventListener('wheel', onWheel)
  })

  return <div className="relative h-[330px] min-w-0 bg-[#0a101c] sm:h-[385px]">
    <canvas ref={canvas} width={size.width} height={size.height} tabIndex={0}
      aria-label="Illustrated Moon. Arrow keys rotate, plus and minus zoom."
      className="absolute inset-0 block size-full touch-none cursor-grab focus-visible:outline-2 focus-visible:outline-cyan-300 active:cursor-grabbing"
      onPointerDown={event => {
        if (!event.isPrimary || event.button !== 0) return
        last.current = { x: event.clientX, y: event.clientY }
        event.currentTarget.setPointerCapture(event.pointerId)
      }}
      onPointerMove={event => {
        if (!event.isPrimary || !last.current) return
        rotate((last.current.x - event.clientX) * .42, (event.clientY - last.current.y) * .42)
        last.current = { x: event.clientX, y: event.clientY }
      }}
      onLostPointerCapture={() => { last.current = null }}
      onKeyDown={event => {
        const offsets: Record<string, [number, number]> = { ArrowLeft: [-10, 0], ArrowRight: [10, 0], ArrowDown: [0, -10], ArrowUp: [0, 10] }
        if (offsets[event.key]) rotate(...offsets[event.key])
        else if (event.key === '+' || event.key === '=') changeZoom(1)
        else if (event.key === '-') changeZoom(-1)
        else return
        event.preventDefault()
      }} />
    <div className="absolute right-3 bottom-3 flex gap-2">
      <button type="button" aria-label="Zoom in" className="grid min-w-11 place-items-center rounded-lg border border-slate-600 bg-slate-900" onClick={() => changeZoom(1)}><Plus size={16} /></button>
      <button type="button" aria-label="Zoom out" className="grid min-w-11 place-items-center rounded-lg border border-slate-600 bg-slate-900" onClick={() => changeZoom(-1)}><Minus size={16} /></button>
    </div>
  </div>
}

const SceneView = lazy(() => import('../../scene/SceneView').then(module => ({ default: module.SceneView })))
const siteGrids: Record<string, () => Promise<{ default: unknown }>> = {
  'connecting-ridge': () => import('../../../../data/processed/site01_connecting_ridge.json'),
  shackleton: () => import('../../../../data/processed/site04_shackleton_rim.json'),
  malapert: () => import('../../../../data/processed/site07_malapert_mountain.json'),
  haworth: () => import('../../../../data/processed/site09_haworth_floor.json'),
}
export type TerrainSource = 'b-grid' | 'synthetic'
type Loaded = { identity: string; mesh: TerrainMeshData; diagnostics: ReturnType<typeof adaptTerrainJson>['diagnostics'] | null }
type Props = {
  onSiteChange: (id: string) => void; siteId: string; siteName: string; source: TerrainSource; onSourceChange: (value: TerrainSource) => void
  sun: BodyDirection; earth: BodyDirection; observerHeightM: number
}

export function LunarViewport({ onSiteChange, siteId, siteName, source, onSourceChange, sun, earth, observerHeightM }: Props) {
  const [mode, setMode] = useState<'globe' | '3d' | '2d'>('globe')
  const [query, setQuery] = useState('')
  const [target, setTarget] = useState<Point>()
  const [queryError, setQueryError] = useState('')
  const [globeKey, setGlobeKey] = useState(0)
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [failure, setFailure] = useState<{ identity: string; message: string } | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [wireframe, setWireframe] = useState(false)
  const [scale, setScale] = useState(1)
  const [preset, setPreset] = useState<'overview' | 'surface'>('overview')
  const [resetKey, setResetKey] = useState(0)
  const identity = `${source}:${siteId}:${attempt}`
  useEffect(() => {
    if (mode !== '3d') return
    const controller = new AbortController()
    ;(async () => {
      let next: Omit<Loaded, 'identity'>
      if (source === 'b-grid') {
        const readGrid = siteGrids[siteId]
        if (!readGrid) throw new Error('No terrain export is available for this site')
        const data = await readGrid()
        const result = adaptTerrainJson(data.default)
        next = { mesh: result.mesh, diagnostics: result.diagnostics }
      } else {
        const response = await fetch(terrainUrl, { signal: controller.signal })
        if (!response.ok) throw new Error('Could not load the synthetic terrain')
        const bytes = await response.arrayBuffer()
        await verifyTerrainChecksum(bytes, metadata.sha256)
        next = { mesh: decodeTerrain(bytes, metadata), diagnostics: null }
      }
      if (!controller.signal.aborted) { setLoaded({ ...next, identity }); setFailure(null) }
    })().catch((error: unknown) => {
      if (!controller.signal.aborted) setFailure({ identity, message: error instanceof Error ? error.message : 'Terrain load failed' })
    })
    return () => controller.abort()
  }, [identity, siteId, source, mode])
  // Never show the previous site's mesh under the new site's title, even during loading.
  const current = loaded?.identity === identity ? loaded : null
  const error = failure?.identity === identity ? failure.message : null
  const coordinates = mode === 'globe' ? target : sites.find(site => site.id === siteId)
  function selectSite(id: string, point: Point) {
    setTarget(point)
    setQueryError('')
    onSiteChange(id)
    onSourceChange('b-grid')
    setPreset('overview')
    setMode('3d')
  }

  return <section className="panel viewport" aria-label="Lunar terrain explorer">
    <form className="m-4 mb-0 flex min-w-0 gap-2" onSubmit={event => {
      event.preventDefault()
      const picked = parseLocation(query, sites)
      if (!picked) { setQueryError('Enter a listed site or decimal latitude, longitude.'); return }
      setQueryError('')
      if (picked.site) selectSite(picked.site.id, picked.point)
      else { setTarget(picked.point); setGlobeKey(key => key + 1); setMode('globe') }
    }}>
      <label className="sr-only" htmlFor="lunar-search">Landing site or lunar coordinates</label>
      <input id="lunar-search" className="min-w-0 flex-1 rounded-lg border border-slate-600 bg-slate-950 px-3 text-sm"
        type="search" list="lunar-sites" placeholder="Site name or latitude, longitude" required
        value={query} onChange={event => { setQuery(event.target.value); setQueryError('') }} aria-invalid={!!queryError}
        aria-describedby={queryError ? 'lunar-search-error' : undefined} />
      <datalist id="lunar-sites">{sites.map(site => <option value={site.name} key={site.id} />)}</datalist>
      <button type="submit" aria-label="Find location" className="grid min-w-11 place-items-center rounded-lg border border-slate-600 bg-slate-900"><Search size={16} /></button>
    </form>
    {queryError && <p id="lunar-search-error" role="alert" className="mx-4 mt-2 text-xs text-rose-200">{queryError}</p>}
    <div className="viewport-toolbar"><span className="eyebrow">SURFACE EXPLORER</span><div className="view-toggle" role="group" aria-label="Viewport mode">
      <button aria-pressed={mode === 'globe'} onClick={() => setMode('globe')}><ArrowLeft size={15}/>Globe</button>
      <button aria-pressed={mode === '3d'} onClick={() => setMode('3d')}><Box size={15}/>3D scene</button>
      <button aria-pressed={mode === '2d'} onClick={() => setMode('2d')}><Map size={15}/>2D map</button>
    </div></div>
    {mode === 'globe' ? <>
      <MoonGlobe key={globeKey} point={target} onSelect={selectSite} />
      <p className="scene-disclosure pt-3" aria-live="polite">
        {target && !parseLocation(`${target.lat}, ${target.lon}`, sites)?.site
          ? 'Local terrain is unavailable for these coordinates.'
          : 'Illustrated Moon. Drag to rotate, or search to open a landing site.'}
      </p>
    </> : mode === '3d' ? <>
      <div className="terrain-options"><label htmlFor="terrain-source">Terrain input</label><select id="terrain-source" value={source} onChange={e => onSourceChange(e.target.value as TerrainSource)}><option value="b-grid">Site terrain grid · unverified</option><option value="synthetic">Synthetic direction demo</option></select></div>
      <div className="dashboard-scene" aria-label="Interactive 3D terrain">
        {error ? <div role="alert" className="scene-message">{error}<button onClick={() => setAttempt(v => v + 1)}>Retry terrain load</button></div>
          : !current ? <p role="status" className="scene-message">Loading terrain…</p>
            : <Suspense fallback={<p role="status" className="scene-message">Loading 3D viewer…</p>}><SceneView key={identity} terrain={current.mesh} sun={sun} earth={earth} dataKind={source === 'synthetic' ? 'synthetic' : 'unverified'} showCelestial={source === 'synthetic'} observerHeightM={observerHeightM} verticalScale={scale} wireframe={wireframe} cameraPreset={preset} resetKey={resetKey}/></Suspense>}
      </div>
      <div className="scene-controls"><button aria-pressed={preset === 'overview'} onClick={() => setPreset('overview')}>Overview</button><button disabled={!current || current.mesh.groundY === null} aria-pressed={preset === 'surface'} onClick={() => setPreset('surface')}>Surface</button><button onClick={() => setResetKey(v => v + 1)}>Reset camera</button><label><input type="checkbox" checked={wireframe} onChange={e => setWireframe(e.target.checked)}/>Wireframe</label><label htmlFor="terrain-scale">Height {scale}×</label><input id="terrain-scale" type="range" min="1" max="20" value={scale} onChange={e => setScale(Number(e.target.value))}/></div>
      <div className="scene-disclosure" aria-live="polite">
        {source === 'b-grid' ? <><strong>Terrain inspection only · {siteName}</strong><p>Frame, grid orientation and height reference are unverified. Sun/Earth overlays are hidden; no visibility or safety result is calculated.</p>{current?.diagnostics && <p>Stored site elevation: {current.diagnostics.nominalElevationM.toFixed(1)} m · Grid observer sample: {current.diagnostics.gridObserverElevationM === null ? 'missing' : `${current.diagnostics.gridObserverElevationM.toFixed(1)} m`}. Display is centered on the grid sample; source metadata is unchanged.</p>}</>
          : <><strong>Synthetic terrain and celestial directions</strong><p>This test scene is independent of the selected landing site/date. Use the fixture timeline below to change Sun/Earth directions.</p><p>Sun az/el: {sun.azimuth_deg.toFixed(1)}° / {sun.elevation_deg.toFixed(1)}° · Earth az/el: {earth.azimuth_deg.toFixed(1)}° / {earth.elevation_deg.toFixed(1)}°.</p></>}
        <p>Drag to rotate · scroll/pinch to zoom. Height exaggeration and lighting are illustrative; the lander is enlarged.</p>
      </div>
    </> : <div className="viewport-caption map-pending"><span className="badge">2D MAP PENDING</span><h2>Your next landing, in context.</h2><p>The interactive polar map is not connected yet.</p><button onClick={() => setMode('3d')}>Return to 3D scene</button></div>}
    {coordinates && <p className="scene-disclosure" aria-live="polite">Latitude {coordinates.lat.toFixed(4)}° · Longitude {coordinates.lon.toFixed(4)}° (east positive)</p>}
    <div className="viewport-footer"><span>{mode === 'globe' ? 'Moon overview' : source === 'synthetic' ? 'Synthetic test point' : siteName}</span><span>{mode === 'globe' ? 'ILLUSTRATED' : source === 'synthetic' ? 'TEST DIRECTIONS' : 'GRID INSPECTION'}</span></div>
  </section>
}
