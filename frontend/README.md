# HORIZON OPS frontend — Cesium integration

The Frontend-Overhaul layout now uses Cesium for its main Moon view. Search, sidebars, horizon chart, timeline, 2D map and recorded analysis remain in the dashboard.

## Run from the repository root

Use Node 24 and npm.

```sh
npm --prefix frontend ci
npm --prefix frontend run dev
```

Open the URL printed by Vite. The dashboard can read its bundled science fixtures without a Python server; lunar imagery requires internet access. No Cesium ion token is needed.

```sh
npm --prefix frontend test
npm --prefix frontend run build
```

Vite copies the installed Cesium Assets, Widgets, Workers and ThirdParty directories into ignored `public/cesium` on start/build. Do not commit those generated assets. Deployment currently assumes the site is hosted at `/`. The build includes TypeScript checking; Cesium produces a large-bundle warning.

## Real data and boundaries

- The global Moon is a 1,737,400 m reference sphere with real LROC WAC imagery streamed from [Lunaserv](https://wms.im-ldi.com/), layer `luna_wac_global`, WMS 1.1.1, `IAU2000:30100`. Global elevation tiles are not connected.
- Connecting Ridge (Site 01) has a verified 129 × 129 LOLA elevation crop, 20 m spacing, and recorded JPL Horizons analysis at the canonical MOON_ME_DE421 observer and 2 m mast. Select it through search, then choose OBLIQUE or HORIZON to inspect the local terrain. The global globe is hidden in this local view so it cannot cover negative terrain heights.
- Local offsets are mapped onto the lunar sphere using spherical forward geodesics. Heights use the declared reference radius and canonical observer elevation. Vertical exaggeration changes only the display, never the stored science values.
- Sun/Earth vectors require matching coordinates, frame, radius, elevation, observer height and real-data provenance. They retain negative elevations. The timeline selects recorded samples; the renderer does not compute ephemerides or terrain shadows. Imagery contains acquisition-time lighting.
- Only the 2 m observer has verified recorded Site01 results, so its 5 m toggle is disabled. Arbitrary coordinates are inspection only: elevation is not sampled, analysis is unknown, vectors are hidden and exports disabled. Other catalog previews do not gain verified local relief from this integration.
- An imagery failure is reported; no procedural Moon is substituted. The old main procedural renderer has been removed. Legacy independent scene previews are separate from this main view.

## State flow

`App.tsx` owns the selected site, workspace, timeline sample and display settings. The existing API client loads recorded analysis and validates/decodes terrain. Selection requests are sequenced to prevent an older response replacing a newer selection. `CesiumLunarStage` receives those values and manages Cesium resources; camera interaction does not alter the recorded science. Replacing a patch removes its old primitives; unmount destroys the viewer and handlers.

## Validation

The frontend tests cover existing contracts/terrain decoding plus lunar coordinate conversion, WMS requests, ENU directions and observer matching. Browser checks exercised the loaded imagery, verified Site01 selection, local relief and slope overlay, and unknown analysis at an arbitrary coordinate. This does not validate landing safety or new ephemeris computations.

Inherited recommendation/safe-haven UI and the separate 2D view remain work owned by their existing producers; their labels do not certify a site. Global DEM streaming, scientific shadows, bundle splitting and additional verified observers are follow-ups.
