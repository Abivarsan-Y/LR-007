import { useState } from 'react'
import { Box, Map, Crosshair } from 'lucide-react'

export function ViewportPlaceholder({ siteName }: { siteName: string }) {
  const [mode, setMode] = useState<'3d' | '2d'>('3d')
  return <section className="panel viewport" aria-label="Lunar viewport preview">
    <div className="viewport-toolbar"><span className="eyebrow">SURFACE EXPLORER</span>
      <div className="view-toggle" role="group" aria-label="Viewport mode">
        <button aria-pressed={mode === '3d'} onClick={() => setMode('3d')}><Box size={15} />3D scene</button>
        <button aria-pressed={mode === '2d'} onClick={() => setMode('2d')}><Map size={15} />2D map</button>
      </div>
    </div>
    <div className={`viewport-art ${mode}`} aria-hidden="true"><div className="orbit orbit-one" /><div className="orbit orbit-two" /><div className="moon" /><Crosshair className="crosshair" size={35} /></div>
    <div className="viewport-caption"><span className="badge">VIEWPORT PLACEHOLDER</span><h2>{mode === '3d' ? 'A new perspective on the pole.' : 'Your next landing, in context.'}</h2><p>{mode === '3d' ? 'Reserved for the terrain and celestial scene.' : 'Reserved for the interactive south-pole map.'}</p><small>Illustration only · No terrain or ephemeris data loaded</small></div>
    <div className="viewport-footer"><span><span className="status-dot" /> {siteName}</span><span>SCENARIO A</span></div>
  </section>
}
