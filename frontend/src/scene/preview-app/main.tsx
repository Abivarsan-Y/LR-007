import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { SceneView, type TerrainMeshData } from '../SceneView';
import { decodeTerrain, verifyTerrainChecksum } from '../terrain.mjs';
import metadata from '../../../../data/fixtures/mock_terrain.json';
import analysis from '../../../../data/fixtures/mock_analysis.json';
import terrainUrl from '../../../../data/fixtures/mock_height_grid.bin?url';
import './style.css';

function App() {
  const [terrain, setTerrain] = useState<TerrainMeshData | null>(null);
  const [error, setError] = useState('');
  const [sampleIndex, setSampleIndex] = useState(0);
  const [wireframe, setWireframe] = useState(false);
  const [verticalScale, setVerticalScale] = useState(10);
  const [cameraPreset, setCameraPreset] = useState<'overview' | 'surface'>('overview');
  const [resetKey, setResetKey] = useState(0);
  const [manual, setManual] = useState(false);
  const [sunAz, setSunAz] = useState(135);
  const [sunEl, setSunEl] = useState(12);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setError(''); setTerrain(null);
    (async () => {
      const response = await fetch(terrainUrl, { signal: controller.signal });
      if (!response.ok) throw new Error('Terrain download failed');
      const buffer = await response.arrayBuffer();
      await verifyTerrainChecksum(buffer, metadata.sha256);
      const decoded = decodeTerrain(buffer, metadata);
      if (!controller.signal.aborted) setTerrain(decoded);
    })().catch((err: unknown) => {
      if (!controller.signal.aborted) setError(err instanceof Error ? err.message : 'Could not load terrain');
    });
    return () => controller.abort();
  }, [attempt]);
  const sample = analysis.samples[sampleIndex];
  const sun = manual ? { azimuth_deg: sunAz, elevation_deg: sunEl } : sample.sun;
  return <main>
    <header><div><p className="eyebrow">HORIZON OPS / PERSON D</p><h1>Scene lab<span>Terrain & celestial directions</span></h1></div><span className="badge">Independent preview · v0.1</span></header>
    <div className="notice"><strong>Synthetic test data</strong><span>No NASA observations, terrain-obstruction predictions, or landing-safety results are shown here.</span></div>
    <div className="layout">
      <section className="viewport" aria-label="Interactive terrain preview">
        {terrain ? <SceneView terrain={terrain} sun={sun} earth={sample.earth} dataKind="synthetic" verticalScale={verticalScale} wireframe={wireframe} cameraPreset={cameraPreset} resetKey={resetKey} />
          : <div className="loading" role="status">{error || 'Loading and verifying terrain…'}{error && <button onClick={() => setAttempt(v => v + 1)}>Retry terrain load</button>}</div>}
        <div className="view-footer">Drag to rotate · Scroll / pinch to zoom · Right-drag to pan</div>
      </section>
      <aside>
        <p className="eyebrow">VIEW CONTROLS</p><h2>Explore the local grid</h2>
        <div className="button-row"><button aria-pressed={cameraPreset === 'overview'} onClick={() => setCameraPreset('overview')}>Overview</button><button disabled={!terrain || terrain.groundY === null} aria-pressed={cameraPreset === 'surface'} onClick={() => setCameraPreset('surface')}>Surface</button></div>
        <button className="reset" onClick={() => setResetKey(v => v + 1)}>Reset camera</button>
        <label htmlFor="scale">Vertical exaggeration <strong>{verticalScale}×</strong></label><input id="scale" type="range" min="1" max="20" value={verticalScale} onChange={e => setVerticalScale(Number(e.target.value))}/>
        <p className="hint">Heights are exaggerated for inspection. Horizontal distances stay unchanged.</p>
        <label className="check"><input type="checkbox" checked={wireframe} onChange={e => setWireframe(e.target.checked)}/> Show mesh triangles</label>
        <hr/><p className="eyebrow">CELESTIAL INPUT</p>
        <label className="check"><input type="checkbox" checked={manual} onChange={e => setManual(e.target.checked)}/> Manual Sun direction</label>
        {manual && <><label htmlFor="sun-az">Sun azimuth <strong>{sunAz}°</strong></label><input id="sun-az" type="range" min="0" max="359" value={sunAz} onChange={e => setSunAz(Number(e.target.value))}/><label htmlFor="sun-el">Sun elevation <strong>{sunEl}°</strong></label><input id="sun-el" type="range" min="-15" max="45" value={sunEl} onChange={e => setSunEl(Number(e.target.value))}/></>}
        <dl><div><dt><i className="sun"/>Sun · az / el</dt><dd>{sun.azimuth_deg.toFixed(1)}° / {sun.elevation_deg.toFixed(1)}°</dd></div><div><dt><i className="earth"/>Earth · az / el</dt><dd>{sample.earth.azimuth_deg.toFixed(1)}° / {sample.earth.elevation_deg.toFixed(1)}°</dd></div></dl>
        <p className="hint">Arrows show directions from the observer. Body sizes, distances and the lander marker are enlarged illustrations. Earth phase and scientific shadows are not modeled.</p>
      </aside>
    </div>
    <section className="timeline" aria-labelledby="timeline-title"><div><p className="eyebrow" id="timeline-title">SYNTHETIC TIMELINE</p><strong>MET +{sample.met_hours.toFixed(1)} h</strong><span>{sample.utc}</span></div><label className="sr-only" htmlFor="time">Synthetic time sample</label><input id="time" type="range" min="0" max={analysis.samples.length - 1} step="1" value={sampleIndex} onChange={e => { setSampleIndex(Number(e.target.value)); setManual(false); }}/><p className="hint">Three discrete fixture samples. Moving this slider restores the supplied Sun direction; no orbital computation or interpolation is performed.</p></section>
    <footer><span>+X east · +Y up · −Z north</span><span>{terrain ? `64 × 64 samples · ${terrain.span.toLocaleString()} m span · ${terrain.missingVertices} missing heights` : 'Terrain pending'}</span><span>Scene component ready for A/B/C inputs</span></footer>
  </main>;
}

createRoot(document.getElementById('root')!).render(<StrictMode><App/></StrictMode>);
