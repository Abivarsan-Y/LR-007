# HORIZON OPS — NASA Space Apps 2026 Development Plan

> **Challenge:** Lunar Landing Site Navigator  
> **Project:** HORIZON OPS — Lunar Landing Site & Mission Window Planner  
> **Team:** 4 developers (A, B, C, D)  
> **Development window:** plan for ~39 hours from official event opening to submission deadline; confirm the event's applicable local schedule  
> **Workflow:** 5 phases × 4 independent work packages = 20 phase-specific feature branches and pull requests  
> **Priority:** verified scientific result → two-site comparison → polished interactive visualization

## 0. Mission and definition of success

Build a browser-based lunar south-pole site comparison tool. A user selects a candidate site, date, and mission duration; the system computes the Sun's and Earth's positions, checks whether local terrain obstructs their line of sight, and presents sunlight and direct-to-Earth visibility windows.

### Required minimum viable product (MVP)

- [ ] Compare **two verified observation points**, provisionally one in **Connecting Ridge / Site01** and one in **Shackleton Rim / Site04** (final coordinates selected from and documented against NASA terrain datasets).
- [ ] Select mission start date and duration; use UTC internally.
- [ ] Retrieve and cache real Sun and Earth ephemerides from **JPL Horizons**.
- [ ] Analyze a documented lunar **LOLA digital elevation model (DEM)** for each site.
- [ ] Derive a 360° terrain-horizon profile, including coverage/uncertainty information.
- [ ] Compute sunlight and geometric direct-to-Earth visibility intervals, overlap, and worst continuous outages.
- [ ] Show comparative charts, source provenance, and an interactive 3D terrain view.
- [ ] Run without live Horizons access for a curated demonstration using **previously calculated real data**.
- [ ] Document assumptions, validation, limitations, tests, and source attribution.

**Scientific language:** “Direct-to-Earth visibility” means geometric line of sight, **not** a guarantee of communication link availability. A terrain-free horizon is a labeled fallback, **not** a terrain-aware prediction. Missing terrain coverage is **unknown**, not clear sky. An attractive 3D scene does not constitute a scientific result unless it agrees with the computation.

### Out of scope for the MVP

Full lunar-global coverage; full spacecraft landing dynamics; detailed RF link budgets; radiation and thermal simulation; production spacecraft power budgets; machine-learning predictions; speculative AI-generated values; high-fidelity full-resolution DEM delivery to browsers.

---

## 1. Technology and system design

| Layer | Chosen stack | Why |
|---|---|---|
| Frontend | React + Vite + TypeScript | Small, fast client application |
| Styling | Tailwind CSS + shadcn/ui | Accessible, consistent components |
| 3D | Three.js + React Three Fiber + Drei | Efficient terrain mesh and sky vectors |
| Charts | Recharts (or Plotly; pick one at kickoff) | Timelines, comparisons, polar skyline |
| API | Python + FastAPI + Pydantic | Clean typed scientific endpoints |
| Scientific computing | NumPy + SciPy | Angular interpolation and interval calculations |
| Geospatial processing | Rasterio / GDAL + PyProj | DEM ingestion and coordinate transformations |
| Data storage | GeoTIFF (source), compact height grids, JSON/Parquet cache | No database needed for hackathon |
| Testing | Pytest, Vitest, GitHub Actions | Automated contract and integration checks |
| Deployment | Static frontend + separately hosted FastAPI, with cached JSON fallback | Resilient judge demo |

**Architecture:** `React UI → FastAPI → ephemeris + terrain horizon + visibility + comparison` with `JPL Horizons` and `NASA LOLA` as the principal external scientific sources. The **backend owns all scientific results**; the frontend presents them and never silently recomputes different physics.

### Core datasets / documentation

1. JPL Horizons API: <https://ssd-api.jpl.nasa.gov/doc/horizons.html> — Sun and Earth observer ephemerides from a location on the Moon.
2. NASA LOLA high-resolution landing-site DEMs: <https://pgda.gsfc.nasa.gov/data/LOLA_5mpp/> — local terrain for candidate regions.
3. LOLA wider-area polar DEM information: <https://pgda.gsfc.nasa.gov/products/90> — horizon context beyond local DEM cropping.
4. NASA lunar polar illumination products: <https://pgda.gsfc.nasa.gov/products/69> — independent high-level sanity checks.
5. NASA Moon Trek: <https://trek.nasa.gov/moon/> — reference map and exploratory verification.

