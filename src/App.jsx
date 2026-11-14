import React, { useState } from 'react';

export default function App() {
  // Keep the user's text while editing; validate before using it as a coordinate.
  const [latitude, setLatitude] = useState('-89');
  const [longitude, setLongitude] = useState('0');
  const [utcTime, setUtcTime] = useState(() => new Date().toISOString().slice(0, 16));
  const [connection, setConnection] = useState('idle');

  async function checkBackend() {
    setConnection('checking');
    try {
      const response = await fetch('/api/health', { signal: AbortSignal.timeout(5000) });
      if (!response.ok) throw new Error('Health request failed');
      const data = await response.json();
      if (data.status !== 'ok' || data.service !== 'lunar-navigator-api') {
        throw new Error('Unexpected health response');
      }
      setConnection('connected');
    } catch {
      setConnection('error');
    }
  }
  const validLatitude = latitude.trim() !== '' && Number.isFinite(Number(latitude)) && Math.abs(Number(latitude)) <= 90;
  const validLongitude = longitude.trim() !== '' && Number.isFinite(Number(longitude)) && Math.abs(Number(longitude)) <= 180;
  const valid = validLatitude && validLongitude && utcTime !== '';

  return (
    <div className="app">
      <header>
        <div><p className="eyebrow">LR-007 / SPACE APPS PROJECT</p><h1>Lunar Site Navigator</h1></div>
        <span className="badge">02 · Backend connection</span>
      </header>
      <main>
        <section className="panel controls" aria-labelledby="controls-title">
          <p className="eyebrow">MISSION CONTROLS</p>
          <h2 id="controls-title">Choose your observer</h2>
          <p className="muted">A location on the Moon and a moment in time.</p>
          <label htmlFor="latitude">Latitude · degrees north</label>
          <input id="latitude" type="number" min="-90" max="90" step="any" value={latitude} onChange={event => setLatitude(event.target.value)} aria-invalid={!validLatitude} aria-describedby="latitude-help" />
          <small id="latitude-help">−90° south pole to +90° north pole.</small>
          <label htmlFor="longitude">Longitude · degrees east</label>
          <input id="longitude" type="number" min="-180" max="180" step="any" value={longitude} onChange={event => setLongitude(event.target.value)} aria-invalid={!validLongitude} aria-describedby="longitude-help" />
          <small id="longitude-help">−180° to +180°. Negative values are west.</small>
          <label htmlFor="utc-time">Date and time · UTC</label>
          <input id="utc-time" type="datetime-local" value={utcTime} onChange={event => setUtcTime(event.target.value)} aria-describedby="time-help" />
          <small id="time-help">Enter UTC directly, rather than your computer’s local time.</small>
          {!valid && <p role="alert" className="error">Enter coordinates within the stated ranges and select a date and time.</p>}
        </section>
        <section className="panel selection" aria-labelledby="selection-title">
          <p className="eyebrow">SELECTED OBSERVER</p>
          <h2 id="selection-title">Start with the science.</h2>
          <p className="muted">The interactive 3D Moon will share these same coordinates in a later milestone.</p>
          <dl aria-live="polite">
            <div><dt>Latitude</dt><dd>{validLatitude ? `${Number(latitude).toFixed(4)}° N` : '—'}</dd></div>
            <div><dt>Longitude</dt><dd>{validLongitude ? `${Number(longitude).toFixed(4)}° E` : '—'}</dd></div>
            <div><dt>Time (UTC)</dt><dd>{utcTime ? `${utcTime.replace('T', ' ')} UTC` : '—'}</dd></div>
          </dl>
          <div className="note"><strong>What works now</strong><p>Change an input and the selection updates immediately. This confirms the dashboard’s state flow.</p></div>
        </section>
        <section className="panel analysis" aria-labelledby="analysis-title">
          <p className="eyebrow">SITE ANALYSIS</p><h2 id="analysis-title">Awaiting ephemeris</h2>
          <div className="metric"><span>Sun elevation</span><strong>—</strong></div>
          <div className="metric"><span>Earth elevation</span><strong>—</strong></div>
          <p className="muted">NASA Horizons is not connected yet. No scientific values have been calculated.</p>
          <p className="muted">Next milestone: retrieve azimuth and elevation for this observer and UTC time.</p>
          <button className="connection-button" type="button" onClick={checkBackend} disabled={connection === 'checking'}>
            {connection === 'checking' ? 'Checking…' : 'Check backend connection'}
          </button>
          <p role="status" aria-live="polite" className={connection === 'error' ? 'error' : 'muted'}>
            {connection === 'idle' && 'Backend connection has not been checked.'}
            {connection === 'checking' && 'Contacting the local Python API…'}
            {connection === 'connected' && 'Backend connected. NASA data is not connected yet.'}
            {connection === 'error' && 'Could not reach the expected backend. Start python3 backend/server.py, then try again. If it is running, check its terminal and restart Vite.'}
          </p>
        </section>
      </main>
      <footer>Learning milestone 02 · Coordinates are user inputs, not verified landing sites.</footer>
    </div>
  );
}
