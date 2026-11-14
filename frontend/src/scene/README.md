# Person D — Standalone scene package

An isolated development preview; this does not own or scaffold Person C's frontend application. React Three Fiber 9 pairs with React 19. The component and loader live directly in this directory; `preview-app/` is disposable development wiring, not the final mission dashboard.

## Run

From the repository root:

```sh
npm --prefix frontend/src/scene ci
npm --prefix frontend/src/scene run dev
```

Open the printed local address (port 5174). This port is separate from the team's intended frontend port 5173. The preview needs no Python server, NASA access or external imagery. Ctrl+C stops it.

```sh
npm --prefix frontend/src/scene test
npm --prefix frontend/src/scene run build
```

The build first type-checks the React component and preview, then writes a static preview to `frontend/src/scene/dist/` (ignored). A chunk-size warning reflects the bundled 3D engine; this is an initial development preview, not a measured production-performance claim.

## Data flow

1. The preview imports the existing synthetic terrain metadata and analysis fixtures.
2. It fetches the local binary asset, checks its SHA-256, and decodes little-endian heights.
3. `decodeTerrain()` produces vertices and triangle indices in metres, relative to the metadata origin. Nodata-adjoining triangles are omitted.
4. The preview passes this mesh and selected Sun/Earth angles into `SceneView`.
5. The renderer changes its light and target markers from those angles; camera controls stay independent of the timeline.

This makes A/B/C integration a replacement of the input provider, rather than a rewrite of the scene.

## Component handoff to C

```tsx
import { SceneView } from './scene/SceneView';

<div style={{ height: 580 }}>
  <SceneView terrain={decodedTerrain} sun={currentSample.sun}
    earth={currentSample.earth} dataKind="cached_real"
    verticalScale={1} observerHeightM={analysis.observer_height_m}
    cameraPreset="overview" />
</div>
```

Use `dataKind="synthetic"` until the inputs are verified real data. The example above assumes C already fetched and validated A/B's real inputs. `SceneView` has no API calls, global state or mission calculations. C owns time/site controls and passes current values. Install compatible `react`, `react-dom`, `three` and `@react-three/fiber` in C's app (declared as peer dependencies here). The included package installs them for the independent preview. Avoid bundling duplicate React copies when integrating; consolidate dependencies in C's app at that point.

### API

- `terrain`: decoded mesh buffers, span, centre height and missing-height count.
- `sun`, `earth`: `{ azimuth_deg, elevation_deg }`; degrees, north-clockwise azimuth.
- `dataKind`: required provenance label (`synthetic`, `cached_real`, `live_real`).
- `verticalScale`: display-only exaggeration, default 10; preview allows 1–20. Use 1 for unexaggerated inspection.
- `observerHeightM`: origin of celestial arrows above centre terrain, default 2 m.
- `wireframe`: inspect mesh topology, default false.
- `cameraPreset`: `overview` or `surface`; surface is unavailable in the preview if centre terrain is missing.
- `resetKey`: increment to reset the camera without changing the selected preset.

B must supply the documented local ENU terrain grid from `docs/contracts.md`. A supplies directions; this component does not calculate ephemerides, visibility, solar-disc fractions or Earth phase. All externally supplied data must be validated before entering the scene.

## Controls and boundaries

OrbitControls supports mouse rotation, zoom/pan, and touch gestures. The scene has overview/surface presets, camera reset, a wireframe option and height exaggeration. Gold is Sun, blue is Earth. The marker is enlarged to remain visible at regional scale; it is not a dimensionally accurate lander.

The synthetic timeline selects three discrete samples with no interpolation. Manual Sun angles are explicitly test inputs; changing the timeline restores fixture values. The height field and the artificial flat horizon in the analysis fixture are independent test inputs, not a matched physical simulation.

Rendered illumination uses ambient and directional lights. It does not include distant terrain occlusion, scientific shadows, finite solar-disc lighting or RF availability. Body sizes and sky distances are illustrative. Source direction arrows use the agreed ENU transform without vertical exaggeration. The sky is tied to the observer, not an infinitely distant panorama; close-range orbit/pan views can introduce visual parallax. Terrain curvature is not applied by this display mesh.

Geometry and OrbitControls are disposed when their inputs/view unmount. Pending fixture loads abort on unmount. WebGL creation/render failures have a text fallback; numeric controls remain outside the canvas. Test actual GPU behavior on the judging device before claiming frame-rate targets.

## Manual acceptance checks

- Overview shows a shallow synthetic crater and centre marker; orbit, zoom and reset work.
- Surface view moves the camera beside the marker; it may face the crater wall.
- Wireframe exposes 64×64 mesh structure; exaggeration changes only display heights.
- Timeline changes MET/UTC and supplied Sun elevation together; manual Sun angles change the gold arrow/light.
- No real science or safety badge is inferred from rendering.
- In a narrow window, the controls stack below the viewport and remain usable.

## Integrated C dashboard

The main app now embeds this scene through `frontend/src/features/map/LunarViewport.tsx`. From the repo root use `npm --prefix frontend ci` then `npm --prefix frontend run dev`. The standalone preview command above remains available for isolated D development.

`SceneView.dataKind` additionally accepts `unverified`, for terrain lacking a verified frame/reference. Such views force celestial overlays off and use neutral lighting regardless of `showCelestial`. The optional `showCelestial` prop can hide markers for other modes too. Scientific provenance labels in shared contracts remain unchanged; `unverified` is a display-only status.

`terrain-json.mjs` adapts B's v1 inline-height JSON for inspection without changing his exporter or source metadata. Its returned diagnostics preserve both nominal site elevation and sampled observer elevation. This is separate from the binary loader and does not certify local ENU orientation. Celestial overlays are withheld until A/B agree on a verified observer and frame.