**Data-first checkpoint:** Confirm the official challenge's resource and submission rules at event kickoff, as well as the units, lunar coordinate reference frame, projections, coverage and licenses for the selected datasets. Do not invent exact site coordinates before inspection.

---

## 2. Four permanent workstreams and ownership

| Person | Role | Primary ownership |
|---|---|---|
| **A** | Astronomy, visibility science, FastAPI | `backend/app/`, `backend/engine/ephemeris.py`, `backend/engine/visibility.py`, `backend/engine/metrics.py`, API tests |
| **B** | Lunar DEM ingestion and terrain geometry | `backend/terrain/`, `data/sites.json`, `scripts/prepare_dem.py`, terrain tests |
| **C** | Frontend UX, charts, site comparison | `frontend/src/features/`, `frontend/src/components/`, `frontend/src/api/`, UI tests |
| **D** | 3D scene, interface contracts, CI and delivery | `frontend/src/scene/`, `contracts/`, `.github/`, `docs/`, deployment setup |

**One-time shared files:** In Phase 1, Person C owns the initial frontend scaffold/config, Person A owns the backend scaffold/config, and Person D owns the contracts/CI scaffolding. **No two people edit the same file in a phase** without agreeing on a single owner first. Changes to public JSON contracts require review from both the producer and consumer.

### Project tree (target)

```text
horizon-ops/
├── frontend/
│   ├── src/
│   │   ├── api/
│   │   ├── components/
│   │   ├── features/
│   │   │   ├── mission-planner/
│   │   │   ├── analysis/
│   │   │   └── site-comparison/
│   │   ├── scene/
│   │   └── App.tsx
│   └── package.json
├── backend/
│   ├── app/
│   │   ├── main.py
│   │   ├── api/
│   │   └── schemas/
│   ├── engine/
│   │   ├── ephemeris.py
│   │   ├── visibility.py
│   │   └── metrics.py
│   ├── terrain/
│   │   ├── ingest.py
│   │   ├── geometry.py
│   │   ├── horizon.py
│   │   └── export.py
│   ├── tests/
│   └── pyproject.toml
├── contracts/
│   ├── analysis.schema.json
│   ├── site.schema.json
│   └── terrain.schema.json
├── scripts/
│   ├── prepare_dem.py
│   └── generate_site_cache.py
├── data/
│   ├── sites.json
│   ├── fixtures/
│   └── processed/            # small tracked sample only
├── docs/
│   ├── architecture.md
│   ├── methodology.md
│   ├── validation.md
│   └── sources.md
├── .github/workflows/
├── .gitignore
└── README.md
```

**Large files:** Do not commit multi-GB source DEMs, raw download archives, API secrets, or unnecessary binary products to Git. Put source downloads in a ignored local directory, track URLs/checksums and generation scripts, and commit only small, authorized reproducible demo assets. Consider Git LFS only if truly required and agreed by the team.

---

## 3. Shared contracts: freeze these before parallel implementation

### Required backend endpoints

| Endpoint | Contract |
|---|---|
| `GET /api/health` | Basic readiness and version |
| `GET /api/sites` | Available sites, coordinates, data provenance |
| `GET /api/sites/{id}/terrain` | Compact height-grid URL and spatial metadata |
| `GET /api/sites/{id}/horizon` | Azimuth-horizon samples and coverage flags |
| `POST /api/analyze` | One site/date/duration result with samples and summary |
| `POST /api/compare` | Two or more `analyze` results plus comparison summary |

### `POST /api/analyze` request example

```json
{
  "site_id": "site01",
  "start_utc": "2026-11-15T00:00:00Z",
  "duration_hours": 168,
  "sample_minutes": 30
}
```

### Analysis response shape (illustrative — **not actual calculated values**)

