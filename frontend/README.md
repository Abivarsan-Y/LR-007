# HORIZON OPS frontend — Phase 1

React + Vite + TypeScript dashboard shell with Tailwind CSS, Lucide icons, and Recharts installed for the later analytics work.

## Run

Requires Node.js 20.19+ or 22.12+ and npm.

```sh
npm install
npm run dev
npm run typecheck
npm run build
npm run preview
```

The responsive layout includes mission setup, a 3D/2D placeholder toggle, synthetic telemetry, comparison placeholders, and a disabled timeline placeholder. Setup edits remain in React state for the current session; they do not compute analysis. The date is a UTC calendar date. No external fonts, imagery, backend, or NASA services are required at runtime.

## Data and integration boundaries

`src/api/client.ts` imports the shared `data/fixtures/mock_analysis.json` fixture and maps its metrics into the dashboard view model. Vite bundles the sample data for offline use. The local `src/api/fixtures/dashboard.json` holds the mission controls' options and defaults. Telemetry stays fixed when the user edits those controls. Phase 4 switches the client boundary to FastAPI.

The viewport component is an illustration and integration slot for Person D's `src/scene/SceneView.tsx`; it does not implement terrain, celestial positions, or a geographic map. No files in Person D's scene ownership are created. Timeline playback belongs to Phase 2; map, horizon chart, and LunaDiff interactions belong to Phase 3.
