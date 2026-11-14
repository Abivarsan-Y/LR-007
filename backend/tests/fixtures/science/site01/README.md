# Recorded real Phase 3 example

This small offline integration example uses a representative native NASA Site01
Connecting ridge observation pixel, not an approved or optimized landing site.
`site.json` identifies the exact pixel-derived coordinates and source artifacts.
The raw multi-GB GeoTIFFs are not included in Git.

`horizon.json` is a derived terrain skyline from the official 5 m Site01 DEM
with the full 20 m south-polar DEM as fallback/context. Source URLs/SHA-256 are
retained. The spherical, true-bearing calculation uses 150 km maximum range,
0.25° azimuth spacing, 5 m sampling within 2 km and 20 m beyond. Bilinear source
heights and circular linear skyline interpolation are approximations. Complete
sample coverage does not prove the absence of subgrid or more distant blockers.

`ephemeris/` contains four real NASA/JPL response envelopes: Sun/Earth, nominal
2026-11-15T00:00:00Z and a +48 h alternative, each 14 days at 30-minute sampling.
The full source request, acquisition time, raw response and integrity hash are
retained. The observations can be replayed without any network calls.

`requests.json` specifies those two exact requests. `analysis_nominal.json`,
`analysis_delay48h.json`, and `diff_delay48h.json` record the derived offline
analysis and LunaDiff outputs generated from those inputs via
`backend.engine.mission`. `manifest.json` records hashes for the JSON inputs and
derived outputs. Hashes detect changes; they are not publisher signatures.
These tests exercise the real-data integration and contract shape. Controlled
analytic tests separately cover geometry, disc fractions and time integration;
this recording is not an independent flight-validation oracle.

To reproduce the skyline after downloading the source files into `data/raw/pgda`:

```bash
uv run --project backend --locked python -m backend.engine.mission horizon \
  --site backend/tests/fixtures/science/site01/site.json \
  --dem data/raw/pgda/Site01_final_adj_5mpp_surf.tif \
  --dem data/raw/pgda/LDEM_80S_20MPP_ADJ.TIF \
  --source-manifest data/local/dataset_manifest.json \
  --max-radius-km 150 --azimuth-step-deg 0.25 \
  --output data/cache/horizons/site01-reproduced.json
```

Sources: NASA PGDA products 78 and 90, and NASA/JPL Horizons quantities 4/13/20.
See the full URLs in the individual source records and `backend/README.md` for
analysis/comparison commands and method definitions.