```json
{
  "schema_version": "1.0",
  "site_id": "site01",
  "start_utc": "2026-11-15T00:00:00Z",
  "end_utc": "2026-11-22T00:00:00Z",
  "sample_minutes": 30,
  "samples": [
    {
      "t": "2026-11-15T00:00:00Z",
      "sun": {
        "azimuth_deg": null,
        "elevation_deg": null,
        "terrain_horizon_deg": null,
        "visible": null
      },
      "earth": {
        "azimuth_deg": null,
        "elevation_deg": null,
        "terrain_horizon_deg": null,
        "visible": null
      }
    }
  ],
  "metrics": {
    "sun_visible_hours": null,
    "earth_visible_hours": null,
    "max_earth_blackout_hours": null,
    "both_visible_hours": null
  },
  "quality": {
    "method": "pending",
    "terrain_coverage": "unknown",
    "sources": []
  }
}
```

Person D owns the final JSON Schema files. Person A confirms production feasibility, Person B approves terrain metadata, Person C approves frontend usability. The sample's nulls are intentional; **never treat placeholders as results**. Use units and ISO 8601 UTC timestamps consistently. Define the azimuth reference (north/east convention) explicitly and convert to scene coordinates **once**, in one documented adapter.

### Independent development without blocking

- A uses a **synthetic horizon fixture** until B's verified horizon profile is merged.
- B uses documented lunar coordinate/site metadata and tests independently of A's Horizons client.
- C uses **synthetic contract-compliant analysis fixtures** until live API integration.
- D uses a **synthetic height grid and sky vectors** until B's mesh and A's ephemerides are merged.
- Every fixture must be labeled `synthetic` and excluded from scientific claims in the final demo.

---

## 4. Timeline and phase gates

| Phase | Relative time | Intended result | Parallel PRs |
|---|---|---|---:|
| **1 — Foundation and contracts** | H0–H3 | Working scaffolds, frozen contracts | 4 |
| **2 — Real data and UI bases** | H3–H11 | Horizons data, first DEM, dashboard and 3D viewer | 4 |
| **3 — Scientific calculation** | H11–H21 | Tested terrain horizon and visibility logic | 4 |
| **4 — Application integration** | H21–H30 | Two-site end-to-end mission comparison | 4 |
| **5 — QA and submission** | H30–H37 | Validated, deployed, documented entry | 4 |
| **Submission buffer** | H37–H39 | Verify links, final submission and contingency | — |

**Important:** This schedule is measured from the team's actual permitted kickoff; verify the applicable submission deadline and compress phases as needed. By **H21**, aim to have one real, reproducible scientific analysis. By **H30**, aim to have a judge-usable two-site comparison. Stop adding features in Phase 5.

---

## PHASE 1 — Foundation & contracts (H0–H3)

**Goal:** Each person has a separately testable foundation and one stable interface contract.

### A — Backend foundation

- **Branch:** `phase-1/a-backend-foundation`
- **Own:** `backend/app/`, `backend/engine/`, `backend/pyproject.toml`, backend tests.
- Initialize FastAPI, Python dependency management and Pydantic schemas.
- Add `GET /api/health`, configuration and local CORS.
- Add pytest setup and health endpoint test.
- **Done when:** backend installs, launches locally, and tests pass.

### B — Geospatial foundation

- **Branch:** `phase-1/b-terrain-foundation`
- **Own:** `backend/terrain/`, `data/sites.json`.
- Document LOLA DEM projection, units, vertical reference and lunar reference-frame assumptions.
- Add raster metadata inspection and coordinate transformation utility skeletons.
- Define site metadata fields (site ID, exact point, source DEM, CRS, reference frame, coverage).
- Add at least one metadata/coordinate-unit test.
- **Done when:** a supplied lunar raster's metadata can be inspected and reported consistently.

### C — Frontend foundation

- **Branch:** `phase-1/c-frontend-foundation`
- **Own:** initial `frontend/` scaffold, excluding D's `src/scene/` work.
- Initialize React, Vite, TypeScript, Tailwind and shadcn/ui.
- Install selected charting and React Three Fiber dependencies.
- Build a responsive shell: sidebar, main viewport, site/date controls placeholder and metrics panel.
- Set up typed API client and frontend tests.
- **Done when:** frontend starts, builds and basic UI renders without a backend.

### D — Contracts, fixtures and CI

