import { lazy, Suspense, useEffect, useState } from 'react'
import { Box, Map } from 'lucide-react'
import type { TerrainMeshData, BodyDirection } from '../../scene/SceneView'
import { adaptTerrainJson } from '../../scene/terrain-json.mjs'
import { decodeTerrain, verifyTerrainChecksum } from '../../scene/terrain.mjs'
import metadata from '../../../../data/fixtures/mock_terrain.json'
import terrainUrl from '../../../../data/fixtures/mock_height_grid.bin?url'

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
  siteId: string; siteName: string; source: TerrainSource; onSourceChange: (value: TerrainSource) => void
  sun: BodyDirection; earth: BodyDirection; observerHeightM: number
}

export function LunarViewport({ siteId, siteName, source, onSourceChange, sun, earth, observerHeightM }: Props) {
  const [mode, setMode] = useState<'3d' | '2d'>('3d')
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [failure, setFailure] = useState<{ identity: string; message: string } | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [wireframe, setWireframe] = useState(false)
  const [scale, setScale] = useState(1)
  const [preset, setPreset] = useState<'overview' | 'surface'>('overview')
  const [resetKey, setResetKey] = useState(0)
  const identity = `${source}:${siteId}:${attempt}`
  useEffect(() => {
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
  }, [identity, siteId, source])
  // Never show the previous site's mesh under the new site's title, even during loading.
  const current = loaded?.identity === identity ? loaded : null
  const error = failure?.identity === identity ? failure.message : null
  return <section className="panel viewport" aria-label="Lunar terrain explorer">
    <div className="viewport-toolbar"><span className="eyebrow">SURFACE EXPLORER</span><div className="view-toggle" role="group" aria-label="Viewport mode">
      <button aria-pressed={mode === '3d'} onClick={() => setMode('3d')}><Box size={15}/>3D scene</button>
      <button aria-pressed={mode === '2d'} onClick={() => setMode('2d')}><Map size={15}/>2D map</button>
    </div></div>
    {mode === '3d' ? <>
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
    <div className="viewport-footer"><span>{source === 'synthetic' ? 'Synthetic test point' : siteName}</span><span>{source === 'synthetic' ? 'TEST DIRECTIONS' : 'GRID INSPECTION'}</span></div>
  </section>
}
