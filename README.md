# HORIZON OPS — LR-007

Lunar Landing Site, Mission Window & LunaDiff Navigator. The source of truth for scope is [the master plan](notes/master_plan.md).

## Current work: D foundation

This branch replaces the earlier learning dashboard and Python health server with Person D's initial contracts, synthetic fixtures, scene direction adapter, and CI. A owns the real API/science, B owns terrain processing, C owns the frontend application, and D owns shared contracts, 3D and delivery.

**No NASA calculation, landing recommendation, runnable dashboard or 3D renderer is implemented here.** All example numbers are synthetic. Prior learning code remains recoverable in Git history at `69ffee8` and on the old `jahsan/lunar-mvp` branch.

## Validate locally

Requires Python 3.10+ and Node 24 (CI uses Python 3.14).

```sh
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements-dev.txt
python scripts/validate_fixtures.py
python -m unittest discover -s tests -v
node --test frontend/src/scene/directions.test.mjs
```

The virtual environment isolates the validation dependency from your system Python. The validator checks JSON structure, timestamps, basic cross-field rules and terrain checksum/byte count. Tests deliberately reject invalid data. Node tests verify the scene's cardinal directions and unit-vector conversion without installing frontend packages.

There is no `npm run dev` on this branch yet. Person C will create the frontend app; D's scene utility is independent of that scaffold. Stop any old Vite/Python processes left running from the learning prototype.

## Layout

- `contracts/`: five draft JSON Schema 2020-12 contracts.
- `data/fixtures/`: synthetic examples, including a 64×64 little-endian float32 crater grid (16 KiB).
- `scripts/validate_fixtures.py`: schema and integration checks.
- `tests/`: positive and negative contract tests.
- `frontend/src/scene/`: independent direction conversion and tests; later Three.js integration point.
- `.github/workflows/`: automated contract and direction checks.
- `docs/contracts.md`: conventions, fixture meaning and handoff instructions.

The formats are **draft version 0.1.0**, ready for producer/consumer review. They are not claimed to be team-approved or frozen. This CI only checks D's current foundation; API/frontend checks will be added when those applications exist.