- **Branch:** `phase-1/d-contracts-ci`
- **Own:** `contracts/`, `.github/`, `docs/architecture.md`.
- Draft/finalize the site, horizon, terrain and analysis JSON Schemas; agree the shape with A/B/C **during the first 30–45 minutes**.
- Supply labeled synthetic example fixtures.
- Set up CI for Python tests, frontend tests/build, and a contract validation job.
- Add PR template, `.gitignore` policy and collaboration rules.
- **Done when:** schemas validate fixtures and CI triggers on PRs.

**Phase 1 merge gate:** Four PRs merged; backend health endpoint works; frontend builds; shared contract is frozen; tests/CI pass. **Merge order:** D contract first, then A/B/C as independently reviewed (rebase/update branches if necessary).

---

## PHASE 2 — NASA data and independently testable interfaces (H3–H11)

**Goal:** Real ephemerides and one verified local DEM, plus functioning UI/3D components.

### A — JPL Horizons client

- **Branch:** `phase-2/a-horizons-client`
- **Own:** `backend/engine/ephemeris.py`, `backend/tests/test_ephemeris.py`.
- Request Sun (`10`) and Earth (`399`) observer ephemerides for a documented Moon-based observer.
- Parse timestamps, apparent azimuth/elevation, and metadata into the agreed contract.
- Confirm location specification, longitude convention, frame, height and timestamp assumptions.
- Add response caching, retries/error reporting and fixture-based parser tests.
- **Done when:** a real, saved Sun/Earth position time series is reproducible without re-querying the service.

### B — LOLA DEM ingestion

- **Branch:** `phase-2/b-lola-ingestion`
- **Own:** `backend/terrain/ingest.py`, `backend/terrain/export.py`, `scripts/prepare_dem.py`, `data/sites.json`.
- Obtain the appropriate Site01 local DEM and inspect spatial metadata.
- Select an exact pixel/observation point; record lunar latitude, longitude, and radial/reference height correctly.
- Produce a compact height grid and georeferencing metadata for the browser.
- Document data URL, original filename, version and checksums if available.
- **Done when:** Site01 coordinates are verified and a lightweight, correctly oriented terrain grid is exported.

### C — Mission controls and dashboard

- **Branch:** `phase-2/c-mission-ui`
- **Own:** `frontend/src/features/mission-planner/`, `frontend/src/components/`, `frontend/src/api/`.
- Create site/date/duration controls and loading/error states.
- Build summary cards and a placeholder visibility timeline driven by the agreed synthetic fixture.
- Use the typed API model; do not hardcode fake scientific metrics as real data.
- **Done when:** selecting site/date updates form state and fixture-driven charts without backend access.

### D — Standalone 3D terrain viewer

- **Branch:** `phase-2/d-terrain-viewer`
- **Own:** `frontend/src/scene/`.
- Build reusable React Three Fiber terrain from a small synthetic height grid.
- Add orbit/pan/zoom, orientation indicators and lander/observer marker.
- Expose a typed component API for `terrain`, `observer`, `sunDirection`, `earthDirection`, `time`.
- **Done when:** interactive 3D terrain works independently with synthetic input.

**Phase 2 merge gate:** Real Horizons time series cached, real Site01 grid prepared, dashboard and 3D viewer independently runnable and fixture-tested. Do **not** block Phase 2 on full scientific/visual integration.

---

## PHASE 3 — Scientific engine (H11–H21)

**Goal:** One correctly validated terrain-aware visibility analysis; retain a scientifically labeled fallback if needed.

### A — Visibility and mission metrics

- **Branch:** `phase-3/a-visibility-engine`
- **Own:** `backend/engine/visibility.py`, `backend/engine/metrics.py`, tests.
- Compare Sun/Earth apparent elevation against terrain skyline at their azimuth.
- Start against a synthetic horizon fixture; integrate B's real horizon after merge.
- Calculate visible hours, simultaneous visible hours, intervals and maximum consecutive blackout.
- Distinguish `visible`, `blocked`, and `unknown` coverage.
- Define sampling and horizon-edge handling, including angular diameter/refinement limitations.
- **Done when:** synthetic flat/ridge/intermittent-coverage cases yield correct, repeatable outputs.

### B — Terrain horizon geometry

