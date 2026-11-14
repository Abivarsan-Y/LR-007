# HORIZON OPS — LR-007

Lunar Landing Site, Mission Window & LunaDiff Navigator. The source of truth for scope is [the master plan](notes/master_plan.md).

## Current work: D foundation

This branch replaces the earlier learning dashboard and Python health server with Person D's initial contracts, synthetic fixtures, scene direction adapter, and CI. A owns the real API/science, B owns terrain processing, C owns the frontend application, and D owns shared contracts, 3D and delivery.

**A standalone 3D scene preview is implemented. NASA calculations, real terrain analysis, landing recommendations and the final mission dashboard are not implemented here.** All example numbers are synthetic. Prior learning code remains recoverable in Git history at `69ffee8` and on the old `jahsan/lunar-mvp` branch.

## Validate locally

Requires Python 3.10+ and Node 24 (CI uses Python 3.14).

```sh
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements-dev.txt
python scripts/validate_fixtures.py
python -m unittest discover -s tests -v
npm --prefix frontend/src/scene ci
npm --prefix frontend/src/scene test
npm --prefix frontend/src/scene run build
```

The virtual environment isolates the validation dependency from your system Python. The validator checks JSON structure, timestamps, basic cross-field rules and terrain checksum/byte count. Tests deliberately reject invalid data. Scene tests verify cardinal directions, grid decoding, checksum rejection and nodata handling; the build also type-checks the React scene.

Run D's independent preview with `npm --prefix frontend/src/scene run dev`, then open the printed local address on port 5174. See [the scene guide](frontend/src/scene/README.md) for controls and component integration. Person C still owns the main frontend application; this preview does not create its scaffold. Stop any old Vite/Python processes left running from the learning prototype.

## Layout

- `contracts/`: five draft JSON Schema 2020-12 contracts.
- `data/fixtures/`: synthetic examples, including a 64×64 little-endian float32 crater grid (16 KiB).
- `scripts/validate_fixtures.py`: schema and integration checks.
- `tests/`: positive and negative contract tests.
- `frontend/src/scene/`: React Three Fiber component, terrain decoder, direction utility, tests and isolated preview.
- `.github/workflows/`: automated contract and direction checks.
- `docs/contracts.md`: conventions, fixture meaning and handoff instructions.

The formats are **draft version 0.1.0**, ready for producer/consumer review. They are not claimed to be team-approved or frozen. This CI only checks D's current foundation; API/main-frontend checks will be added when those applications exist. The independent scene preview already has tests and a build check.
