# HORIZON OPS frontend — C/D integration preview

React + Vite + TypeScript dashboard with Person D's React Three Fiber scene embedded in Person C's layout.

## Run from the repository root

Use Node 24 and npm (CI uses Node 24).

```sh
npm --prefix frontend ci
npm --prefix frontend run dev
```

Open the local URL printed by Vite. No Python server or NASA access is required for this preview. Stop the server with Ctrl+C.

```sh
npm --prefix frontend test
npm --prefix frontend run build
```

The build includes type checking. A large-chunk warning reflects the lazily loaded Three.js scene; it is a performance follow-up, not a failed build. The scene dependencies are installed by the main frontend; Vite deduplicates React/ReactDOM/Three/Fiber even if the independent scene preview was installed separately.

## Two explicitly different modes

- **Site terrain grid · unverified** (default): selecting a landing site loads its exported JSON from `data/processed/`. The adapter anchors the marker to the grid's sampled observer height and shows the stored nominal elevation separately. Frame/orientation/height-reference validation is pending, so Sun/Earth overlays and fixture scrubbing are disabled. Lighting is neutral illustration, not sunlight computation.
- **Synthetic direction demo**: the existing artificial crater and celestial angles are displayed. The shared three-sample fixture timeline updates the selected MET, UTC and scene directions. Its timestamps remain the fixture's actual UTC values. It does not recalculate results for selected mission dates or landing sites.

The site controls still store planning inputs in React state. Telemetry remains synthetic and static, clearly labeled, independent of the terrain shown. The 2D map, real visibility engine, scientific shadows, live API analysis, LunaDiff and exports are not connected in this integration.

## State and handoff

`App.tsx` owns mission setup, terrain source and selected sample index. `LunarViewport` maps C's site IDs to B's four JSON assets, validates/adapts the selected grid and supplies mesh props to `SceneView`. Loading is keyed by site/source/retry; old results cannot be displayed under a new site's label. A failed load shows a retry action. Switching sites or modes unmounts/replaces scene resources; the binary loader is still supported for the synthetic mode.

`TimelineScrubber` is controlled by App and selects a fixture sample. Numeric direction values remain outside WebGL. The renderer also enforces hiding celestial overlays for `dataKind="unverified"`, even if a caller requests them. C can later replace the fixture provider with verified A/B results while preserving the controlled component boundary.

Pending science handoff: verify B's crop location, grid orientation, nodata handling, reference sphere and actual observer height; use those same coordinates/heights in A's ephemeris request. Do not relabel current exported grids as scientifically validated. No backend producer code or source terrain files were changed by this integration.

See [scene documentation](src/scene/README.md) and [contract conventions](../docs/contracts.md).

## Manual checks

1. Default view loads Connecting Ridge and reports nominal/site-grid height differences without celestial overlays.
2. Change site to Shackleton/Malapert/Haworth: its terrain loads; the previous mesh is not retained under the new title.
3. Select synthetic direction demo, then scrub the timeline: UTC/MET and Sun angle values change together. Planning-date edits must not change fixture UTC.
4. Test overview/surface/reset, wireframe, height exaggeration, orbit and zoom.
5. Return to site terrain: timeline disables and celestial overlays disappear.
6. The 2D tab says the map is pending; it does not pretend to render a geographic map.