- **Branch:** `phase-3/b-horizon-engine`
- **Own:** `backend/terrain/horizon.py`, `backend/terrain/geometry.py`, tests.
- Compute azimuth→maximum terrain obstruction angle around Site01 (initially 1° azimuth spacing).
- Include observer elevation, lunar curvature/reference frame, proper projection and no-data masks.
- Include broader/coarser terrain context if the local crop cannot cover the necessary horizon.
- Emit coverage/quality flags rather than assuming absent data means no obstruction.
- Test synthetic flat, ridge and crater cases; inspect physical plausibility.
- **Done when:** real Site01 horizon profile and test evidence are saved with metadata.

### C — Scientific analysis UI

- **Branch:** `phase-3/c-analytics-ui`
- **Own:** `frontend/src/features/analysis/`.
- Build Sun and Earth visibility timelines, outage cards, and azimuth-versus-horizon plot.
- Clearly display unknown/low-confidence intervals and provenance notices.
- Use contract-compliant synthetic fixtures; add component tests for missing values.
- **Done when:** all analysis states are usable without live data.

### D — Scientifically synchronized scene controls

- **Branch:** `phase-3/d-scene-controls`
- **Own:** `frontend/src/scene/`.
- Load Site01's compact real terrain asset generated in Phase 2.
- Ensure correct mesh orientation, height scale and observer location.
- Accept externally supplied azimuth/elevation and convert to one documented Three.js coordinate convention.
- Add time-slider prop and indicators for Sun/Earth direction using fixtures.
- **Done when:** injected sky directions render consistently on real lunar terrain.

**Phase 3 merge gate:** A's tested scientific visibility function; B's real horizon; C's analysis charts; D's site scene. **Suggested merge order:** B → A → D → C, with each PR independently passing CI. Run one integration script using **real** Horizons + **real** Site01 horizon immediately after merge.

**Critical validation:** Verify reference-frame alignment (e.g. MOON_ME/DE421 metadata where applicable), the observer's exact DEM location, angular conventions, source dates, no-data handling, and physically reasonable horizon angles. If anything remains uncertain, disclose it rather than claiming precise results.

---

## PHASE 4 — End-to-end two-site integration (H21–H30)

**Goal:** Real data flows from the selected lunar site to charts, metrics, and synchronized 3D scene.

### A — Analysis and comparison APIs

- **Branch:** `phase-4/a-analysis-api`
- **Own:** `backend/app/api/`, `backend/engine/` glue, tests.
- Implement `POST /api/analyze` and `POST /api/compare` from the frozen schema.
- Load real ephemerides and terrain horizons; expose intervals/summary/source metadata.
- Implement response caching and fail gracefully when data is absent.
- Validate a two-site request once B's second-site assets are integrated.
- **Done when:** the backend returns reproducible real results through both endpoints.

### B — Second observation site

- **Branch:** `phase-4/b-second-site`
- **Own:** `backend/terrain/`, `data/sites.json`, processed terrain artifacts, provenance notes.
- Acquire and validate Site04 Shackleton Rim elevation data.
- Record exact site coordinate, DEM coverage, frame and source.
- Produce Site04 horizon profile and compact 3D terrain asset.
- Compare Site01 and Site04 quality flags; resolve obvious alignment problems.
- **Done when:** two independent sites have valid metadata, horizon profiles and meshes.

### C — Real-data frontend and comparison

- **Branch:** `phase-4/c-site-comparison`
- **Own:** `frontend/src/features/site-comparison/`, typed API integration.
- Replace fixtures with `/api/analyze`/`/api/compare` outputs.
- Allow choosing two sites, mission date/duration and reading side-by-side results.
- Explain trade-offs without reducing all results to a scientifically unjustified single score.
- Handle loading, failure, partial coverage, and dataset provenance.
- **Done when:** a judge can run an actual comparison from the browser.

### D — 3D + chart synchronization

- **Branch:** `phase-4/d-scene-integration`
- **Own:** `frontend/src/scene/`, scene integration adapter.
- Bind real site mesh and real ephemeris directions to the same selected time as charts.
- Show above/below-local-horizon status consistently with scientific results.
- Optimize mesh size and interactive performance.
- Confirm azimuth/elevation visual agreement with backend output at sampled times.
- **Done when:** moving the time slider updates both 3D and charts without conflicting physics.

