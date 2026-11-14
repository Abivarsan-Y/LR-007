# Cesium Moon Lab — isolated evaluation

This experiment runs beside HORIZON OPS. It does not replace the main frontend, its renderer or scientific backend. No Cesium ion account/token is used, and no Earth imagery/terrain is enabled.

## Run from the repository root

Requires Node 24 and npm.

```sh
npm --prefix experiments/cesium-lab ci
npm --prefix experiments/cesium-lab run dev
```

Open the printed address, normally http://127.0.0.1:5176/. Keep the terminal running. Ctrl+C stops it.

```sh
npm --prefix experiments/cesium-lab test
npm --prefix experiments/cesium-lab run build
```

Vite copies Cesium's worker/assets/widget runtime from the installed npm package into the ignored `public/cesium/` directory before serving/building. `dist/` contains the standalone output. Do not commit generated runtime assets, node_modules or build outputs. Serve dist over HTTP rather than opening it with file://. Initial JS is large (about 1.2 MB gzip in the tested build); further optimization is needed before adopting this in the main app.

## What is real

- Globe imagery: LROC WAC global mosaic, streamed directly from the public Lunaserv WMS. Tested layer: `luna_wac_global`; WMS 1.1.1 CRS: `IAU2000:30100`, longitude/latitude axis order. The service returns `Access-Control-Allow-Origin: *` for tested requests. Imagery availability depends on that external service; this is not an offline map.
- Reference sphere: 1,737,400 m radius, matching the project's terrain/analysis reference. Cesium's default Earth imagery, Earth terrain, sky atmosphere and celestial illumination are disabled.
- Local geometry: the checked-in 129×129 Site01 grid at 20 m spacing (2,560 m sample-centre span), checksum-verified before use. Centre height and coordinates match the recorded analysis. No missing triangle is filled.
- Direction lines: the recorded nominal Site01 analysis (673 samples; Nov 15–29, 2026; 2 m observer). Gold is Sun and blue is Earth. The transform converts north-clockwise azimuth/elevation through the observer's local ENU basis into lunar body-fixed Cartesian coordinates. It does not use Cesium's Earth-based sky or clock calculations.

The local grid is placed using a spherical geodesic forward transform of each local east/north offset, matching the supplied grid's sampling convention. Heights are absolute radial heights above the lunar reference sphere, without exaggeration. Image UVs use each resulting longitude/latitude within the requested WMS rectangle. Local texture is regional mosaic imagery, not guaranteed same-date imagery or the same spatial resolution as the DEM. It can contain very dark acquired shadows near the pole.

## Controls

- Moon globe / South pole / Connecting Ridge: camera navigation on the reference sphere. Clicks return planetocentric latitude/east longitude. Arbitrary points have no terrain elevation or mission analysis attached.
- Coordinate form: validates ranges and normalizes longitude. It returns to globe mode; it does not move or regenerate Site01 scientific data.
- Local LOLA terrain: loads the real patch and anchors camera orbit to that patch. The observer marker stays fixed to the canonical site. Clicks in this mode do not silently change the analysis.
- Inspect mesh: removes the dark image and shows a neutral surface/grid to examine geometry. Same terrain heights and scale.
- Recorded direction controls are enabled only in local mode. The slider uses existing samples directly without interpolating or recalculating ephemerides. No point selection implies a new scientific run.
- Returning to globe mode restores the global camera frame and hides the local mesh/direction lines. Local view can be pressed again to reset its camera if you zoom too far out.

## Evaluation result and limits

Browser checks verified real imagery rendering, click-to-coordinate selection, the local textured patch, mesh mode, recorded time/angle updates, and return to globe. Five automated tests check lunar geometry conventions, WMS parameters and source integrity/observer matching. A first optional-celestial initialization error was corrected during QA.

**Cesium is a feasible embedded viewer for the project.** Unlike a cross-origin QuickMap iframe, our app owns the viewer and its events. It can share selection state with the dashboard. The current main app remains intact for comparison.

This is not yet a complete streaming terrain replacement: the global globe has imagery on a sphere, and local relief is one separate grid. There is no automatic globe-to-high-resolution terrain streaming, global height sampling, terrain shadow engine, arbitrary-date analysis, RF prediction or landing-safety certification. The imagery's baked illumination is not the selected time's illumination. Direction lines can be occluded by terrain; visibility metrics still come from the scientific backend.

Next adoption step: compare this prototype with the main `LunarStage3D` on the team's target device, then agree with C on a controlled viewer interface before replacing anything. Integration should preserve explicit observer identity, units, data provenance, nullable metrics, and supported height/date combinations.

## Sources and attribution

- [CesiumJS](https://cesium.com/platform/cesiumjs/) — Apache-2.0 engine; retain package licenses and credits.
- [LROC Lunaserv](https://lunaserv.im-ldi.com/about.html) — lunar imagery service.
- [Published service configuration](https://wms.im-ldi.com/config/lunaserv.yml) — layer names, body radius and available products.
- [NASA LOLA product 78](https://pgda.gsfc.nasa.gov/products/78) and [product 90](https://pgda.gsfc.nasa.gov/products/90) — terrain provenance is retained in the checked-in source metadata.
- Project inputs: `data/processed/site01_connecting_ridge_terrain.json` and `backend/tests/fixtures/science/site01/analysis_nominal.json`.

On-screen Cesium and NASA/GSFC/ASU/LROC credits are preserved. The engine's open-source license is separate from attribution and usage conditions for individual datasets or hosted services. No permission to redistribute a complete hosted service or bulk-download its tiles is assumed.
