# Member A — Phases 1–2 backend

FastAPI foundation for HORIZON OPS. Requires **Python 3.14**. The only application
endpoint is `GET /api/health`. Phase 2 adds a standalone Horizons client and
offline cache; terrain visibility and science HTTP endpoints belong to later
phases. No NASA service or dataset is needed to start the health API.

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
CORS origins, and environment configuration. Scientific endpoints and their
shared request/response schemas are deliberately left for the agreed contracts.

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