**Phase 4 merge gate:** Full user journey works for **two sites**. Merge B before A if A requires the completed second-site profile; merge C/D as reviewed and run end-to-end smoke tests. If a live NASA service is down, the demo must use **saved real computations** and mark their acquisition timestamps.

**Judge demo script:** open app → select two sites → set mission date/duration → compare sunlight and Earth visibility → inspect worst blackout → move time slider → reveal actual terrain obstruction → view provenance.

---

## PHASE 5 — Validation, polish, delivery (H30–H37)

**Goal:** Stop inventing features; make the submission reliable, presentable, and scientifically defensible.

### A — Scientific QA

- **Branch:** `phase-5/a-science-qa`
- **Own:** `backend/tests/`, `docs/methodology.md`, calculation bug fixes in A-owned files.
- Test Horizons parsing, timestamps, horizon-angle interpolation and intervals.
- Check edge cases near the horizon and assess 30-minute sampling limitations.
- Compare a few computed sky coordinates against independent Horizons outputs.
- Clearly document calculations, conventions and limitations.
- **Done when:** reproducible scientific validation report and passing tests exist.

### B — Terrain QA and provenance

- **Branch:** `phase-5/b-terrain-qa`
- **Own:** B-owned scripts/metadata, `docs/sources.md` terrain section.
- Verify DEM references, site locations, coordinate frames, elevation units and no-data masking.
- Record uncertainty and coverage; independently inspect representative skyline samples.
- Make all data preprocessing reproducible from documented commands.
- **Done when:** terrain processing and source provenance are auditable.

### C — UI and accessibility polish

- **Branch:** `phase-5/c-ui-polish`
- **Own:** C-owned frontend components/features.
- Improve mobile/responsive states, typography, labels, legends and loading/empty/error states.
- Add clear units, time zones, caveats and scientific explanation tooltips.
- Remove placeholder and synthetic results from any production pathway.
- **Done when:** judges can understand the purpose and findings without developer narration.

### D — CI, deployment, README and submission

- **Branch:** `phase-5/d-delivery`
- **Own:** `.github/`, deployment settings, `README.md`, delivery docs.
- Run final integration checks and create tagged release from stable `main` after review.
- Deploy frontend/backend or verified cached-real-data demo fallback.
- Prepare a concise demo video, setup instructions, architecture summary and source acknowledgements.
- Check official project-page fields, public links, accessibility, and any AI-tool disclosure requirements.
- Assign a second teammate to independently verify final submission links and state.
- **Done when:** production build and submission assets work from a fresh browser session.

**Phase 5 merge gate:** all four PRs reviewed and merged, passing CI, no fabricated metrics, verified public demo, documented data sources, final submission accepted/confirmed in event interface.

### H37–H39 emergency buffer

- Freeze `main` except critical fixes.
- Verify application loads anonymously, backend/cache works, demo video can be opened, and README instructions are accurate.
- Submit **before** the deadline; do not spend the buffer adding features.
- Capture confirmation/receipt and check links from another teammate's device.

---

## 5. Git strategy and merge policy

### 20 required branches

| Phase | Person A | Person B | Person C | Person D |
|---|---|---|---|---|
| 1 | `phase-1/a-backend-foundation` | `phase-1/b-terrain-foundation` | `phase-1/c-frontend-foundation` | `phase-1/d-contracts-ci` |
| 2 | `phase-2/a-horizons-client` | `phase-2/b-lola-ingestion` | `phase-2/c-mission-ui` | `phase-2/d-terrain-viewer` |
| 3 | `phase-3/a-visibility-engine` | `phase-3/b-horizon-engine` | `phase-3/c-analytics-ui` | `phase-3/d-scene-controls` |
| 4 | `phase-4/a-analysis-api` | `phase-4/b-second-site` | `phase-4/c-site-comparison` | `phase-4/d-scene-integration` |
| 5 | `phase-5/a-science-qa` | `phase-5/b-terrain-qa` | `phase-5/c-ui-polish` | `phase-5/d-delivery` |

### Commands for every person, every phase

