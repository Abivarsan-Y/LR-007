# Member A — Backend (Phases 1–4)

FastAPI backend for HORIZON OPS. Requires **Python 3.14**. Phase 1 establishes
the health API and browser CORS boundary; Phase 2 adds the NASA/JPL Horizons
ephemeris client and offline cache; Phase 3 adds terrain horizons, visibility,
metrics and LunaDiff; Phase 4 exposes verified site catalog, analysis,
LunaDiff, recommendation readiness, and reproducible JSON/CSV export endpoints.
No external network call or multi-GB GeoTIFF is needed to run tests or analyze
the tracked Connecting Ridge fixture offline.

## Install, run and test

Run these commands from the repository root. With [uv](https://docs.astral.sh/uv/):

```bash
uv python install 3.14
uv sync --project backend --extra dev --locked
uv run --project backend --locked python -m uvicorn backend.app.main:app --reload --host 127.0.0.1 --port 8000
```

In a second terminal at the repository root:

```bash
uv run --project backend --locked python -m pytest backend/tests/ -v
curl http://127.0.0.1:8000/api/health
```

Alternatively, with Python 3.14 and pip:

```bash
python3.14 -m venv backend/.venv
backend/.venv/bin/python -m pip install -e './backend[dev]'
backend/.venv/bin/python -m uvicorn backend.app.main:app --host 127.0.0.1 --port 8000
backend/.venv/bin/python -m pytest backend/tests/ -v
```

The pip instructions apply the version ranges in `pyproject.toml`; the uv
instructions reproduce the exact dependency resolution in `uv.lock`.

OpenAPI documentation is available at `http://127.0.0.1:8000/docs` while running.
The app factory `create_app(settings)` allows tests or future deployments to
create separate instances with explicit configuration.

## Health contract

```json
{
  "status": "ok",
  "service": "lunar-navigator-api",
  "version": "0.1.0",
  "timestamp": "2026-11-14T00:00:00Z"
}
```

The timestamp above is illustrative; each request returns the current UTC time.
Responses use `Cache-Control: no-store`. `status` and `service` preserve the
connection check used by the unmerged `jahsan/lunar-mvp` frontend. A healthy
process does **not** assert that ephemerides, terrain, or analyses are ready.

## Browser configuration

Default CORS origins are `http://localhost:5173` and `http://127.0.0.1:5173`.
Only configured origins receive browser permission; cookie credentials are
disabled. Replace the defaults using a JSON array in the environment:

```bash
HORIZON_OPS_CORS_ORIGINS='["https://mission.example"]' uv run --project backend --locked python -m uvicorn backend.app.main:app --host 127.0.0.1 --port 8000
```

Origins must include the scheme and optional port, without paths, trailing
slashes, credentials or wildcards. An empty array disables cross-origin access.
Environment variables are read when the app is created; `.env` files are not
loaded automatically. Same-origin requests through Vite's `/api` proxy do not
require CORS permission.

## Team handoff

- **C:** preserve the existing `/api` proxy target at `http://127.0.0.1:8000`, or
  configure a frontend origin using the setting above. The existing health check
  remains compatible; no frontend files were imported or changed.
- **D:** run `uv sync --project backend --extra dev --locked`, then
  `uv run --project backend --locked python -m pytest backend/tests/ -v` with
  Python 3.14. The backend dependency file is separate from D's root contract-test
  requirements. This phase does not modify D's schemas, fixtures or workflows.
- **B:** `backend/terrain/` and terrain-specific test files remain your workstream.
  `backend/engine/` is reserved for A's later science modules.

Health tests cover response compatibility, live UTC timestamps, allowed/rejected
CORS origins, and environment configuration. Scientific endpoints implemented
in Phase 4 below conform to `contracts/*.schema.json`.

## Phase 2: real Sun/Earth positions and offline cache

`backend/engine/ephemeris.py` requests NASA/JPL Horizons observer quantities 4, 13
and 20 for the Sun (`10`) and Earth (`399`). It returns airless apparent
body-centre azimuth/elevation, equatorial angular diameter converted from
arcseconds to degrees, and apparent range in kilometres. Azimuth is clockwise
from local north. Times are explicit UTC.

The input observer uses planetocentric latitude, east-positive longitude in
[-180,180], surface elevation above a 1,737,400 m sphere and additional observer
height. Cylindrical Horizons coordinates preserve that radial position without
assuming an Earth geodetic ellipsoid. Horizons documents the lunar mean-Earth
frame relative to DE421; the actual orientation and translational-ephemeris
headers are retained separately. See the [Horizons manual](https://ssd.jpl.nasa.gov/horizons/manual.html)
and [API documentation](https://ssd-api.jpl.nasa.gov/doc/horizons.html).

From the repository root, this makes live requests if matching real caches are
absent:

```bash
uv run --project backend --locked python -m backend.engine.ephemeris \
  --site-id development-observer --latitude -89 --longitude 0 \
  --elevation-m 0 --observer-height-m 2 \
  --start-utc 2026-11-15T00:00:00Z --duration-hours 336 --sample-minutes 30 \
  --output data/cache/ephemeris/development-observer-14d.json
```

**This development observer is a mathematical point, not a DEM-verified landing
site.** Replace its inputs with B's verified coordinates/elevation for real-site
integration. Real NASA calculations do not by themselves validate that location.

Two recorded real responses are included for reproducible offline development.
The following command performs no network requests and needs no cache warming:

```bash
uv run --project backend --locked python -m backend.engine.ephemeris \
  --site-id development-observer --latitude -89 --longitude 0 \
  --elevation-m 0 --observer-height-m 2 \
  --start-utc 2026-11-15T00:00:00Z --duration-hours 336 --sample-minutes 30 \
  --cache-dir backend/tests/fixtures/horizons --offline \
  --output data/cache/ephemeris/offline-development-14d.json
```

Both cover 14 days with 673 samples per body, including both endpoints. The
output's `samples` and `provenance` match the corresponding portions of D's
analysis contract; the output is **not a complete analysis response**. Unknown
terrain horizons, visibility and solar illumination remain `null`. No blackout
metrics, illumination estimates or landing-safety claims are fabricated.
`sources` retains acquisition times, headers, request parameters and hashes;
`ranges_km` holds the aligned apparent ranges outside the shared sample format.

Library entry points are `Observer`, `EphemerisRequest`, and
`HorizonsClient(cache_dir).get_ephemeris(request, offline=True/False)`.
Supported windows start no earlier than 1972 and end no later than 2100-01-01,
span 1–672 integer hours, and use 1–60 minute steps with at most 10,000 samples
per body. The duration must contain whole intervals; starts must be whole UTC
minutes. Exact poles are rejected because local north/azimuth is singular there.

Cache identities include all observer/time inputs, target, request options and
cache version. Writes are atomic. Replay verifies raw-response SHA-256, target,
observing body/site, mean-Earth orientation, units and the full timestamp grid.
Corrupt records fail closed: remove the affected hash-named file to refetch.
Real cache files have no automatic expiry; retrieval times and source headers
identify the acquisition used. Offline misses never contact NASA or substitute
synthetic data. The curated cache cannot answer arbitrary dates or positions.

Upstream requests have a 20-second per-attempt socket timeout, up to three
attempts for transport failures, HTTP 429 and HTTP 5xx, and bounded response size.
NASA query/format errors are surfaced rather than retried as valid data.
Future UTC follows Horizons' published leap-second assumptions. Cache digests
provide corruption detection, not proof against deliberate tampering.

The ephemeris tests replay real recordings without live services and verify
parser failures, observer/time identity, bounded retries, offline operation,
atomic writes and compatibility with D's draft sample/provenance definitions.

## Phase 3: terrain visibility and LunaDiff

The new modules calculate a source-backed terrain skyline, apply it to Sun/Earth
positions, integrate sunlight/occlusion durations, and compare equal-duration
missions on elapsed time. They return the existing D analysis/diff shapes.
Phase 4 wires these engine functions into FastAPI HTTP endpoints below.

An included small real example can be analyzed **offline in a fresh clone**:

```bash
uv run --project backend --locked python -m backend.engine.mission analyze \
  --ephemeris backend/tests/fixtures/science/site01/request_nominal.json \
  --horizon backend/tests/fixtures/science/site01/horizon.json \
  --cache-dir backend/tests/fixtures/science/site01/ephemeris \
  --output data/cache/analyses/site01-nominal.json

uv run --project backend --locked python -m backend.engine.mission analyze \
  --ephemeris backend/tests/fixtures/science/site01/request_delay48h.json \
  --horizon backend/tests/fixtures/science/site01/horizon.json \
  --cache-dir backend/tests/fixtures/science/site01/ephemeris \
  --output data/cache/analyses/site01-delay48h.json

uv run --project backend --locked python -m backend.engine.mission diff \
  --scenario-a data/cache/analyses/site01-nominal.json \
  --scenario-b data/cache/analyses/site01-delay48h.json \
  --output data/cache/analyses/site01-diff48h.json
```

`analyze` takes the request from the supplied Phase 2 bundle/request wrapper and
replays the validated raw cache. It does not trust edited position arrays in
that input file. Networking is disabled unless `--online` is explicitly set.
The output defaults to unknown slope screening; `--slope-deg` accepts a supplied
native slope value when its source/meaning has been reviewed.

Generating a new native-raster horizon needs local DEMs and a source manifest:

```bash
uv run --project backend --locked python -m backend.engine.mission horizon \
  --site backend/tests/fixtures/science/site01/site.json \
  --dem data/raw/pgda/Site01_final_adj_5mpp_surf.tif \
  --dem data/raw/pgda/LDEM_80S_20MPP_ADJ.TIF \
  --source-manifest data/local/dataset_manifest.json \
  --max-radius-km 150 --azimuth-step-deg 0.25 \
  --output data/cache/horizons/site01.json
```

Source-manifest entries identify `path` relative to `--source-root` (default
current directory), `bytes`, `sha256` and source `url`. Every DEM is size/hash
checked before tracing; its geographic reference sphere and native affine are
read from the file. The exact observer elevation must agree with the preferred
DEM to 0.01 m. List high-resolution local terrain before the regional fallback.
No large TIFFs are committed to Git; the small recorded example supplies its
derived skyline and source hashes for offline integration tests.

Library entry points:

- `HorizonProfile`, `solar_disc_fraction`, `evaluate_visibility`
- `calculate_metrics`, `visibility_intervals`
- `build_analysis`, `calculate_luna_diff`
- `RasterTerrain`, `compute_horizon`, `prepare_raster_horizon`

See [SCIENCE.md](SCIENCE.md) for exact definitions, synthetic/real provenance,
sampling limitations, source reproduction and measured sensitivity. The raster
adapter is A-owned and leaves B's terrain functions and shared contracts intact.

## Phase 4: HTTP science & export API

All Phase 4 endpoints run offline out-of-the-box against the tracked real Site 01
fixtures in `backend/tests/fixtures/science/site01/` (`site.json`,
`horizon.json`, `analysis_nominal.json`, `analysis_delay48h.json`,
`diff_delay48h.json`, and `ephemeris/`). Live upstream JPL Horizons fetches remain
disabled unless both `HORIZON_OPS_ALLOW_LIVE_HORIZONS=true` and `online: true`
are explicitly set; missing offline caches fail closed with HTTP `404`.

### Endpoints

- `GET /api/sites` (`?site_id=...`) — list contract-verified south-polar sites
  (`contracts/site.schema.json`). Unverified legacy IDs are not exposed.
- `GET /api/sites/{site_id}` — return one verified site or HTTP `404`.
- `POST /api/analyze` — compute solar/Earth visibility, illumination, slope
  screening, and mission metrics (`contracts/analysis.schema.json`). Accepts
  `site_id` or explicit south-polar `observer`, `start_utc`, `duration_hours`,
  `sample_minutes`, `observer_height_m`, and optional `slope_deg` /
  `horizon_profile`.
- `POST /api/diff` — compute LunaDiff (`contracts/diff.schema.json`) from any
  combination of cached/precomputed `analysis_id`, inline scenario request, or
  full analysis object (`scenario_a` / `scenario_b` or `scenario_a_id` /
  `scenario_b_id`).
- `POST /api/recommend` — return verified DEM proximity landing candidates
  (`contracts/recommend.schema.json`) if configured in
  `HORIZON_OPS_RECOMMENDATIONS_PATHS`, or HTTP `501` when unpopulated (never
  fabricates synthetic candidates).
- `GET /api/export` & `POST /api/export` — download reproducible JSON
  (`application/json`) or metadata-headered CSV (`text/csv`) by `analysis_id` or
  inline scenario parameters (`format=json|csv`), setting `Content-Disposition`.

### Local `curl` examples

```bash
# List contract-verified sites
curl http://127.0.0.1:8000/api/sites

# Run nominal 14-day Connecting Ridge analysis offline
curl -X POST http://127.0.0.1:8000/api/analyze \
  -H "Content-Type: application/json" \
  -d '{
    "site_id": "nasa-site01-observation",
    "start_utc": "2026-11-15T00:00:00Z",
    "duration_hours": 336,
    "sample_minutes": 30,
    "observer_height_m": 2.0
  }'

# Compare nominal vs +48h delayed scenarios via precomputed analysis IDs
curl -X POST http://127.0.0.1:8000/api/diff \
  -H "Content-Type: application/json" \
  -d '{
    "scenario_a": "analysis-83526dc582d49e81c7f4982d",
    "scenario_b": "analysis-bdfc2955855d1a12daf3cbec"
  }'

# Download reproducible CSV telemetry for the nominal analysis
curl -OJ "http://127.0.0.1:8000/api/export?analysis_id=analysis-83526dc582d49e81c7f4982d&format=csv"
```

### Phase 4 handoff for C and D

- **C (Frontend UX):** `GET /api/sites`, `POST /api/analyze`, `POST /api/diff`,
  and `GET|POST /api/export` run offline for `nasa-site01-observation` on
  `2026-11-15T00:00:00Z` and `2026-11-17T00:00:00Z` (336h, 30m step, 2m mast).
  `/api/recommend` intentionally returns HTTP `501` until verified DEM
  candidate generation is populated.
- **D (3D & Contracts):** `backend/tests/fixtures/science/site01/site.json` is
  the authoritative observer definition (`nasa-site01-observation`), and
  `analysis_nominal.json` / `analysis_delay48h.json` / `diff_delay48h.json`
  are committed in the same folder with hashes in `manifest.json`.
