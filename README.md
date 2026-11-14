# HORIZON OPS — LR-007

Lunar Landing Site, Mission Window & LunaDiff Navigator. Scope follows [the master plan](notes/master_plan.md).

## Current implementation

- A: FastAPI health endpoint and a Horizons ephemeris client with verified real-response cache replay; analysis endpoints are not wired yet.
- B: terrain ingestion and four JSON grid exports. Their orientation, height-reference metadata and site-elevation agreement need validation before scientific combination.
- C/D: mission dashboard with embedded React Three Fiber terrain scene, camera controls, site-grid switching and a separate synthetic direction timeline.
- D: draft shared JSON contracts, synthetic fixtures, loaders, validation tests and CI.

The default dashboard displays exported terrain for **unverified inspection only**, with neutral lighting and celestial overlays hidden. A separate synthetic mode drives the Sun/Earth markers with three explicit fixture samples. Telemetry remains synthetic and static. No terrain-aware visibility, certified landing safety, real scenario comparison or scientific shadow result is produced by this integration.

## Run the dashboard

Requires Node 24 and npm. From the repo root:

```sh
npm --prefix frontend ci
npm --prefix frontend run dev
```

Open Vite's printed local URL. The preview requires no Python process or NASA requests. See [frontend instructions](frontend/README.md) for modes, state flow and manual checks. The [standalone D scene](frontend/src/scene/README.md) remains available independently.

## Checks

```sh
npm --prefix frontend test
npm --prefix frontend run build
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements-dev.txt
python scripts/validate_fixtures.py
python -m unittest discover -s tests -v
```

These checks validate UI compilation, scene geometry/directions, adapter rules and synthetic contracts. They do not validate astronomy or certify terrain science. Backend setup and science tests are documented separately in [backend/README.md](backend/README.md).

## Integration boundaries

A owns astronomy/API; B owns terrain processing; C owns the mission frontend; D owns the scene, shared formats and delivery checks. See [contract conventions](docs/contracts.md). The B-format adapter supports inspection without overwriting producer metadata; real terrain and ephemerides must use the same verified site coordinates, observer elevation and coordinate conventions.

The source documents in `notes/` are preserved. The original learning dashboard/health server remain recoverable at commit `69ffee8` in Git history.