```bash
# Sync only after the previous phase's merge gate is complete.
git switch main
git pull --ff-only origin main

# Use your assigned name; example for Person A, Phase 1.
git switch -c phase-1/a-backend-foundation

# Work within assigned file ownership, run tests, then:
git add <owned-paths>
git commit -m "feat(backend): initialize FastAPI foundation"
git push -u origin phase-1/a-backend-foundation

# Open a Pull Request into main, request review, and wait for CI.
# Next phase: create a NEW branch from the freshly merged main.
```

**Protect `main`:** require PRs, review and passing checks; disallow direct and force pushes. The four developers can push their **own** branches whenever ready. Merge **one PR at a time**; after each merge, rebase/update any later PR branches if needed and run CI. Do not merge all four blindly at the end of the event.

**Review pairs:** A ↔ B for scientific work; C ↔ D for UI/3D work. For final integration, A reviews the scientific content of plots and D checks the API/3D integration with C. Use a temporary integration branch only for unavoidable cross-branch tests; never quietly merge another person's half-finished work into yours.

### Required PR template / checklist

```markdown
## Phase / assignment

## What changed

## Files owned or changed

## How to test

## Evidence (screenshots, API samples, test output)

## Data sources and scientific assumptions

## Contract changes (none, or approval links)

## Checklist
- [ ] Changes satisfy phase acceptance criteria
- [ ] No unapproved shared-file edits or breaking contract changes
- [ ] Unit tests pass locally
- [ ] CI passes (build + tests + contract checks)
- [ ] Scientific sample values are labeled real or synthetic
- [ ] No secrets, huge raw DEMs, or unsupported claims committed
- [ ] Reviewed by at least one teammate
```

### Merge-gate rule

Every phase ends with:

1. Four individual PRs opened and reviewed.
2. CI green for all PRs.
3. Merge in dependency-safe order.
4. One integrated build/test run on the updated `main`.
5. Brief team checkpoint, confirming what is *actually working*.
6. Only then start the following phase from current `main`.

---

## 6. Scientific implementation and validation guidelines

### Ephemeris (Person A)

- Query Horizons for observer-centric Sun and Earth azimuth/elevation at the documented lunar location and time span.
- Explicitly verify Horizons request syntax, observer location coordinates and supported output quantities against the documentation.
- Store the source request/parameters and retrieval time with cached results.
- Parse time consistently as UTC. Do not silently mix lunar longitude conventions or reference frames.

### Terrain skyline (Person B)

For each azimuth, sample terrain outward from the observation point and compute the highest apparent obstruction angle. A local approximation is:

\[
H(\alpha)=\max_r\tan^{-1}\!\left(\frac{\Delta z_{\mathrm{corrected}}(r,\alpha)}{r}\right)
\]

where `Δz_corrected` must account for lunar curvature/reference geometry; do **not** blindly use a flat tangent-plane approximation for distant terrain. Handle projection, vertical datum and no-data explicitly. If far-field coverage is missing, preserve an `unknown` state.

### Visibility logic (Person A, consuming B's profile)

At each time `t`, compare the apparent elevation `e(t)` of the Sun/Earth with the skyline `H(azimuth(t))` in the same coordinate convention. Initially treat celestial bodies as point sources, and document this approximation. Add disk-size refinements only after the core result is validated.

For any interval with unknown terrain coverage, avoid assigning a precise `visible` result. Sampling at 30 minutes gives approximate event boundaries; optionally refine near transitions. Compute mission metrics from actual interval durations, not merely counts of graph pixels.

### Required test cases

| Test | Expected behavior |
|---|---|
| Flat terrain at zero elevation | Horizon close to expected geometric reference within model assumptions |
| Synthetic ridge due east | Elevated horizon around east azimuth only |
| Crater surroundings | Horizon varies with azimuth plausibly |
| Missing-data wedge | Visibility returns `unknown`, not visible |
| Sun elevation below skyline | Classified as blocked |
| Earth elevation above skyline | Classified as visible if coverage valid |
| Exactly at skyline | Consistent, documented boundary convention |
| Uniform visible or blocked samples | Correct duration/blackout totals |
| UTC cross-midnight time series | Correct continuity and intervals |
| Scene sky vector | 3D direction agrees with displayed azimuth/elevation |

### Provenance metadata required in final result

Site ID and exact lunar coordinates; DEM source/version, projection, resolution and reference frame; Horizons request and time range; sample interval; calculation version; terrain coverage; known limitations. These should be inspectable by a judge.

