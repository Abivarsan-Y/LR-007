# HORIZON OPS — LR-007

Lunar Landing Site, Mission Window & LunaDiff Navigator. Scope follows [the master plan](notes/master_plan.md).

## Current implementation

The main app offers a recorded Connecting Ridge mission, a +48-hour arrival comparison, terrain inspection and reproducible export. Start with **Explore the verified demo**. The fixed scientific scenario is 15–29 November 2026 at a 2 m observer, with 30-minute sampling; the delayed scenario starts November 17. Source URLs, hashes and model limitations are available in **Data & method**.

FastAPI provides sites, analyze, diff, recommendations and JSON/CSV export. The client can replay the checked-in real Site01 records and export offline without downloading the original multi-GB DEMs. Other sites provide terrain inspection; matched real astronomy is withheld. Terrain clicks do not relocate the analyzed observer. Candidate markers screen terrain and are not certified landing sites.

Rendering is illustrative. Numeric/horizon results determine visibility; Earth-centre visibility is not guaranteed radio service. Unknown scientific values remain unknown. The original renderer and raw datasets retain their documented scientific/display limitations.

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