---

## 7. Risk management and fallback ladder

| Risk | Mitigation | Fallback |
|---|---|---|
| Horizons unavailable / slow | Cache completed verified requests; fixture parser tests | Replay saved **real** ephemeris dataset |
| Large DEM downloads | Select small study areas; crop to verified bounds | One documented site first |
| Wrong frame or projection | Unit tests for site coordinates and direction transforms | Disable terrain-aware claim until verified |
| Distant terrain omitted | Wider-area coarser DEM + coverage masks | Report affected directions `unknown` |
| Terrain engine delayed | Synthetic fixture development; split scientific core from rendering | Labeled geometric-reference-horizon MVP |
| Second site delayed | Prepare Site01 thoroughly first | Show date comparisons for one real site, disclose scope gap |
| 3D integration fails | Charts and site view remain separately functional | Use 2D map/profile instead of broken 3D |
| API deployment fails | Prepare small static analysis JSON from real run | Static interactive viewer with cached-real analyses |
| CI/merges conflict | File ownership + per-phase PRs | Freeze nonessential changes |
| Submission time pressure | Hard scope freeze in Phase 5 | Deliver strongest valid end-to-end slice |

**Priority order under pressure:** scientifically valid one-site result → two-site comparison → visibility charts → 3D sync → optimization/stretch features.

---

## 8. Demo script (target 90–150 seconds)

1. **Problem:** Lunar south-pole sites differ in solar exposure and Earth visibility; terrain can block both.
2. **Input:** Choose Connecting Ridge and Shackleton Rim observation points, the same mission date and duration.
3. **Analysis:** Show actual ephemerides and horizon profiles; explain the terrain blocking test.
4. **Result:** Compare visible hours, maximum communication blackout, and overlap. State what is and is not known.
5. **Interactive proof:** Drag the time slider and show Sun/Earth directions in the 3D viewer updating with the plots.
6. **Credibility:** Show NASA/JPL sources, exact coordinates, validation cases and a documented limitation.
7. **Takeaway:** This is a reproducible planning-support prototype, not flight-certified landing software.

---

## 9. Final acceptance checklist

### Product

- [ ] Two verified lunar observation points selectable.
- [ ] Date/duration inputs produce different real analyses.
- [ ] Actual Horizons Sun/Earth positions displayed with timestamps.
- [ ] Terrain skyline computed and coverage recorded.
- [ ] Sun/Earth visibility timelines and overlap statistics work.
- [ ] Side-by-side comparison is understandable.
- [ ] 3D scene synchronizes with analysis data (or clearly documented fallback).
- [ ] Public demo works without requiring developer credentials.

### Engineering

- [ ] 20 planned work packages accounted for (completed, deferred or explicitly descoped).
- [ ] All completed PRs reviewed; protected `main` stable.
- [ ] Backend tests pass; frontend tests/build pass; schemas validate.
- [ ] No secrets, giant raw data, or undocumented dependencies in repo.
- [ ] Clean installation instructions and reproducible preprocessing steps.

### Science and submission

- [ ] Exact site coordinates, data products, reference frames and units cited.
- [ ] Uncertainty, no-data gaps, and sampling approximations described.
- [ ] Synthetic examples removed from real-result views or visibly labeled.
- [ ] Public README, methodology, citations, and limitations included.
- [ ] Event-specific AI-tool and asset disclosures completed if required.
- [ ] Demo link/video, repository link and project-page submission independently verified before deadline.

---

## 10. Decision rules for the team

- **Truth before polish:** never publish a metric that cannot be reproduced from stated inputs.
- **Contracts before parallel coding:** change schemas only by agreement between owners and consumers.
- **Main always runs:** no direct pushes or unreviewed merges.
- **One phase, four branches:** everybody pushes their individual work and opens a PR.
- **No invented science:** unknown stays unknown; static fallback uses previously calculated real values.
- **Scope freeze:** after H30, fix defects and submit rather than adding new capabilities.

**North-star milestone (end of Phase 3):** For one exact lunar observation point and UTC date range, produce a reproducible Sun/Earth line-of-sight analysis using documented JPL Horizons data and a real, correctly interpreted NASA LOLA terrain horizon, with the limitations clearly stated.
